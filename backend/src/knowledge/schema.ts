/**
 * 知识库（板块 B）数据域：独立表，与板块 A 同库但表域完全隔离（design.md D1）。
 *
 * 表清单：
 * - knowledge_docs      文档索引（路径/标题/目录/标签/正文/hash/mtime）
 * - knowledge_links     关系边（文档间链接 + 文档-标签归属）
 * - knowledge_fts       FTS5 trigram 全文索引（中文无需分词器即可按 3-gram 命中）
 * - knowledge_hot_cache 热点缓存（TTL）
 * - knowledge_meta      索引元信息（最近索引时间 / 构建中 / 上次错误）
 * - task_kb_refs        任务关联资料（板块 A ↔ B 唯一耦合点）
 * - task_hot_refs       任务背景·外部环境情报（hot-intel D2，独立表，不改 task_kb_refs 结构）
 *
 * 本模块不读写板块 A 的任何表（agents/tasks/task_events/deliverables/messages/workflows/agent_executions/settings）。
 */
import { sqlite } from '../db/client.ts';

/** 表名常量（板块 B 专属） */
export const KT = {
  docs: 'knowledge_docs',
  links: 'knowledge_links',
  fts: 'knowledge_fts',
  hotCache: 'knowledge_hot_cache',
  meta: 'knowledge_meta',
  taskRefs: 'task_kb_refs',
  hotTaskRefs: 'task_hot_refs',
  /** P2·F3：小助理草稿区（工作台自有存储，独立于 Vault；不经知识库索引/搜索/星图） */
  drafts: 'kb_drafts',
} as const;

/** 元信息键 */
export const META = {
  indexedAt: 'indexed_at',
  indexing: 'indexing',
  lastError: 'last_error',
  root: 'last_root',
} as const;

/** knowledge_docs 行（snake_case 与 SQLite 列名一致） */
export interface KnowledgeDocRow {
  path: string;
  title: string;
  dir_path: string;
  tags: string; // JSON array
  body: string;
  hash: string;
  mtime: string;
  size: number;
}

/** knowledge_links 行 */
export interface KnowledgeLinkRow {
  id: number;
  source_path: string;
  /** 文档相对路径，或 `tag:<标签名>` */
  target: string;
  kind: string; // link | tag
}

/** knowledge_hot_cache 行 */
export interface KnowledgeHotCacheRow {
  cache_key: string;
  payload: string;
  fetched_at: string;
  expires_at: string;
}

/** task_kb_refs 行 */
export interface TaskKbRefRow {
  id: number;
  task_id: number;
  doc_path: string;
  title: string;
  anchor: string | null;
  note: string;
  created_at: string;
}

/** 幂等建表（启动保底；重复调用无副作用） */
export function ensureKnowledgeSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_docs (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      dir_path TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '',
      hash TEXT NOT NULL DEFAULT '',
      mtime TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      target TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'link'
    );
  `);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_links_source ON knowledge_links (source_path);');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_links_target ON knowledge_links (target);');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_docs_dir ON knowledge_docs (dir_path);');
  // FTS5 trigram：中文按 3-gram 匹配，无需外部分词器（零新增依赖）。
  // 注意：trigram 对 1-2 字查询无命中，由 search.ts 的 LIKE 兜底覆盖。
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts
    USING fts5(path UNINDEXED, title, body, tokenize=trigram);
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_hot_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS task_kb_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      doc_path TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      anchor TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_task_kb_refs_task ON task_kb_refs (task_id);');
  // hot-intel D2：任务背景·外部环境情报独立表（不改 task_kb_refs 结构）
  // hot_id = 热点条目 id（来源内唯一）；valid 记录热点是否仍有效（来源失效/条目下线标记为失效）
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS task_hot_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      hot_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL DEFAULT '',
      url TEXT,
      latest_at TEXT,
      created_at TEXT NOT NULL,
      valid INTEGER NOT NULL DEFAULT 1
    );
  `);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_task_hot_refs_task ON task_hot_refs (task_id);');

  // P2·F3 小助理草稿区：工作台自有存储，独立于 Vault（只读承诺不破）。
  // source_kind: doc=文档整理 / hot=热点素材卡 / audit=知识库体检建议 / raw=解析失败原文
  // source_ref: 来源引用（文档相对路径或热点 id）；agent_id: 产出者（当前固定 agent-assistant）
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS kb_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT 'agent-assistant',
      structured INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

/** kb_drafts 行（P2·F3 草稿区） */
export interface KbDraftRow {
  id: number;
  title: string;
  source_kind: 'doc' | 'hot' | 'audit' | 'raw';
  source_ref: string;
  agent_id: string;
  structured: number;
  content: string;
  created_at: string;
}

/** task_hot_refs 行 */
export interface TaskHotRefRow {
  id: number;
  task_id: number;
  hot_id: string;
  title: string;
  source_id: string;
  source_name: string;
  evidence: string;
  url: string | null;
  latest_at: string | null;
  created_at: string;
  valid: number;
}

/** 读取元信息（不存在返回 null） */
export function getMeta(key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM knowledge_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** 写入元信息（幂等 upsert） */
export function setMeta(key: string, value: string): void {
  sqlite.prepare('INSERT INTO knowledge_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
