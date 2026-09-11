/**
 * 返工上下文测试（OpenSpec quality-loop · rework-context，T1 梯队）。
 * 运行：pnpm --filter @workbench/backend exec tsx src/engine/__tests__/rework.test.ts
 *
 * 覆盖：3.1 事件读取 / 3.2 阶段匹配与产出后失效 / 3.3 注入文本组装。
 * 不依赖知识库；直接向 tasks / task_events 表 INSERT 构造数据。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-rework-'));
process.env.WORKBENCH_DB = join(dir, 'rework.db');

const { ensureSchema } = await import('../../db/ensure.ts');
const { run } = await import('../../db/client.ts');
const { readReworkEvents, getReworkInfo, getPendingRework, assembleReworkText, MAX_REWORK_NOTE_LEN } = await import('../rework.ts');
const { WORKFLOW_STAGE_LABELS } = await import('@workbench/shared');

/** 固定基准时间 + 秒偏移，保证 ISO 字符串字典序与时间序一致 */
const T0 = Date.parse('2026-09-01T00:00:00.000Z');
const at = (sec: number): string => new Date(T0 + sec * 1000).toISOString();

function createTask(stage: string): number {
  return run(
    `INSERT INTO tasks (title, workflow_id, stage, column, created_at) VALUES (?, ?, ?, 'planned', ?)`,
    ['返工测试任务', 'ecom-new-listing', stage, at(0)],
  ).lastInsertRowid;
}

function addEvent(taskId: number, type: string, payload: Record<string, unknown>, atTime: string): void {
  run(`INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, ?, ?, ?)`, [
    taskId,
    type,
    JSON.stringify(payload),
    atTime,
  ]);
}

before(() => {
  ensureSchema();
});

// ===================== 3.1 事件读取 =====================

describe('3.1 读取返工事件', () => {
  test('REJECTED + REVIEW_ROLLBACK 均计入，按时间升序返回完整记录', () => {
    const taskId = createTask('copy');
    const t1 = at(1);
    const t2 = at(2);
    addEvent(taskId, 'REJECTED', { stage: 'copy', stageLabel: '卖点文案', note: '规格数值与产品资料不符' }, t1);
    addEvent(taskId, 'REVIEW_ROLLBACK', { fromStage: 'review', targetStage: 'main-image', targetLabel: '主图设计', note: '主图与文案不一致' }, t2);

    const info = getReworkInfo(taskId);
    assert.equal(info.count, 2);
    assert.equal(info.records.length, 2);
    assert.deepEqual(
      info.records.map((r) => r.stage),
      ['copy', 'main-image'],
      'REJECTED 取 payload.stage，REVIEW_ROLLBACK 取 payload.targetStage',
    );
    assert.deepEqual(
      info.records.map((r) => r.note),
      ['规格数值与产品资料不符', '主图与文案不一致'],
    );
    assert.deepEqual(
      info.records.map((r) => r.at),
      [t1, t2],
      '应按时间（id）升序',
    );
  });

  test('无事件的任务 → count=0、records 为空数组', () => {
    const taskId = createTask('copy');
    assert.deepEqual(getReworkInfo(taskId), { count: 0, records: [] });
  });

  test('payload 非 JSON / 缺 stage 的事件被容错跳过，不影响其余记录', () => {
    const taskId = createTask('copy');
    addEvent(taskId, 'REJECTED', { stage: 'copy', note: '有效意见' }, at(1));
    run(`INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?, 'REJECTED', 'not-json', ?)`, [taskId, at(2)]);
    addEvent(taskId, 'REJECTED', { note: '缺 stage' }, at(3));
    addEvent(taskId, 'REVIEW_ROLLBACK', { fromStage: 'review', targetLabel: '主图设计', note: '缺 targetStage' }, at(4));

    const records = readReworkEvents(taskId);
    assert.equal(records.length, 1, '仅保留可确定阶段的事件');
    assert.equal(records[0].note, '有效意见');
  });

  test('note 缺失时为空串；非字符串 payload.note 按空串处理', () => {
    const taskId = createTask('copy');
    addEvent(taskId, 'REJECTED', { stage: 'copy' }, at(1));
    const info = getReworkInfo(taskId);
    assert.equal(info.count, 1);
    assert.equal(info.records[0].note, '');
  });
});

// ===================== 3.2 阶段匹配与产出后失效 =====================

