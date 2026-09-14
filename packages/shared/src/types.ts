/**
 * 核心共享类型 —— 前后端契约（OpenSpec multi-agent-ecom-workbench · 契约先行冻结）
 */
import type { TaskKbRefInput } from './knowledge.ts';

// ===== 看板列 =====
export type BoardColumn = 'planned' | 'progress' | 'awaiting' | 'done';

export const BOARD_COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: 'planned', label: '规划中' },
  { key: 'progress', label: '进行中' },
  { key: 'awaiting', label: '待确认' },
  { key: 'done', label: '已完成' },
];

// ===== Agent =====
/** 助理：知识库小助理（依依）。不参与电商工作流（派发/阶段条/播报均为三角色白名单），只在知识库侧活动 */
export type AgentRole = '文案' | '设计师' | '主管' | '助理';
/** unconfigured：渠道未配置（API 未连接） */
export type AgentOnlineStatus = 'online' | 'busy' | 'idle' | 'unconfigured';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  persona: string;
  model: string;
  /** 全局技能（读视图 = 各工作流份并集；注入数据源已改为 workflowSkills 分份） */
  skills: string[];
  /** 按工作流分份的挂载（skill-workflow-isolation）：key=workflowId，value=展示名数组 */
  workflowSkills?: Record<string, string[]>;
  files: string[];
  onlineStatus: AgentOnlineStatus;
  /** 当前活动描述，如「正在写卖点文案 #13」 */
  activity?: string;
  lastActiveAt?: string;
  createdAt?: string;
}

export interface AgentUpdateInput {
  name?: string;
  role?: AgentRole;
  persona?: string;
  model?: string;
  /** 按工作流分份的挂载（可选传入；缺省不触碰分份数据） */
  workflowSkills?: Record<string, string[]>;
  skills?: string[];
  files?: string[];
}

// ===== 任务 =====
export interface Task {
  id: number;
  title: string;
  workflowId: string;
  /** 当前工作流阶段节点 id（WorkflowStageKey） */
  stage: string;
  column: BoardColumn;
  ownerAgentId: string | null;
  description: string;
  /** 目标平台（多选，逗号分隔文本，兼容展示） */
  platform: string;
  /** 目标平台数组（多选） */
  platforms?: string[];
  /** 上传的参考图地址（/uploads/xxx.png 或 dataURL），后续全部产出基于此图 */
  referenceImage?: string;
  /** 工作流专属表单扩展字段（小红书：内容类型/目标人群/产品；电商：null） */
  brief?: TaskBrief | null;
  /** 0-100 */
  progress: number;
  /** 卡片状态文案，如「卖点文案 · 美美 在写 20m」 */
  stageNote: string;
  /** 已归档（归档≠删除：数据保留，看板不显示，可恢复回原列） */
  archived: boolean;
  createdBy: string;
  createdAt: string;
}

/** 小红书新建任务的表单扩展字段（存 tasks.brief，JSON） */
export interface TaskBrief {
  /** 内容类型：种草安利 / 测评对比 / 干货教程 / 好物合集 / 平替推荐 */
  contentType?: string;
  /** 目标人群，如「18-30 上班族」 */
  audience?: string;
  /** 产品/品牌名 */
  product?: string;
}

export interface TaskCreateInput {
  title: string;
  description: string;
  /** 目标平台（多选必填） */
  platforms: string[];
  /** 参考图：dataURL 或 /uploads/xxx.png（电商必填，小红书选填） */
  referenceImage?: string;
  workflowId?: string;
  /** 工作流专属表单扩展字段（小红书用） */
  brief?: TaskBrief | null;
  /** 关联知识库资料（板块 A/B 唯一耦合点：文档或章节片段，最多 6 份） */
  kbRefs?: TaskKbRefInput[];
}

// ===== 任务事件（活动日志 + 群聊通知来源） =====
export type TaskEventType =
  | 'TASK_CREATED'
  | 'TASK_CONFIRMED'
  | 'STAGE_STARTED'
  | 'STAGE_COMPLETED'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVIEW_PASSED'
  | 'REVIEW_ROLLBACK'
  | 'SUB_TASK_COMPLETE'
  | 'DELIVERABLE_DECIDED';

export interface TaskEvent {
  id: number;
  taskId: number;
  type: TaskEventType;
  /** 结构化载荷：stage/fromStage/toStage/agentId/note/deliverableId 等 */
  payload: Record<string, unknown>;
  createdAt: string;
}

// ===== 交付物 =====
export type DeliverableKind = 'copy' | 'image' | 'provenance';
/** pending 待决策 / approved 已采纳 / rejected 已打回 / failed 生成失败（生图异常，非用户决策）/ skipped 已跳过（用户操作，计为已决策，不触发返工） */
export type DeliverableStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'skipped';

