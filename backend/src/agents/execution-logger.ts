import type { AgentExecution } from '@workbench/shared';
import { get, run } from '../db/client.ts';
import type { AgentExecutionRow } from '../db/schema.ts';

/** 执行日志入参（各阶段 advance 产出后调用；B12 增 token 采集/估算） */
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
  /** 渠道真实 usage（LLM 调用）；缺省时按字符数估算 */
  inputTokens?: number;
  outputTokens?: number;
  /** true = 估算值；false/缺省 = 真实 usage */
  tokensEstimated?: boolean;
}

/** 行转换：snake_case → camelCase（agent_executions；token 为新增可选字段） */
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
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    tokensEstimated: row.tokens_estimated === 1,
  };
}

/**
 * 写入一次 Agent 执行日志（agent_executions 表），返回写入后的完整记录。
 * token 未显式传入时按「输入摘要 + 输出摘要」字符数估算（Math.ceil(chars/4)），并标记估算。
 */
export function logExecution(input: ExecutionLogInput): AgentExecution {
  const createdAt = new Date().toISOString();
  const hasReal = input.inputTokens != null && input.outputTokens != null;
  const inputTokens = hasReal ? Math.max(0, Math.floor(input.inputTokens ?? 0)) : Math.max(1, Math.ceil((input.inputSummary ?? '').length / 4));
  const outputTokens = hasReal ? Math.max(0, Math.floor(input.outputTokens ?? 0)) : Math.max(1, Math.ceil((input.outputSummary ?? '').length / 4));
  // 估算标记：显式传入则用之；否则「无真实 usage → 估算」
  const tokensEstimated = input.tokensEstimated !== undefined ? (input.tokensEstimated ? 1 : 0) : hasReal ? 0 : 1;
  const res = run(
    'INSERT INTO agent_executions (agent_id, task_id, stage, model, status, input_summary, output_summary, error, duration_ms, input_tokens, output_tokens, tokens_estimated, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
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
      inputTokens,
      outputTokens,
      tokensEstimated,
      createdAt,
    ],
  );
  const row = get<AgentExecutionRow>('SELECT * FROM agent_executions WHERE id = ?', [res.lastInsertRowid])!;
  return toExecution(row);
}
