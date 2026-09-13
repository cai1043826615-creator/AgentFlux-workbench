/**
 * 知识库读查询（浏览 / 目录 / 标签 / 总览 / 阅读原文）。
 * 阅读优先从 Vault 实时读取（保证与 Obsidian 中一致），不可用时回退到索引内正文。
 */
import type {
  KnowledgeDirInfo,
  KnowledgeDoc,
  KnowledgeDocSummary,
  KnowledgeStats,
  KnowledgeStatus,
  KnowledgeTagInfo,
} from '@workbench/shared';
import { all, get } from '../db/client.ts';
import { isIndexing, lastIndexError } from './indexer.ts';
import { parseFrontmatter, parseSections } from './markdown.ts';
import { KT, META, ensureKnowledgeSchema, getMeta } from './schema.ts';
import { normalizeRel, readVaultFile, resolveVaultConfig } from './vault.ts';
import type { KnowledgeDocRow } from './schema.ts';

/** 索引条目 → 文档摘要 */
export function rowToSummary(row: Pick<KnowledgeDocRow, 'path' | 'title' | 'dir_path' | 'tags' | 'mtime' | 'size'>): KnowledgeDocSummary {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags) as unknown;
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    /* 坏 JSON 容错为空 */
  }
  return { path: row.path, title: row.title, dir: row.dir_path, tags, mtime: row.mtime, size: row.size };
}

/** Vault 连接状态（未连接时给出原因，板块 A 不受影响） */
export function knowledgeStatus(): KnowledgeStatus {
  ensureKnowledgeSchema();
  const cfg = resolveVaultConfig();
  return {
    state: cfg.root ? 'connected' : 'disconnected',
    reason: cfg.root ? undefined : cfg.reason,
    root: cfg.root,
    source: cfg.source,
    range: { includeDirs: cfg.includeDirs, excludeDirs: cfg.excludeDirs },
    indexing: isIndexing(),
    presets: { type: 'dir', products: cfg.presetDirs.products, brand: cfg.presetDirs.brand },
    // P1·意见#8：重点目录列表（用户可增删改；两页共用同一份数据）
    presetEntries: cfg.presetEntries,
  };
}