/** 文案包结构（阶段2 输出） */
export interface CopyPackage {
  title: string;
  points: string[];
  outline: string;
  keywords: string[];
}

/** 图片条目（阶段3/4 输出） */
export interface ImageItem {
  id: string;
  name: string;
  kind: 'main' | 'sub' | 'detail';
  /** dataURL 或 /api/... 预览地址；生成失败（status='failed'）时为空字符串，不使用占位图充当成品 */
  url: string;
  status: DeliverableStatus;
  note?: string;
  /** 生成失败原因（status='failed' 时写入，供前端展示失败提示） */
  error?: string;
  /** 累计生图尝试次数（含自动重试与手动重试；上限 3 次） */
  attempts?: number;
}

// ===== 小红书种草笔记产出类型（xhs-note-workflow） =====

/** 选题方向（选题策划阶段产出 3 个，用户单选其一） */
export interface TopicOption {
  /** 切入角度，如「场景痛点种草」 */
  angle: string;
  /** 方向描述 */
  desc: string;
  /** 话题锚点，如 #打工人日常 */
  anchors: string[];
}

/** 笔记文案（笔记撰写阶段产出） */
export interface XhsNote {
  /** 标题（含 emoji，≤20 字） */
  title: string;
  /** 种草笔记体正文 */
  body: string;
  /** 话题标签 */
  tags: string[];
}

/** 发布包（发布包装阶段产出） */
export interface NotePackage {
  /** 含 emoji，≤20 字 */
  title: string;
  /** 种草笔记体正文 */
  body: string;
  /** 话题标签 */
  tags: string[];
  /** 发布时图片顺序（deliverable 内图片 id 列表） */
  imageOrder: string[];
}

/** 合规审核结果（合规审核阶段产出；自动节点，无人工决策） */
export interface ComplianceReport {
  /** 合规检查结论 */
  report: string;
  /** 检查项：通过/未通过 + 说明 */
  checks: { passed: boolean; label: string; note?: string }[];
  /** 发现问题时的回退目标（xhs-copy 或 xhs-image）；无问题为空数组 */
  issues: { targetStage: 'xhs-copy' | 'xhs-image'; note: string }[];
}

export interface Deliverable {
  id: number;
  taskId: number;
  stage: string;
  kind: DeliverableKind;
  /** JSON 序列化：CopyPackage 或 ImageItem[] */
  content: string;
  status: DeliverableStatus;
  version: number;
  updatedAt: string;
}

export interface DeliverableDecisionInput {
  taskId: number;
  kind: DeliverableKind;
  /** 逐张图片时必填（image id）；文案整体审批时省略 */
  imageId?: string;
  /** approve 采纳 / reject 打回（触发返工）/ skip 跳过（仅 image 逐张：计为已决策，不触发返工） */
  decision: 'approve' | 'reject' | 'skip';
  note?: string;
}

// ===== 消息 =====
export type ChatKind = 'group' | 'private';
/** msg 普通消息 / evt 事件播报 / receipt Agent 收到用户消息的确认与总结 */
export type MessageKind = 'msg' | 'evt' | 'receipt';

export interface Message {
  id: number;
  chatKind: ChatKind;
  /** 发送者：'你' / agent name / '系统' */
  from: string;
  /** private 时为对方 agent id；group 为 'group' */
  to: string;
  body: string;
  kind: MessageKind;
  /** 事件消息可携带任务跳转 */
  taskId?: number;
  createdAt: string;
}

export interface ChatSendInput {
  chatKind: ChatKind;
  /** private 时目标 agent id；group 为 'group' */
  to: string;
  body: string;
}

// ===== 执行日志与统计（可观测性） =====
export interface AgentExecution {
  id: number;
  agentId: string;
  taskId: number | null;
  stage: string | null;
  model: string;
  status: 'success' | 'failed';
  inputSummary: string;
  outputSummary: string;
  error: string | null;
  durationMs: number;
  createdAt: string;
  /** 新增可选字段（delivery-ops B12）：LLM token 实测/估算值 */
  inputTokens?: number;
  outputTokens?: number;
  /** true = 按字符估算；false/缺省 = 渠道真实 usage */
  tokensEstimated?: boolean;
}

export interface StageStat {
  stage: string;
  runs: number;
  successRate: number;
  avgDurationMs: number;
}

export interface ExecutionStats {
  agentId: string;
  runs: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  byStage: StageStat[];
}

// ===== 设置（LLM/生图渠道、编排开关） =====
export interface Settings {
  /** 编排模式：graph 图执行 / linear 线性降级 */
  orchestrationMode: 'graph' | 'linear';
  /** LLM 渠道配置（按 agent id 或角色） */
  llmChannels: Record<string, LlmChannelConfig>;
  /** 生图渠道配置 */
  imageChannel: ImageChannelConfig | null;
}

