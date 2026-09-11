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
  /**
   * 业务预设依据（knowledge-ux）：依据类型固定为「目录」，路径可在连接设置中修改。
   * 未配置/非法时后端回退内置默认（KB_GRAPH_PRESETS）。
   */
  presets?: { type: 'dir'; products: string; brand: string };
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
  /** 是否孤岛文档（knowledge-ux：既无文档间链接、又无共享标签；仅文档节点携带，标签节点不适用） */
  isolated?: boolean;
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

/** 证据等级（多源事件 / 单源 / 可回查原文） */
export type HotEvidenceLevel = 'multi-source' | 'single-source' | 'traceable';

/** 关注域定义（用户可配置，本地保存不入版本库） */
export interface AttentionDomain {
  id: string;
  label: string;
  keywords: string[];
  /** 排除词：热点文本命中任一排除词 → 该关注域直接不成立（降噪规则①） */
  excludeKeywords?: string[];
  /** 多词命中阈值：同一关注域需命中 ≥ 该阈值个不同关键词才成立（默认 2，降噪规则②） */
  minKeywordHits?: number;
  /** 是否启用（默认 true） */
  enabled?: boolean;
}

/** 单源配置（可插拔多源注册表；attention.json 本地保存，不入版本库） */
export interface HotSourceConfig {
  /** 源唯一标识（如 pai-news / stats-sjjd / aihot） */
  id: string;
  /** 适配器 id（注册表键，与实现文件一一对应） */
  adapter: string;
  /** 展示名 */
  label: string;
  /** 拉取端点 */
  endpoint: string;
  /** 垂直类别（如 AI 行业聚合 / ecommerce-news / gov-stats），用于源作用域与分层 */
  vertical: string;
  /** 是否启用（默认 true） */
  enabled?: boolean;
  /** 是否需企业资质/账号（预留：本期只接公开源，配置项保留供后续增量） */
  enterpriseCredentialRequired?: boolean;
  /** 源分层上限：非电商垂直源默认 browse（最高只进「浏览」） */
  tierCap?: HotTier;
}

/** 电商化关注域配置 */
export interface AttentionConfig {
  /** 数据源基础地址（公共匿名 API）——遗留单源配置，映射为「仅启用 aihot 适配器」 */
  sourceBaseUrl?: string;
  /** 多源配置（缺省回退内置默认源列表） */
  sources?: HotSourceConfig[];
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
  /** 来源名称（兼容字段，= sourceName） */
  source: string;
  /** 产出该条目的源标识 */
  sourceId?: string;
  /** 产出该条目的源展示名 */
  sourceName?: string;
  /** 源垂直类别 */
  vertical?: string;
  /** 独立信源数 */
  sourceCount: number;
  /** 证据等级（归一化阶段判定，非 UI 猜测） */
  evidence?: HotEvidenceLevel;
  /** 最新进展（无则前端隐藏该层） */
  latest?: string | null;
  /** 命中的关注域 */
  domains: { id: string; label: string }[];
  /** 进入分层的理由（面向用户） */
  reason: string;
  /** 原文链接 */
  url: string | null;
  /** 数据时间（ISO） */
  latestAt: string | null;
}

/** 上游日报信息（信息条外链；源未提供则为 null） */
export interface HotDailyInfo {
  /** 日报日期（YYYY-MM-DD） */
  date: string;
  /** 日报条数 */
  count: number;
  /** 发布时间（ISO） */
  publishedAt: string | null;
  /** 日报链接 */
  url: string | null;
  /** 日报标题 */
  title: string;
}

/** 单源拉取状态（面板 sources[] 逐源标注） */
export interface HotSourceStatus {
  id: string;
  label: string;
  /** ok 正常 / degraded 降级（含原因） */
  status: 'ok' | 'degraded';
  /** 降级原因（面向用户） */
  error?: string;
  /** 该源贡献的去重后条目数 */
  itemCount?: number;
}