/** 知识库总览统计 */
export function knowledgeStats(): KnowledgeStats {
  ensureKnowledgeSchema();
  const docCount = Number((get<{ c: number }>(`SELECT count(*) c FROM ${KT.docs}`)?.c ?? 0));
  const edgeCount = Number((get<{ c: number }>(`SELECT count(*) c FROM ${KT.links}`)?.c ?? 0));
  const tagRows = all<{ tags: string }>(`SELECT tags FROM ${KT.docs}`);
  const tagSet = new Set<string>();
  for (const r of tagRows) {
    try {
      const parsed = JSON.parse(r.tags) as unknown;
      if (Array.isArray(parsed)) parsed.forEach((t) => tagSet.add(String(t)));
    } catch {
      /* ignore */
    }
  }
  const dirCount = Number((get<{ c: number }>(`SELECT count(DISTINCT dir_path) c FROM ${KT.docs}`)?.c ?? 0));
  const recent = all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} ORDER BY mtime DESC, path ASC LIMIT 8`).map(rowToSummary);
  const indexedAt = getMeta(META.indexedAt) || null;
  return {
    docCount,
    tagCount: tagSet.size,
    dirCount,
    edgeCount,
    recent,
    indexedAt,
    indexing: isIndexing(),
    lastError: lastIndexError() || getMeta(META.lastError) || null,
  };
}

/** 目录列表（含每个目录的直接+递归文档数按目录归组；前端据此建树） */
export function listDirs(): KnowledgeDirInfo[] {
  ensureKnowledgeSchema();
  const rows = all<{ dir_path: string; c: number }>(`SELECT dir_path, count(*) c FROM ${KT.docs} GROUP BY dir_path`);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.dir_path, Number(r.c));

  // 把祖先目录也补进结果：父目录计数包含其子孙文档
  const byDir = new Map<string, number>();
  for (const [dir, c] of counts) {
    const segs = dir ? dir.split('/') : [];
    byDir.set('', (byDir.get('') ?? 0) + c);
    for (let i = 1; i <= segs.length; i++) {
      const key = segs.slice(0, i).join('/');
      byDir.set(key, (byDir.get(key) ?? 0) + c);
    }
  }
  return [...byDir.entries()]
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => a.dir.localeCompare(b.dir, 'zh-CN'));
}

/** 标签列表（含文档数） */
export function listTags(): KnowledgeTagInfo[] {
  ensureKnowledgeSchema();
  const rows = all<{ tags: string }>(`SELECT tags FROM ${KT.docs}`);
  const counts = new Map<string, number>();
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.tags) as unknown;
      if (Array.isArray(parsed)) for (const t of parsed) counts.set(String(t), (counts.get(String(t)) ?? 0) + 1);
    } catch {
      /* ignore */
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-CN'));
}

/** 按目录浏览（recursive=true 含子目录） */
export function listDocsByDir(dir: string, recursive = true): KnowledgeDocSummary[] {
  ensureKnowledgeSchema();
  const target = normalizeRel(dir);
  if (!target) {
    return all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} ORDER BY dir_path ASC, title ASC`).map(rowToSummary);
  }
  if (recursive) {
    return all<KnowledgeDocRow>(
      `SELECT * FROM ${KT.docs} WHERE dir_path = ? OR dir_path LIKE ? ORDER BY dir_path ASC, title ASC`,
      [target, `${target}/%`],
    ).map(rowToSummary);
  }
  return all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE dir_path = ? ORDER BY title ASC`, [target]).map(rowToSummary);
}

/** 按标签筛选 */
export function listDocsByTag(tag: string): KnowledgeDocSummary[] {
  ensureKnowledgeSchema();
  const needle = String(tag ?? '').trim();
  if (!needle) return [];
  // JSON 数组按精确字符串匹配（转义引号避免子串误命中）
  const pattern = `%"${needle.replace(/["\\]/g, '\\$&')}"%`;
  return all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE tags LIKE ? ESCAPE '\\' ORDER BY mtime DESC`, [pattern]).map(rowToSummary);
}

/** 全部文档（前端勾选/图谱定位等使用） */
export function listAllDocs(): KnowledgeDocSummary[] {
  ensureKnowledgeSchema();
  return all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} ORDER BY dir_path ASC, title ASC`).map(rowToSummary);
}