describe('3.2 阶段匹配与产出后失效判定', () => {
  test('latest：currentStage 匹配目标阶段时取时间最近一条', () => {
    const taskId = createTask('main-image');
    const t1 = at(1);
    const t2 = at(2);
    addEvent(taskId, 'REJECTED', { stage: 'copy', note: '规格数值与产品资料不符' }, t1);
    addEvent(taskId, 'REVIEW_ROLLBACK', { fromStage: 'review', targetStage: 'main-image', note: '主图与文案不一致' }, t2);

    const pending = getPendingRework(taskId, 'main-image');
    assert.equal(pending.latest?.stage, 'main-image');
    assert.equal(pending.latest?.note, '主图与文案不一致');
    assert.equal(pending.latest?.at, t2);
    assert.equal(pending.stageCount, 1, '当前阶段仅计 main-image 的返工');
    assert.equal(pending.totalCount, 2, '任务累计返工为全部两条');
  });

  test('阶段不匹配：其他阶段返工不计入，latest=null；匹配阶段则非空', () => {
    const taskId = createTask('copy');
    addEvent(taskId, 'REJECTED', { stage: 'copy', note: '规格数值与产品资料不符' }, at(1));

    const other = getPendingRework(taskId, 'main-image');
    assert.equal(other.latest, null, 'REJECTED(stage=copy) 不匹配 currentStage=main-image');
    assert.equal(other.stageCount, 0);
    assert.equal(other.totalCount, 1, '任务累计返工仍计入');

    const matched = getPendingRework(taskId, 'copy');
    assert.notEqual(matched.latest, null);
    assert.equal(matched.latest?.stage, 'copy');
    assert.equal(matched.latest?.note, '规格数值与产品资料不符');
  });

  test('产出后失效：STAGE_COMPLETED 之后的新意见才待处理；再产出后全部失效', () => {
    const taskId = createTask('copy');
    const t1 = at(1);
    const t2 = at(2);
    const t3 = at(3);
    const t4 = at(4);
    addEvent(taskId, 'REJECTED', { stage: 'copy', note: '第一条' }, t1);
    addEvent(taskId, 'STAGE_COMPLETED', { stage: 'copy', stageLabel: '卖点文案' }, t2);
    addEvent(taskId, 'REJECTED', { stage: 'copy', note: '第二条' }, t3);

    const pending = getPendingRework(taskId, 'copy');
    assert.equal(pending.latest?.note, '第二条', 't1 的意见已被 t2 的产出覆盖失效');
    assert.equal(pending.stageCount, 2, '该阶段累计返工仍为两次');

    addEvent(taskId, 'STAGE_COMPLETED', { stage: 'copy', stageLabel: '卖点文案' }, t4);
    const after = getPendingRework(taskId, 'copy');
    assert.equal(after.latest, null, '第二条意见已被 t4 的产出覆盖失效');
    assert.equal(after.stageCount, 2);
  });

  test('REVIEW_ROLLBACK 计入目标阶段：回退后无新产出则视为待处理意见', () => {
    const taskId = createTask('copy');
    addEvent(taskId, 'REVIEW_ROLLBACK', { fromStage: 'review', targetStage: 'copy', targetLabel: '卖点文案', note: '文案需要重写' }, at(1));

    const pending = getPendingRework(taskId, 'copy');
    assert.notEqual(pending.latest, null);
    assert.equal(pending.latest?.stage, 'copy');
    assert.equal(pending.latest?.note, '文案需要重写');
    assert.equal(pending.stageCount, 1, '回退意见计入目标阶段 copy');
  });

  test('currentStage 缺省时从 tasks 表读取当前 stage', () => {
    const taskId = createTask('copy');
    addEvent(taskId, 'REJECTED', { stage: 'copy', note: '自动匹配阶段' }, at(1));

    const pending = getPendingRework(taskId);
    assert.equal(pending.latest?.stage, 'copy');
    assert.equal(pending.latest?.note, '自动匹配阶段');
  });

  test('任务不存在 → 空结果不抛错', () => {
    assert.deepEqual(getPendingRework(999999), { latest: null, stageCount: 0, totalCount: 0 });
  });
});

// ===================== 3.3 注入文本组装 =====================

describe('3.3 组装返工注入文本', () => {
  test('正常意见：含段标题、阶段标签、次数、意见原文与约束', () => {
    const text = assembleReworkText('copy', 2, '意见');
    assert.ok(text.includes('【上次返工意见】'), '段标题必须精确为【上次返工意见】');
    assert.ok(text.includes(WORKFLOW_STAGE_LABELS['copy']), `应含阶段标签 ${WORKFLOW_STAGE_LABELS['copy']}`);
    assert.ok(text.includes('2 次'));
    assert.ok(text.includes('「意见」'), '应含意见原文');
    assert.ok(text.includes('不得原样重复上次产出'));
    assert.ok(text.includes('只针对意见所指问题修改'));
  });

  test('超长意见（>500 字符）截断并标注（已截断）', () => {
    const longNote = '甲'.repeat(600);
    const text = assembleReworkText('main-image', 3, longNote);
    assert.ok(text.includes('（已截断）'));
    assert.ok(!text.includes(longNote), '不得包含完整原文');
    // 截断后的意见原文 = 前 500 字符 + 标记
    assert.ok(text.includes(`「${'甲'.repeat(MAX_REWORK_NOTE_LEN)}…（已截断）」`));
    assert.ok(text.includes('3 次'));
  });

  test('恰好 500 字符不截断', () => {
    const note = '乙'.repeat(MAX_REWORK_NOTE_LEN);
    const text = assembleReworkText('copy', 1, note);
    assert.ok(text.includes(`「${note}」`));
    assert.ok(!text.includes('（已截断）'));
  });

  test('未知阶段 id 回退为原始 id', () => {
    const text = assembleReworkText('unknown-stage', 1, '意见');
    assert.ok(text.includes('（unknown-stage）'));
  });
});
