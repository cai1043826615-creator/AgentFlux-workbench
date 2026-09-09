/**
 * 核心共享类型 —— 前后端契约（OpenSpec multi-agent-ecom-workbench · 契约先行冻结）
 */

// ===== 看板列 =====
export type BoardColumn = 'planned' | 'progress' | 'awaiting' | 'done';

export const BOARD_COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: 'planned', label: '规划中' },
  { key: 'progress', label: '进行中' },
  { key: 'awaiting', label: '待确认' },
  { key: 'done', label: '已完成' },
];

// ===== Agent =====
export type AgentRole = '文案' | '设计师' | '主管';
export type AgentOnlineStatus = 'online' | 'busy' | 'idle';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  persona: string;
  model: string;
  skills: string[];
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
  platform: string;
  /** 0-100 */
  progress: number;
  /** 卡片状态文案，如「卖点文案 · 美美 在写 20m」 */
  stageNote: string;
  createdBy: string;
  createdAt: string;
}

export interface TaskCreateInput {
  title: string;
  description: string;
  platform: string;
  workflowId?: string;
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
export type DeliverableKind = 'copy' | 'image';
export type DeliverableStatus = 'pending' | 'approved' | 'rejected';

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
  /** dataURL 或 /api/... 预览地址 */
  url: string;
  status: DeliverableStatus;
  note?: string;
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
  decision: 'approve' | 'reject';
  note?: string;
}

// ===== 消息 =====
export type ChatKind = 'group' | 'private';
export type MessageKind = 'msg' | 'evt';

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
  /** 是否人工拍板点 */
  approvalPoint?: boolean;
  /** 无拍板点阶段是否自动流转下一阶段 */
  autoNext?: boolean;
  /** 并行子任务分组（按渠道分组、组内串行） */
  parallelGroups?: WorkflowParallelGroup[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
  /** 条件分支：拍板点 approved/rejected、校对 passed/rollback */
  condition?: 'approved' | 'rejected' | 'passed' | 'rollback' | 'next';
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

