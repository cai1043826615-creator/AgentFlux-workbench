/**
 * 知识库管理系统（板块 B）共享类型 —— 前后端契约
 *
 * 边界约定（openSpec knowledge-base）：板块 B 与板块 A（多 Agent 工作流）互相独立、互不阻塞，
 * 唯一耦合点为「任务关联资料」（见 TaskKbRef 相关类型）。板块 B 的数据不出现在板块 A 的状态机中。
 */

// ===== Vault 连接与索引范围 =====

/** connected 已连接可用 / disconnected 未配置或路径无效（板块 A 不受影响） */
export type KnowledgeConnectionState = 'connected' | 'disconnected';

/** 生效的索引范围（坑5：Vault 只读且不全盘托出） */
export interface KnowledgeRange {
  /** 目录白名单（相对 Vault 根；空数组 = 不限目录） */
  includeDirs: string[];
  /** 排除目录（相对 Vault 根） */
  excludeDirs: string[];
}

/** Vault 连接状态 */
export interface KnowledgeStatus {
  state: KnowledgeConnectionState;
  /** state=disconnected 时的原因提示（面向用户，中文） */
  reason?: string;
  /** 生效的 Vault 根目录绝对路径（未连接为 null） */
  root: string | null;
  /** 配置来源：settings 设置面板 / env 环境变量兜底 / none 未配置 */
  source: 'settings' | 'env' | 'none';
  range: KnowledgeRange;
  /** 索引是否正在构建（异步后台任务） */
  indexing: boolean;
}

/** 文档摘要（浏览/搜索/关系列表通用） */
export interface KnowledgeDocSummary {
  /** 相对 Vault 根的路径（/ 分隔，作为文档唯一标识） */
  path: string;
  title: string;
  /** 所属目录（相对 Vault 根，'' 表示根目录） */
  dir: string;
  tags: string[];
  /** 文件更新时间（ISO） */
  mtime: string;
  size: number;
}

/** Markdown 章节锚点（坑4：关联粒度支持「章节/片段」而非只能整篇） */
export interface KnowledgeAnchor {
  /** 锚点标识：标题层级路径，如「产品规格 / 电池」 */
  anchor: string;
  level: number;
  title: string;
}

/** 文档详情（阅读视图） */
export interface KnowledgeDoc extends KnowledgeDocSummary {
  /** Markdown 原文 */
  content: string;
  /** 按标题层级生成的章节锚点 */
  anchors: KnowledgeAnchor[];
}

/** 目录条目（前端据此构建目录树） */
export interface KnowledgeDirInfo {
  /** 相对目录路径（'' 表示根） */
  dir: string;
  count: number;
}

/** 标签条目 */
export interface KnowledgeTagInfo {
  tag: string;
  count: number;
}

/** 知识库总览统计 */
export interface KnowledgeStats {
  docCount: number;
  tagCount: number;
  dirCount: number;
  /** 已建立的关联边数（链接 + 标签） */
  edgeCount: number;
  /** 最近更新的若干文档 */
  recent: KnowledgeDocSummary[];
  /** 最近一次索引完成时间（ISO，未索引为 null） */
  indexedAt: string | null;
  /** 索引构建中 */
  indexing: boolean;
  /** 最近一次索引失败原因（无失败为 null） */
  lastError?: string | null;
}

/** 搜索结果项（含命中片段） */
export interface KnowledgeSearchHit {
  path: string;
  title: string;
  dir: string;
  tags: string[];
  /** 命中片段纯文本（前后各带少量上下文） */
  snippet: string;
  /** fts 全文命中（≥3 字）/ like 短词兜底（1-2 字） */
  matchMode: 'fts' | 'like';
  /** 相关度分值（越小越相关；like 兜底为固定值） */
  score: number;
}

export interface KnowledgeSearchResult {
  query: string;
  hits: KnowledgeSearchHit[];
  /** 无命中时的面向用户提示 */
  hint?: string;
}

// ===== 知识星图 =====

export type KnowledgeGraphNodeKind = 'doc' | 'tag';

export interface KnowledgeGraphNode {
  /** 节点 id：doc:<相对路径> / tag:<标签> */
  id: string;
  kind: KnowledgeGraphNodeKind;
  /** 展示名（文档标题 / 标签名） */
  label: string;
  /** 文档节点的相对路径；标签节点为 null */
  path: string | null;
  /** 文档节点的标签；标签节点为 [自身] */
  tags: string[];
  /** 关联边数量 */
  degree: number;
}

export interface KnowledgeGraphEdge {
  source: string;
  target: string;
  /** link 文档间链接 / tag 文档-标签归属 */
  kind: 'link' | 'tag';
}

export interface KnowledgeGraphData {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
}

/** 节点详情（点击节点） */
export interface KnowledgeNodeDetail {
  node: KnowledgeGraphNode;
  /** 该文档指向的文档（出链） */
  outLinks: KnowledgeDocSummary[];
  /** 指向该文档的文档（入链） */
  inLinks: KnowledgeDocSummary[];
  /** 共享同一标签的其他文档 */
  sharedTagDocs: KnowledgeDocSummary[];
}

// ===== 每日热点 =====

/** 关注域分层：mustRead 必看 / browse 浏览 / other 其他 */
export type HotTier = 'mustRead' | 'browse' | 'other';

/** 关注域定义（用户可配置，本地保存不入版本库） */
export interface AttentionDomain {
  id: string;
  label: string;
  keywords: string[];
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** 电商化关注域配置 */
export interface AttentionConfig {
  /** 数据源基础地址（公共匿名 API） */
  sourceBaseUrl?: string;
  domains: AttentionDomain[];
  mustReadLimit?: number;
  browseLimit?: number;
  otherLimit?: number;
  /** 进入必看所需的最少独立信源数 */
  minimumSources?: number;
}

export interface HotItem {
  id: string;
  title: string;
  summary: string | null;
  /** 来源名称 */
  source: string;
  /** 独立信源数 */
  sourceCount: number;
  /** 命中的关注域 */
  domains: { id: string; label: string }[];
  /** 进入分层的理由（面向用户） */
  reason: string;
  /** 原文链接 */
  url: string | null;
  /** 数据时间（ISO） */
  latestAt: string | null;
}

/** 热点面板数据（live 实时 / stale 降级用缓存 / unavailable 无缓存不可用） */
export interface HotPanel {
  status: 'live' | 'stale' | 'unavailable';
  fetchedAt: string | null;
  expiresAt: string | null;
  sourceName: string;
  sourceUrl: string;
  /** 降级时的错误说明 */
  error: { code: string; message: string } | null;
  counts: { upstream: number; mustRead: number; browse: number; other: number };
  tiers: { mustRead: HotItem[]; browse: HotItem[]; other: HotItem[] };
}

// ===== 任务关联资料（板块 A/B 唯一耦合点） =====

/** 关联资料数量上限 */
export const KB_REF_LIMIT = 6;

export interface TaskKbRef {
  id: number;
  taskId: number;
  /** 相对 Vault 根路径 */
  docPath: string;
  /** 冗余标题（Vault 不可用时仍可展示与追溯） */
  title: string;
  /** 章节锚点；null = 整篇 */
  anchor: string | null;
  note?: string;
  createdAt: string;
  /** 读取时该文档是否仍在 Vault 索引中（false = 已失效） */
  valid: boolean;
}

export interface TaskKbRefInput {
  docPath: string;
  /** null/省略 = 整篇 */
  anchor?: string | null;
  note?: string;
}