export interface LlmChannelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ImageChannelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// ===== 技能挂载（Agent 可挂载的本地技能，内容注入 System Prompt） =====
export interface AgentSkillInfo {
  id: string;
  name: string;
  description: string;
  /** 业务域分类（电商 / 小红书 / 通用），由技能所在目录决定、文件头「> 分类：」可覆盖；用于挂载面板分区展示 */
  category: string;
}

// ===== 环境/运行常量 =====
export const USER_NAME = '你';
export const SYSTEM_NAME = '系统';

// ===== 工作流图定义 =====
export interface WorkflowParallelGroup {
  channel: string;
  items: string[];
}

export interface WorkflowNode {
  id: string;
  label: string;
  ownerRole: string;
  /** 是否人工确认点 */
  approvalPoint?: boolean;
  /** 无确认点阶段是否自动流转下一阶段 */
  autoNext?: boolean;
  /** 并行子任务分组（按渠道分组、组内串行） */
  parallelGroups?: WorkflowParallelGroup[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
  /** 条件分支：确认点 approved/rejected、校对 passed/rollback */
  condition?: 'approved' | 'rejected' | 'passed' | 'rollback' | 'next';
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// ===== 交付物版本历史与差异（delivery-ops B3） =====

/** 交付物历史版本快照（deliverable_versions 行） */
export interface DeliverableVersion {
  id: number;
  deliverableId: number;
  taskId: number;
  stage: string;
  kind: DeliverableKind;
  version: number;
  /** JSON 序列化：CopyPackage 或 ImageItem[]（与 deliverables.content 同构） */
  content: string;
  status: DeliverableStatus;
  createdAt: string;
}

/** 相邻版本差异（copy：卖点行增删/标题/大纲/关键词；image：图片条目增删） */
export interface DeliverableDiff {
  /** 上一版本号；无上一版可对比时为 null */
  fromVersion: number | null;
  /** 当前版本号 */
  toVersion: number;
  /** 无上一版可对比（只有 v1 时） */
  hasPrevious: boolean;
  /** 两个版本完全一致 */
  identical: boolean;
  // copy 交付物
  addedPoints: string[];
  removedPoints: string[];
  keptPoints: string[];
  titleChanged: boolean;
  outlineChanged: boolean;
  /** 标题变化前后值（copy 交付物始终携带） */
  title?: { from: string; to: string };
  /** 大纲变化前后值（copy 交付物始终携带） */
  outline?: { from: string; to: string };
  /** 新增/删除关键词（相对上一版） */
  keywordChanges: { added: string[]; removed: string[] };
  // image 交付物
  addedImages: { id: string; name: string }[];
  removedImages: { id: string; name: string }[];
}

// ===== 任务列表查询（delivery-ops B5） =====

export type TaskSortKey = 'createdAt' | 'updatedAt' | 'progress';
export type TaskSortOrder = 'asc' | 'desc';

export interface TaskListQuery {
  /** 平台筛选（与关系：多值或；重复参数 platform=a&platform=b 或逗号分隔） */
  platform?: string | string[];
  /** 负责人（agent id）筛选 */
  owner?: string;
  /** 创建时间起（ISO 或 YYYY-MM-DD，闭区间） */
  from?: string;
  /** 创建时间止（闭区间） */
  to?: string;
  /** 关键字（匹配标题与描述） */
  q?: string;
  sort?: TaskSortKey;
  order?: TaskSortOrder;
  /** 是否包含已归档任务（默认 false） */
  includeArchived?: boolean;
}

/** 任务列表返回项：既有 Task + 展示元字段 + 关联资料失效计数（B6） */
export interface TaskListItem extends Task {
  ownerName: string;
  stageLabel: string;
  /** 关联资料总份数（板块 B 只读聚合；知识库不可用时降级为 0） */
  kbRefsTotal: number;
  /** 其中已失效份数 */
  kbRefsInvalid: number;
  /** 最近一次阶段/交付物变动时间（updatedAt 排序口径） */
  updatedAt?: string;
}

// ===== 交付物全局搜索（delivery-ops B5） =====

export interface DeliverableSearchHit {
  taskId: number;
  taskTitle: string;
  stage: string;
  kind: DeliverableKind;
  version: number;
  /** 命中字段：title / point / keyword / imageName */
  field: string;
  /** 命中片段（含上下文） */
  snippet: string;
}

export interface DeliverableSearchResult {
  query: string;
  hits: DeliverableSearchHit[];
  /** 是否因达到 limit 被截断 */
  truncated: boolean;
  /** 无命中/空关键字提示 */
  hint?: string;
}

// ===== 任务级执行汇总（delivery-ops B12） =====

export interface TaskCostStage {
  stage: string;
  stageLabel: string;
  runs: number;
  durationMs: number;
  successRuns: number;
  failedRuns: number;
}

export interface TaskCostAgent {
  agentId: string;
  agentName: string;
  runs: number;
  durationMs: number;
}

export interface TaskCostTokens {
  input: number;
  output: number;
  total: number;
  /** 存在任一估算记录时为 true（按字符数估算） */
  tokensEstimated: boolean;
}

/** 估算费用（仅当生效单价表含实际使用模型时给出；否则整个 cost=null） */
export interface TaskCostEstimate {
  currency: string;
  /** 估算金额（按生效单价表计算的近似值，非账单） */
  amount: number;
  estimated: true;
  /** 来源：settings 设置覆盖 / local-default 本地默认单价表 */
  pricingSource: 'settings' | 'local-default';
  /** 单价表未覆盖、未计费的模型名（部分模型未计价） */
  unpricedModels: string[];
  /** 说明（如「部分模型未计价」） */
  note?: string;
}

export interface TaskCostSummary {
  taskId: number;
  totalDurationMs: number;
  runs: number;
  successRuns: number;
  failedRuns: number;
  byStage: TaskCostStage[];
  byAgent: TaskCostAgent[];
  models: string[];
  tokens: TaskCostTokens;
  /** 无可用单价表/均未命中时 null（前端只展示耗时与 token，不给金额） */
  cost: TaskCostEstimate | null;
  firstStartedAt: string | null;
  lastFinishedAt: string | null;
}

// ===== 渠道健康检查（delivery-ops B8） =====

export interface ChannelTestError {
  code:
    | 'not_configured'
    | 'auth_failed'
    | 'model_not_found'
    | 'connect_failed'
    | 'timeout'
    | 'upstream_error'
    | 'unknown';
  message: string;
}

export interface ChannelTestResult {
  ok: boolean;
  /** 实测毫秒；未发起请求时为 null */
  latencyMs: number | null;
  /** 实际请求的模型名；未发起请求（如 not_configured）时为 null */
  model: string | null;
  /** 渠道主机名（不含完整 URL 与凭据）；未发起请求时为 null */
  baseUrlHost: string | null;
  error: ChannelTestError | null;
  /** 该 Agent 近期失败执行数（ok=false 归属判断辅助） */
  recentFailedRuns?: number;
}

// ===== 产出溯源（T1-B1 · deliverable-provenance） =====

/** 事实项类型：数值+单位 / 认证编号 / 材质成分词 / 文本型事实 */
export type FactType = 'number-unit' | 'certification' | 'material' | 'textual';
/** 事实项所在的文案文本字段 */
export type FactField = 'title' | 'points' | 'outline' | 'keywords';

export interface FactItem {
  id: string;
  type: FactType;
  /** 事实项原文 */
  text: string;
  /** 所在文本字段 */
  field: FactField;
  /** 字段内下标（points/keywords 为数组下标；title/outline 为 -1） */
  index: number;
  /** 是否已溯源（匹配到任一可用关联资料片段） */
  traced: boolean;
  /** 命中的资料标题（未溯源为空数组） */
  sources: string[];
  /** 文本型事实的匹配覆盖率 0-1；非文本型为 null */
  coverage: number | null;
  /** 归一化后的文本（调试/展示） */
  normalized: string;
}

/** 参与匹配的资料版本信息（供「基于 N 份资料、生成于 …」展示与人工复核） */
export interface ProvenanceRefMeta {
  title: string;
  mtime: string;
  hash: string;
}

export interface ProvenanceResult {
  /** 溯源率取整百分数（无事实项时为 null） */
  percent: number | null;
  /** 可溯源事实项数（分子） */
  tracedCount: number;
  /** 未溯源事实项数 */
  untracedCount: number;
  /** 全部事实项数（分母） */
  totalCount: number;
  /** 无实质事实项（totalCount===0 时为 true，界面显示「无实质事实项」而非百分数） */
  noFacts: boolean;
  /** 任务是否关联了知识库资料（task_kb_refs 非空） */
  hasRefs: boolean;
  /** 参与匹配的可用资料片段数（state='missing' 不计入） */
  refCount: number;
  facts: FactItem[];
  refsMeta: ProvenanceRefMeta[];
  /** 生成时间（ISO） */
  generatedAt: string;
}

// ===== 返工上下文（T1-B2 · rework-context） =====

export interface ReworkRecord {
  /** 打回/回退所属阶段（REJECTED 的 stage；REVIEW_ROLLBACK 的 targetStage） */
  stage: string;
  /** 意见原文（事件 payload.note；缺失时为空串） */
  note: string;
  /** 事件时间（ISO） */
  at: string;
}

export interface ReworkInfo {
  /** 任务累计返工次数（REJECTED + REVIEW_ROLLBACK） */
  count: number;
  records: ReworkRecord[];
}

