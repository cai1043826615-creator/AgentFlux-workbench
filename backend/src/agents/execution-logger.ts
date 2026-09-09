import type { AgentExecution } from '@workbench/shared';
import { get, run } from '../db/client.ts';
import type { AgentExecutionRow } from '../db/schema.ts';

/** 执行日志入参（各阶段 advance 产出后调用） */
export interface ExecutionLogInput {
  agentId: string;
  taskId?: number | null;
  stage?: string | null;
  model: string;
  status: 'success' | 'failed';
  inputSummary: string;
  outputSummary: string;
  error?: string | null;
  durationMs: number;
}

/** 行转换：snake_case → camelCase（agent_executions） */
export function toExecution(row: AgentExecutionRow): AgentExecution {
  return {
    id: row.id,
    agentId: row.agent_id,
    taskId: row.task_id,
    stage: row.stage,
    model: row.model,
    status: row.status as AgentExecution['status'],
    inputSummary: row.input_summary,
    outputSummary: row.output_summary,
    error: row.error,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

/** 写入一次 Agent 执行日志（agent_executions 表），返回写入后的完整记录 */
export function logExecution(input: ExecutionLogInput): AgentExecution {
  const createdAt = new Date().toISOString();
  const res = run(
    'INSERT INTO agent_executions (agent_id, task_id, stage, model, status, input_summary, output_summary, error, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      input.agentId,
      input.taskId ?? null,
      input.stage ?? null,
      input.model,
      input.status,
      input.inputSummary,
      input.outputSummary,
      input.error ?? null,
      input.durationMs,
      createdAt,
    ],
  );
  const row = get<AgentExecutionRow>('SELECT * FROM agent_executions WHERE id = ?', [res.lastInsertRowid])!;
  return toExecution(row);
}
