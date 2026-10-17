/**
 * 任务级执行汇总与费用估算（delivery-ops B12）
 *
 * - 聚合 agent_executions 中 task_id 匹配的记录：耗时/次数/按阶段/按 Agent/模型/token
 * - 单价表：settings.modelPricing 优先，其次 backend/data/model-pricing.json
 *   （运行期数据目录本身被 gitignore，但该单价表是代码持续依赖的默认值，已单独白名单入库）；
 *   源码内零价目字面量。无可用单价表或均未命中实际模型时 cost = null（不臆造金额）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKFLOW_STAGE_LABELS, type TaskCostAgent, type TaskCostEstimate, type TaskCostStage, type TaskCostSummary } from '@workbench/shared';
import { all } from '../db/client.ts';
import type { AgentExecutionRow } from '../db/schema.ts';
import { getSetting } from './channel-settings.ts';

export interface ModelPricingEntry {
  inputPer1M: number;
  outputPer1M: number;
  currency: string;
}
export type ModelPricingTable = Record<string, ModelPricingEntry>;

/** 本地默认单价表路径（backend/data/ 整体忽略，此文件已白名单入库） */
const PRICING_FILE = join(import.meta.dirname, '..', '..', 'data', 'model-pricing.json');

/** 读取生效单价表：settings.modelPricing 优先，其次本地默认文件；均无 → null */
export function resolveModelPricing(): ModelPricingTable | null {
  const fromSettings = getSetting<ModelPricingTable>('modelPricing');
  if (fromSettings && Object.keys(fromSettings).length > 0) return fromSettings;
  try {
    if (existsSync(PRICING_FILE)) {
      const data = JSON.parse(readFileSync(PRICING_FILE, 'utf8')) as ModelPricingTable;
      if (data && Object.keys(data).length > 0) return data;
    }
  } catch {
    /* 本地配置缺失/损坏 → 无单价表 */
  }
  return null;
}

function agentNameMap(): Map<string, string> {
  const rows = all<{ id: string; name: string }>('SELECT id, name FROM agents');
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * 费用估算：只对单价表覆盖的模型计费；按第一覆盖模型的货币汇总（货币不一致的模型列入未计价）。
 * 无单价表或均未命中 → null。
 */
export function estimateCost(models: string[], inputTokens: number, outputTokens: number): TaskCostEstimate | null {
  const pricing = resolveModelPricing();
  if (!pricing) return null;
  const pricedModels = models.filter((m) => pricing[m]);
  if (pricedModels.length === 0) return null;

  const first = pricing[pricedModels[0]];
  const currency = first.currency;
  let amount = 0;
  const unpricedModels: string[] = [];
  for (const m of models) {
    const p = pricing[m];
    if (!p) {
      unpricedModels.push(m);
      continue;
    }
    if (p.currency !== currency) {
      unpricedModels.push(m); // 货币不一致不混算，避免给出错误数字
      continue;
    }
    amount += (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
  }
  amount = Math.round(amount * 100) / 100;

  return {
    currency,
    amount,
    estimated: true,
    pricingSource: getSetting<ModelPricingTable>('modelPricing') && Object.keys(getSetting<ModelPricingTable>('modelPricing') ?? {}).length > 0 ? 'settings' : 'local-default',
    unpricedModels,
    note: unpricedModels.length > 0 ? `部分模型未计价：${unpricedModels.join('、')}` : undefined,
  };
}

/** 任务级汇总（只读，不改 agent_executions 任何列） */
export function buildTaskCostSummary(taskId: number): TaskCostSummary {
  const rows = all<AgentExecutionRow>('SELECT * FROM agent_executions WHERE task_id = ? ORDER BY id ASC', [taskId]);
  const totalDurationMs = rows.reduce((s, r) => s + r.duration_ms, 0);
  const successRuns = rows.filter((r) => r.status === 'success').length;
  const failedRuns = rows.filter((r) => r.status === 'failed').length;

  // 按阶段分组
  const stageMap = new Map<string, AgentExecutionRow[]>();
  for (const r of rows) {
    const key = r.stage ?? 'unknown';
    const list = stageMap.get(key) ?? [];
    list.push(r);
    stageMap.set(key, list);
  }
  const byStage: TaskCostStage[] = [...stageMap.entries()].map(([stage, list]) => ({
    stage,
    stageLabel: WORKFLOW_STAGE_LABELS[stage] ?? stage,
    runs: list.length,
    durationMs: list.reduce((s, r) => s + r.duration_ms, 0),
    successRuns: list.filter((r) => r.status === 'success').length,
    failedRuns: list.filter((r) => r.status === 'failed').length,
  }));

  // 按 Agent 分组
  const names = agentNameMap();
  const agentMap = new Map<string, AgentExecutionRow[]>();
  for (const r of rows) {
    const list = agentMap.get(r.agent_id) ?? [];
    list.push(r);
    agentMap.set(r.agent_id, list);
  }
  const byAgent: TaskCostAgent[] = [...agentMap.entries()].map(([agentId, list]) => ({
    agentId,
    agentName: names.get(agentId) ?? agentId,
    runs: list.length,
    durationMs: list.reduce((s, r) => s + r.duration_ms, 0),
  }));

  const models = [...new Set(rows.map((r) => r.model).filter(Boolean))];

  const inputTokens = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
  const outputTokens = rows.reduce((s, r) => s + (r.output_tokens ?? 0), 0);
  const tokensEstimated = rows.some((r) => r.tokens_estimated === 1);
  const tokens = { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens, tokensEstimated };

  const firstStartedAt = rows.length > 0 ? rows[0].created_at : null;
  const lastFinishedAt = rows.length > 0 ? rows[rows.length - 1].created_at : null;

  return {
    taskId,
    totalDurationMs,
    runs: rows.length,
    successRuns,
    failedRuns,
    byStage,
    byAgent,
    models,
    tokens,
    cost: estimateCost(models, inputTokens, outputTokens),
    firstStartedAt,
    lastFinishedAt,
  };
}