/** 热点面板数据（live 实时 / stale 降级用缓存 / unavailable 无缓存不可用） */
export interface HotPanel {
  status: 'live' | 'stale' | 'unavailable';
  fetchedAt: string | null;
  expiresAt: string | null;
  sourceName: string;
  sourceUrl: string;
  /** 逐源状态（与整体状态不冲突） */
  sources: HotSourceStatus[];
  /** 上游日报信息（无则 null，信息条退化为仅新鲜度） */
  daily: HotDailyInfo | null;
  /** 降级时的错误说明 */
  error: { code: string; message: string } | null;
  counts: { upstream: number; mustRead: number; browse: number; other: number; selected24h: number };
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

// ===== 任务热点背景（hot-context，hot-intel 追加） =====

/** 热点背景数量上限（参照 KB_REF_LIMIT） */
export const HOT_HOT_REF_LIMIT = 6;

/** 任务关联的热点背景（外部环境情报；独立表 task_hot_refs，不改 task_kb_refs） */
export interface TaskHotRef {
  id: number;
  taskId: number;
  /** 热点条目 id（面板 HotItem.id） */
  hotId: string;
  /** 冗余标题（面板不可用时仍可展示与追溯） */
  title: string;
  /** 产出该热点的源标识 */
  sourceId: string;
  /** 产出该热点的源展示名 */
  sourceName: string;
  /** 关联时的证据等级 */
  evidence: HotEvidenceLevel;
  /** 原文链接 */
  url: string | null;
  /** 热点数据时间（ISO） */
  latestAt: string | null;
  /** 关联时间（ISO） */
  createdAt: string;
  /** 读取时该热点是否仍在最新一次面板拉取中（false = 已失效，仍保留供追溯） */
  valid: boolean;
}

/** 热点背景写入输入（由面板条目快照生成） */
export interface TaskHotRefInput {
  hotId: string;
  title: string;
  sourceId: string;
  sourceName: string;
  evidence: HotEvidenceLevel;
  url?: string | null;
  latestAt?: string | null;
}

// ===== 知识健康度与图谱预设（knowledge-ux 追加，向后兼容） =====

/**
 * 文档使用率（知识库侧指标，定义见主文档 §0.2）：
 * 被至少一个任务关联过且仍存在于当前索引的不同文档数 ÷ 已索引文档总数。
 * 与任务侧的溯源类指标（T1 quality-loop 负责）是两套口径，命名严格区分。
 */
export interface KnowledgeUsage {
  /** 分子：被至少一个任务关联过、且 doc_path 仍在当前索引中的不同文档数（重复关联只计一次） */
  linkedDocs: number;
  /** 分母：当前已索引文档总数 */
  totalDocs: number;
  /** linkedDocs / totalDocs；totalDocs === 0 时为 null（未知而非报错，避免除零） */
  ratio: number | null;
}

/** 孤岛文件：既无文档间链接、又无共享标签的文档（孤岛 = Agent 永远检索不到的资料） */
export interface KnowledgeIslands {
  count: number;
  /** 孤岛文档相对路径清单（与 count 等长） */
  paths: string[];
}

/** 知识健康度（只读查询结果，GET /api/knowledge/health） */
export interface KnowledgeHealth {
  usage: KnowledgeUsage;
  islands: KnowledgeIslands;
  /** 计算时间（ISO 可解析） */
  computedAt: string;
}

/** 图谱过滤：孤立状态维度（all 不过滤 / linked 仅有文档间链接 / island 仅孤岛） */
export type KnowledgeGraphIsolationFilter = 'all' | 'linked' | 'island';

/** 业务预设条目（「只看产品资料」「只看品牌规范」）：依据固定为「目录」 */
export interface KnowledgeGraphPreset {
  id: 'products' | 'brand';
  label: string;
  /** 依据目录（相对 Vault 根路径） */
  dir: string;
}

/** 图谱业务预设内置默认（设置缺失/非法时回退；可在连接设置中修改并持久化到设置表） */
export const KB_GRAPH_PRESETS: KnowledgeGraphPreset[] = [
  { id: 'products', label: '只看产品资料', dir: '10_raw/products' },
  { id: 'brand', label: '只看品牌规范', dir: 'wiki/brand' },
];

/** 业务预设依据类型（当前固定为目录） */
export type KnowledgePresetBasis = 'dir';

/** Vault 配置保存输入（连接设置面板；root 为空 = 断开连接） */
export interface KnowledgeVaultConfigInput {
  root?: string;
  includeDirs?: string[];
  excludeDirs?: string[];
  /** 业务预设依据目录（可选；未传时保留既有值） */
  presetDirs?: { products: string; brand: string };
}
