/**
 * 数据表行类型定义（snake_case 与 SQLite 列名一致；表结构由 db/ensure.ts 以 SQL 建表）
 */

export interface AgentRow {
  id: string;
  name: string;
  role: string;
  persona: string;
  model: string;
  skills: string; // JSON array
  workflow_skills: string; // JSON object: {"<workflowId>":["技能",...]}（skill-workflow-isolation）
  workflow_files: string; // JSON object: {"<workflowId>":["知识库/…md",...]}（挂载文件按工作流分份）
  files: string; // JSON array（各工作流份的并集，只读派生视图）
  online_status: string; // online | busy | idle
  activity: string | null;
  last_active_at: string | null;
  created_at: string;
}

export interface TaskRow {
  id: number;
  title: string;
  workflow_id: string;
  stage: string;
  column: string; // planned | progress | awaiting | done
  owner_agent_id: string | null;
  description: string;
  platform: string; // 多选平台逗号拼接
  reference_image: string | null; // 参考图地址（/uploads/xxx.png 或 dataURL）
  /** 工作流专属表单扩展字段（JSON）：小红书存 { contentType, audience, product }；电商为空 */
  brief: string | null;
  progress: number;
  stage_note: string;
  archived: number; // 0 未归档 / 1 已归档（归档≠删除，可恢复）
  created_by: string;
  created_at: string;
}

export interface TaskEventRow {
  id: number;
  task_id: number;
  type: string;
  payload: string; // JSON object
  created_at: string;
}

export interface DeliverableRow {
  id: number;
  task_id: number;
  stage: string;
  kind: string; // copy | image
  content: string; // JSON
  status: string; // pending | approved | rejected
  version: number;
  updated_at: string;
}

/** deliverable_versions 行（delivery-ops B3 版本历史留档） */
export interface DeliverableVersionRow {
  id: number;
  deliverable_id: number;
  task_id: number;
  stage: string;
  kind: string; // copy | image
  version: number;
  content: string; // JSON
  status: string; // pending | approved | rejected
  created_at: string;
}

export interface MessageRow {
  id: number;
  chat_kind: string; // group | private
  from: string;
  to: string;
  body: string;
  kind: string; // msg | evt
  task_id: number | null;
  created_at: string;
}

export interface WorkflowRow {
  id: string;
  name: string;
  stages_json: string;
}

export interface AgentExecutionRow {
  id: number;
  agent_id: string;
  task_id: number | null;
  stage: string | null;
  model: string;
  status: string; // success | failed
  input_summary: string;
  output_summary: string;
  error: string | null;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  tokens_estimated: number; // 0 真实 usage / 1 按字符估算（delivery-ops B12）
  created_at: string;
}

export interface SettingsRow {
  key: string;
  value: string; // JSON
}

/** 表名常量 */
export const T = {
  agents: 'agents',
  tasks: 'tasks',
  taskEvents: 'task_events',
  deliverables: 'deliverables',
  deliverableVersions: 'deliverable_versions',
  messages: 'messages',
  workflows: 'workflows',
  agentExecutions: 'agent_executions',
  settings: 'settings',
} as const;
