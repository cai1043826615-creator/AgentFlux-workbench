/**
 * B2 · 返工上下文集成测试（rework-context）—— 注入通道与路由查询。
 * 运行：node backend/src/engine/__tests__/rework-integration.test.ts
 *
 * 覆盖 OpenSpec 任务：3.4（buildProducerSystemPrompt 注入与无返工快照一致）、3.5（reviewRollback 意见注入）、3.6（GET /api/tasks/:id/rework）
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'workbench-reworkint-'));
process.env.WORKBENCH_DB = join(dir, 'rework.db');
process.env.NODE_ENV = 'test';

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { run } = await import('../../db/client.ts');
const { service } = await import('../service.ts');
const { buildProducerSystemPrompt, buildSystemPrompt } = await import('../../agents/smart-producer.ts');
const { buildKnowledgeContext } = await import('../../knowledge/refs.ts');
const { buildApp } = await import('../../index.ts');

let app: FastifyInstance;

before(async () => {
  ensureSchema();
  seed();
  app = await buildApp();
  await app.ready();
});

const BASE = '你是文案 Agent，负责输出电商文案。';

/** 相对确认开工时刻「稍后」的时间戳（严格晚于确认产生的 STAGE_COMPLETED，满足 e.at > lastCompleted） */
function laterThanConfirm(): string {
  return new Date(Date.now() + 1000).toISOString();
}

function logEvent(taskId: number, type: string, payload: Record<string, unknown>, createdAt: string) {
  run('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?,?,?,?)', [taskId, type, JSON.stringify(payload), createdAt]);
}

describe('3.4 返工意见注入 buildProducerSystemPrompt', () => {
  test('无返工意见时与改动前快照逐字符一致', async () => {
    const t = service.createTask({ title: '快照一致', description: '', platforms: [] });
    const withMounts = await buildSystemPrompt('agent-copy', BASE);
    const kb = await buildKnowledgeContext(t.id);
    const before = kb ? `${withMounts}\n\n${kb}` : withMounts;
    const after = await buildProducerSystemPrompt('agent-copy', BASE, t.id);
    assert.equal(after, before, '无返工意见时 prompt 与改动前逐字符一致');
  });

  test('有返工意见时包含意见原文与阶段标记', async () => {
    const t = service.createTask({ title: '意见注入', description: '', platforms: [] });
    await service.confirmAndRun(t.id); // 任务进入 copy 确认点（当前 stage=copy）
    // 打回意见（stage=copy，时间晚于确认产生的 STAGE_COMPLETED → 处于待处理）
    logEvent(t.id, 'REJECTED', { stage: 'copy', stageLabel: '卖点文案', note: '规格数值与产品资料不符，请核对电芯容量' }, laterThanConfirm());
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, t.id);
    assert.ok(prompt.includes('【上次返工意见】'), '包含【上次返工意见】段');
    assert.ok(prompt.includes('规格数值与产品资料不符，请核对电芯容量'), '包含意见原文');
    assert.ok(prompt.includes('卖点文案'), '包含打回阶段标记');
    assert.ok(prompt.includes('不得原样重复上次产出'), '包含修改要求');
  });

  test('意见被重新产出消费后不再注入（产出后失效）', async () => {
    const t = service.createTask({ title: '意见失效', description: '', platforms: [] });
    await service.confirmAndRun(t.id);
    logEvent(t.id, 'REJECTED', { stage: 'copy', stageLabel: '卖点文案', note: '标题太弱' }, laterThanConfirm());
    // 返工产出完成 → 该意见失效
    logEvent(t.id, 'STAGE_COMPLETED', { stage: 'copy' }, laterThanConfirm());
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, t.id);
    assert.ok(!prompt.includes('【上次返工意见】'), '消费后不再注入');
    assert.ok(!prompt.includes('标题太弱'), '不残留旧意见');
  });

  test('taskId 为空时与纯 base 行为一致（无返工段）', async () => {
    const withMounts = await buildSystemPrompt('agent-copy', BASE);
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, undefined);
    assert.equal(prompt, withMounts);
  });
});

describe('3.5 主管校对回退意见同样注入', () => {
  test('reviewRollback 到 copy 后，下一次 copy 阶段产出 prompt 含回退意见', async () => {
    const t = service.createTask({ title: '回退注入', description: '', platforms: [] });
    await service.confirmAndRun(t.id); // 当前 stage=copy
    // 构造回退事件（等价 reviewDecision('rollback','copy',note) 的效果；advance 会同步重产出并消费该意见，
    // 故此处直接造事件验证「回退意见尚未被消费时注入」的中间态，与 3.4 失效用例互补）
    logEvent(t.id, 'REVIEW_ROLLBACK', { fromStage: 'review', targetStage: 'copy', targetLabel: '卖点文案', note: '主图与文案信息不一致，请返工' }, laterThanConfirm());
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, t.id);
    assert.ok(prompt.includes('主图与文案信息不一致，请返工'), '回退意见注入 prompt');
    assert.ok(prompt.includes('【上次返工意见】'));
    assert.equal(service.rework(t.id).count, 1, '返工次数统计包含回退');
    // 消费后失效（与 3.4 失效规则一致）：追加一次 copy 产出完成
    logEvent(t.id, 'STAGE_COMPLETED', { stage: 'copy' }, laterThanConfirm());
    const consumed = await buildProducerSystemPrompt('agent-copy', BASE, t.id);
    assert.ok(!consumed.includes('【上次返工意见】'), '回退意见被产出消费后不再注入');
  });
});

describe('3.6 返工查询接口', () => {
  test('GET /api/tasks/:id/rework 返回记录顺序与内容正确', async () => {
    const t = service.createTask({ title: '返工记录', description: '', platforms: [] });
    logEvent(t.id, 'REJECTED', { stage: 'copy', stageLabel: '卖点文案', note: '第一次打回' }, '2026-09-11T01:00:00.000Z');
    logEvent(t.id, 'REVIEW_ROLLBACK', { fromStage: 'review', targetStage: 'main-image', targetLabel: '主图设计', note: '第二次回退' }, '2026-09-11T02:00:00.000Z');
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/rework` });
    assert.equal(res.statusCode, 200);
    const { rework } = res.json() as { rework: { count: number; records: { stage: string; note: string; at: string }[] } };
    assert.equal(rework.count, 2);
    assert.equal(rework.records.length, 2);
    // 按时间升序
    assert.equal(rework.records[0].stage, 'copy');
    assert.equal(rework.records[0].note, '第一次打回');
    assert.equal(rework.records[1].stage, 'main-image');
    assert.equal(rework.records[1].note, '第二次回退');
    assert.ok(new Date(rework.records[1].at).getTime() > new Date(rework.records[0].at).getTime());
  });

  test('无返工任务返回 count=0 与空数组', async () => {
    const t = service.createTask({ title: '无返工', description: '', platforms: [] });
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/rework` });
    const { rework } = res.json() as { rework: { count: number; records: unknown[] } };
    assert.equal(rework.count, 0);
    assert.deepEqual(rework.records, []);
  });
});
