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
 */
export async function readDoc(relPath: string): Promise<KnowledgeDoc | null> {
  ensureKnowledgeSchema();
  const path = normalizeRel(relPath);
  if (!path) return null;
  const row = get<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE path = ?`, [path]);
  const cfg = resolveVaultConfig();
  const live = cfg.root ? await readVaultFile(cfg, path) : null;

  if (!row && !live) return null;
  const rawContent = live?.content ?? row?.body ?? '';
  const fm = parseFrontmatter(rawContent);
  const body = live ? fm.body : rawContent;
  const summary = row
    ? rowToSummary(live ? { ...row, mtime: live.mtime, size: live.size } : row)
    : { path, title: path.replace(/\.md$/i, ''), dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', tags: [] as string[], mtime: live?.mtime ?? '', size: live?.size ?? 0 };

  return {
    ...summary,
    content: body,
    anchors: parseSections(body).map((s) => ({ anchor: s.anchor, level: s.level, title: s.title })),
  };
}
