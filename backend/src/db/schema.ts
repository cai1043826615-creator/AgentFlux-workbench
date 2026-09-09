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
  files: string; // JSON array
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
  platform: string;
  progress: number;
  stage_note: string;
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
  messages: 'messages',
  workflows: 'workflows',
  agentExecutions: 'agent_executions',
  settings: 'settings',
} as const;
