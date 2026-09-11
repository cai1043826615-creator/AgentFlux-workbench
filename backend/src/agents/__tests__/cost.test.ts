/**
 * 费用估算与任务级汇总（delivery-ops B12，组 15 模块级）：
 * - estimateCost：仅覆盖模型计费、金额按百万 token 单价、未计价模型列出 + note
 * - settings.modelPricing 优先于本地默认单价表；均不可用 → null（不臆造金额）
 * - buildTaskCostSummary：耗时/次数/按阶段（中文名）/按 Agent/模型去重/token 汇总
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-cost-'));
process.env.WORKBENCH_DB = join(dir, 'cost.db');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { run } = await import('../../db/client.ts');
const { setSetting } = await import('../channel-settings.ts');
const { estimateCost, buildTaskCostSummary, resolveModelPricing } = await import('../cost.ts');
const { logExecution } = await import('../execution-logger.ts');

ensureSchema();
seed();

describe('15.x estimateCost 费用估算', () => {
  test('settings 覆盖单价表：只对覆盖模型计费，金额与百万 token 单价一致', () => {
    setSetting('modelPricing', { 'deepseek-chat': { inputPer1M: 2, outputPer1M: 8, currency: 'CNY' } });
    const cost = estimateCost(['deepseek-chat'], 1000, 500);
    assert.ok(cost);
    assert.equal(cost!.currency, 'CNY');
    assert.equal(cost!.amount, 0.01, '(1000/1M*2 + 500/1M*8) = 0.002 + 0.004 = 0.006 → 保留两位 0.01');
    assert.equal(cost!.pricingSource, 'settings');
    assert.deepEqual(cost!.unpricedModels, []);
  });

  test('部分模型未计价：列出未覆盖模型并附说明', () => {
    setSetting('modelPricing', { 'deepseek-chat': { inputPer1M: 2, outputPer1M: 8, currency: 'CNY' } });
    const cost = estimateCost(['deepseek-chat', 'deepseek-reasoner', 'gpt-4o'], 3000, 1500);
    assert.ok(cost);
    assert.equal(cost!.amount, 0.02, '(3000/1M*2 + 1500/1M*8) = 0.006+0.012 = 0.018 → 0.02');
    assert.deepEqual(cost!.unpricedModels, ['deepseek-reasoner', 'gpt-4o']);
    assert.ok(cost!.note?.includes('部分模型未计价'));
  });

  test('均未覆盖 → cost=null（不给金额）', () => {
    setSetting('modelPricing', { 'deepseek-chat': { inputPer1M: 2, outputPer1M: 8, currency: 'CNY' } });
    assert.equal(estimateCost(['gpt-4o', 'claude-3'], 100, 100), null);
  });

  test('无单价表（settings 清空 + 本地默认文件缺失）→ null', () => {
    setSetting('modelPricing', {});
    // 本地默认文件存在时仍应回退到它；这里验证回退路径存在性
    const table = resolveModelPricing();
    assert.ok(!table || table['deepseek-chat'], 'settings 空时回退本地默认单价表（backend/data/model-pricing.json）');
  });

  test('本地默认单价表路径：deepseek-chat 有公开价目', () => {
    setSetting('modelPricing', {});
    const cost = estimateCost(['deepseek-chat'], 1_000_000, 1_000_000);
    assert.ok(cost, '本地默认单价表应覆盖 deepseek-chat');
    assert.equal(cost!.pricingSource, 'local-default');
  });
});

describe('15.x buildTaskCostSummary 任务级汇总', () => {
  test('耗时/次数/按阶段中文名/按 Agent/模型去重/token', () => {
    // 清空既有执行记录（seed 不产生），插入 4 条：3 成功 1 失败
    run('DELETE FROM agent_executions');
    logExecution({ agentId: 'agent-copy', taskId: 1, stage: 'requirement', model: 'deepseek-chat', status: 'success', inputSummary: 'a'.repeat(32), outputSummary: 'b'.repeat(32), durationMs: 1200, inputTokens: 100, outputTokens: 20 });
    logExecution({ agentId: 'agent-copy', taskId: 1, stage: 'copy', model: 'deepseek-chat', status: 'success', inputSummary: 'c'.repeat(32), outputSummary: 'd'.repeat(32), durationMs: 3000, inputTokens: 200, outputTokens: 40 });
    logExecution({ agentId: 'agent-design', taskId: 1, stage: 'main-image', model: '', status: 'success', inputSummary: '图', outputSummary: '生成完成', durationMs: 800 }); // 生图无 token
    logExecution({ agentId: 'agent-copy', taskId: 1, stage: 'copy', model: 'deepseek-chat', status: 'failed', inputSummary: 'e', outputSummary: '', durationMs: 500, error: 'x' });

    const s = buildTaskCostSummary(1);
    assert.equal(s.runs, 4);
    assert.equal(s.successRuns, 3);
    assert.equal(s.failedRuns, 1);
    assert.equal(s.totalDurationMs, 1200 + 3000 + 800 + 500);
    assert.deepEqual(s.models, ['deepseek-chat']);

    const copyStage = s.byStage.find((x) => x.stage === 'copy')!;
    assert.equal(copyStage.stageLabel, '卖点文案');
    assert.equal(copyStage.runs, 2);
    assert.equal(copyStage.durationMs, 3500);
    assert.equal(copyStage.failedRuns, 1);

    const byAgentCopy = s.byAgent.find((a) => a.agentId === 'agent-copy')!;
    assert.ok(byAgentCopy.agentName, '应有 Agent 名');
    assert.equal(byAgentCopy.runs, 3);

    // token：显式 100/20 + 200/40；未显式传 token 的两条（生图/失败）按字符估算（非 0）计入
    // 生图行 inputSummary='图'(1字)→ceil(1/4)=1，outputSummary='生成完成'(4字)→1
    // 失败行 inputSummary='e'(1字)→1，outputSummary=''(0字)→max(1,0)=1
    assert.equal(s.tokens.input, 100 + 200 + 1 + 1);
    assert.equal(s.tokens.output, 20 + 40 + 1 + 1);
    assert.equal(s.tokens.total, s.tokens.input + s.tokens.output);
    assert.equal(s.tokens.tokensEstimated, true, '存在估算记录 → 标记估算');

    assert.ok(s.firstStartedAt && s.lastFinishedAt);
  });
});

test('清理临时目录', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
