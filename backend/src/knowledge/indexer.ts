/**
 * 知识库索引构建（design.md D1/D2，坑5）：
 * - 全量扫描 Vault 内 .md → 解析 frontmatter/标题/标签/链接 → 写 knowledge_docs + knowledge_fts + knowledge_links
 * - 后台异步执行（接口返回进行中状态），不阻塞板块 A 的任务推进
 * - 索引可再生：每次重建先清空知识库表，删除的文档不再出现
 * - 只读 Vault：全程仅 listVaultMarkdown + readVaultFile，写操作被 assertVaultReadOnly 拒绝
 */
import { createHash } from 'node:crypto';
import { all, run, tx } from '../db/client.ts';
import { extractLinks, extractTags, extractTitle, parseFrontmatter, resolveLinkTarget } from './markdown.ts';
import { KT, META, ensureKnowledgeSchema, setMeta } from './schema.ts';
import { dirOf, listVaultMarkdown, readVaultFile, resolveVaultConfig, type VaultConfig } from './vault.ts';

/** 单个文档的索引条目 */
interface DocEntry {
  path: string;
  title: string;
  dir: string;
  tags: string[];
  body: string;
  hash: string;
  mtime: string;
  size: number;
}

export interface IndexResult {
  docCount: number;
  tagCount: number;
  dirCount: number;
  edgeCount: number;
  skipped: number;
}

/** 索引运行态（进程内） */
const state = { indexing: false, lastError: null as string | null };

/** 是否正在索引 */
export function isIndexing(): boolean {
  return state.indexing;
}

/** 最近一次索引失败原因 */
export function lastIndexError(): string | null {
  return state.lastError;
}

function sha1(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/** 扫描 + 解析全部文档（异步 IO 阶段，不写库） */
async function collectDocs(cfg: VaultConfig): Promise<{ docs: DocEntry[]; skipped: number }> {
  const files = await listVaultMarkdown(cfg);
  const docs: DocEntry[] = [];
  let skipped = 0;
  for (const f of files) {
    const read = await readVaultFile(cfg, f.path);
    if (!read) {
      skipped++;
      continue;
    }
    const fm = parseFrontmatter(read.content);
    docs.push({
      path: f.path,
      title: extractTitle(fm, f.path),
      dir: dirOf(f.path),
      tags: extractTags(fm),
      body: fm.body,
      hash: sha1(read.content),
      mtime: read.mtime,
      size: read.size,
    });
  }
  return { docs, skipped };
}

/** 写入索引（同步事务：docs + fts + links 一次落库，保证一致） */
function writeIndex(docs: DocEntry[]): IndexResult {
  const indexed = new Set(docs.map((d) => d.path));
  const tagSet = new Set<string>();
  const dirSet = new Set<string>();
  let edgeCount = 0;

  tx(() => {
    run(`DELETE FROM ${KT.docs}`);
    run(`DELETE FROM ${KT.links}`);
    run(`DELETE FROM ${KT.fts}`);

    const insertDoc = `INSERT INTO ${KT.docs} (path,title,dir_path,tags,body,hash,mtime,size) VALUES (?,?,?,?,?,?,?,?)`;
    const insertFts = `INSERT INTO ${KT.fts} (path,title,body) VALUES (?,?,?)`;
    const insertLink = `INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`;

    for (const d of docs) {
      run(insertDoc, [d.path, d.title, d.dir, JSON.stringify(d.tags), d.body, d.hash, d.mtime, d.size]);
      run(insertFts, [d.path, d.title, d.body]);
      d.tags.forEach((t) => tagSet.add(t));
      dirSet.add(d.dir);

      // 文档-标签归属边（共享标签的两篇文档通过该标签节点连通）
      for (const t of d.tags) {
        run(insertLink, [d.path, `tag:${t}`, 'tag']);
        edgeCount++;
      }
      // 文档间链接边（只保留指向已索引范围文档的链接）
      for (const link of extractLinks(d.body)) {
        const target = resolveLinkTarget(link, d.path, indexed);
        if (!target || target === d.path) continue;
        run(insertLink, [d.path, target, 'link']);
        edgeCount++;
      }
    }
  });

  return { docCount: docs.length, tagCount: tagSet.size, dirCount: dirSet.size, edgeCount, skipped: 0 };
}

/**
 * 全量重建索引（可直接调用；内部串行化，索引进行中时返回 null 表示已在运行）。
 */
export async function rebuildIndex(): Promise<IndexResult | null> {
  if (state.indexing) return null;
  ensureKnowledgeSchema();
  state.indexing = true;
  state.lastError = null;
  setMeta(META.indexing, '1');
  const cfg = resolveVaultConfig();
  setMeta(META.root, cfg.root ?? '');
  try {
    // P2-5（验收打回）：收件箱内容并入现有目录树与阅读体系——
    // 依依的整理产出作为虚拟目录「助理收件箱/」追加进索引（物理存 kb_drafts 表，不落 Vault、不碰只读承诺）。
    // 用户在目录树/文档列表/搜索里看到它们，点开走既有阅读卡片。
    const draftDocs = all<{ id: number; title: string; source_kind: string; source_ref: string; content: string; created_at: string }>(
      `SELECT id, title, source_kind, source_ref, content, created_at FROM ${KT.drafts} ORDER BY id DESC`,
    ).map((d) => ({
      path: `助理收件箱/${d.id}.md`,
      title: d.title,
      dir: '助理收件箱',
      tags: ['助理收件箱', d.source_kind === 'doc' ? '文档整理' : d.source_kind === 'hot' ? '素材卡' : d.source_kind === 'audit' ? '体检建议' : '未结构化'],
      body: d.content,
      hash: sha1(d.content),
      mtime: d.created_at,
      size: d.content.length,
    }));

    if (!cfg.root) {
      // 未连接不是错误：清空知识库表，保持「未连接 = 空索引」一致状态（板块 A 不受影响）；
      // 收件箱仍可见（依依产出不依赖 Vault 连接）
      writeIndex(draftDocs);
      setMeta(META.indexedAt, new Date().toISOString());
      setMeta(META.lastError, '');
      return null;
    }
    const { docs, skipped } = await collectDocs(cfg);
    const result = writeIndex([...docs, ...draftDocs]);
    const final = { ...result, skipped };
    setMeta(META.indexedAt, new Date().toISOString());
    setMeta(META.lastError, '');
    return final;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.lastError = message;
    setMeta(META.lastError, message);
    return null;
  } finally {
    state.indexing = false;
    setMeta(META.indexing, '0');
  }
}

/**
 * 后台重建（不 await）：索引进行中时直接返回 false。
 * 板块 B 的重活全异步，板块 A 不受影响（design.md Goals）。
 */
export function rebuildIndexInBackground(): boolean {
  if (state.indexing) return false;
  void rebuildIndex().catch((err) => {
    state.lastError = err instanceof Error ? err.message : String(err);
  });
  return true;
}