/** 按路径批量取摘要（保持入参顺序；不存在的路径跳过） */
export function summariesOf(paths: string[]): KnowledgeDocSummary[] {
  ensureKnowledgeSchema();
  const out: KnowledgeDocSummary[] = [];
  for (const p of paths) {
    const row = get<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE path = ?`, [normalizeRel(p)]);
    if (row) out.push(rowToSummary(row));
  }
  return out;
}

/**
 * 打开文档阅读：优先读 Vault 实时原文（标题/正文/章节锚点），
 * Vault 不可用或文件缺失时回退索引内正文（仍可阅读与引用）。
 *
 * P1·Vault 改名兼容：task_kb_refs 等处保存的旧路径（英文目录）与索引新路径前缀不同，
 * 精确未命中时按「唯一同名文档」回退解析（与 refs.isDocAvailable / health.computeDocUsageRate 同一口径），
 * 避免既有引用在阅读/预览时报「文档不存在」。
 */
export async function readDoc(relPath: string): Promise<KnowledgeDoc | null> {
  ensureKnowledgeSchema();
  const path = normalizeRel(relPath);
  if (!path) return null;

  // P2-5（验收打回）：虚拟目录「依依整理/」的文档来自收件箱（kb_drafts），不在 Vault——
  // 直接从收件箱表读，用既有 KnowledgeDoc 形态返回（阅读卡片无需任何特殊分支）。
  if (path === '依依整理' || path.startsWith('依依整理/')) {
    const drafts = all<{ id: number; title: string; source_kind: string; source_ref: string; content: string; created_at: string }>(
      `SELECT id, title, source_kind, source_ref, content, created_at FROM ${KT.drafts} ORDER BY id DESC`,
    );
    if (path === '依依整理') {
      // 目录级：返回该目录的汇总页（列出各条整理）
      const lines = drafts.map((d) => `- [${d.title}](依依整理/${d.id}.md)（${d.source_kind === 'doc' ? '文档整理' : d.source_kind === 'hot' ? '素材卡' : d.source_kind === 'audit' ? '体检建议' : '未结构化'} · ${d.created_at.slice(0, 10)}）`);
      return {
        path: '依依整理',
        title: '依依整理（收件箱）',
        dir: '',
        tags: ['依依整理'],
        mtime: drafts[0]?.created_at ?? new Date().toISOString(),
        size: lines.join('\n').length,
        content: [`# 依依整理（收件箱）`, '', '依依的整理产出，确认可用后可手动沉淀进知识库。', '', ...lines].join('\n'),
        anchors: [],
      };
    }
    const id = Number(path.split('/')[1]?.replace(/\.md$/i, ''));
    const d = Number.isFinite(id) ? drafts.find((x) => x.id === id) : undefined;
    if (!d) return null;
    return {
      path: `依依整理/${d.id}.md`,
      title: d.title,
      dir: '依依整理',
      tags: ['依依整理'],
      mtime: d.created_at,
      size: d.content.length,
      content: d.content,
      anchors: [],
    };
  }

  let row = get<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE path = ?`, [path]);

  // 兼容回退（P0-6/新4）：三步解析，覆盖 wiki 裸名与旧英文目录两种形态
  // ① 精确未命中 → 按文件名（忽略 .md 后缀差异）唯一同名回退——
  //    wiki 链接常传「文案语气指南」裸名，而索引路径是「知识库/品牌规范/文案语气指南.md」，
  //    必须同时试「带 / 分隔的裸名」与「带 .md 后缀」两种 LIKE，缺一个就 404。
  // ② 唯一同名才采纳：多篇同名宁可用 error 提示，不猜错引用目标。
  if (!row) {
    const base = path.split('/').pop() ?? '';
    const baseNoExt = base.replace(/\.md$/i, '');
    if (baseNoExt) {
      const escaped = baseNoExt.replace(/[\\%_]/g, (m) => `\\${m}`);
      const sameName = all<{ path: string }>(
        `SELECT path FROM ${KT.docs} WHERE (path LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')`,
        [`%/${escaped}`, `%/${escaped}.md`],
      );
      // 也允许根目录文档（无 / 前缀）
      if (sameName.length === 0) {
        sameName.push(
          ...all<{ path: string }>(`SELECT path FROM ${KT.docs} WHERE path = ? OR path = ?`, [baseNoExt, `${baseNoExt}.md`]),
        );
      }
      // 去重后唯一才采纳
      const uniq = [...new Set(sameName.map((s) => s.path))];
      if (uniq.length === 1) row = get<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE path = ?`, [uniq[0]]);
    }
  }
  const effectivePath = row?.path ?? path;
  const cfg = resolveVaultConfig();
  const live = cfg.root ? await readVaultFile(cfg, effectivePath) : null;

  if (!row && !live) return null;
  const rawContent = live?.content ?? row?.body ?? '';
  const fm = parseFrontmatter(rawContent);
  const body = live ? fm.body : rawContent;
  const summary = row
    ? rowToSummary(live ? { ...row, mtime: live.mtime, size: live.size } : row)
    : { path: effectivePath, title: effectivePath.replace(/\.md$/i, ''), dir: effectivePath.includes('/') ? effectivePath.slice(0, effectivePath.lastIndexOf('/')) : '', tags: [] as string[], mtime: live?.mtime ?? '', size: live?.size ?? 0 };

  return {
    ...summary,
    content: body,
    anchors: parseSections(body).map((s) => ({ anchor: s.anchor, level: s.level, title: s.title })),
  };
}
