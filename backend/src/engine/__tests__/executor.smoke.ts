/**
 * 图执行引擎冒烟测试（沙箱环境可用：node:test + tsx 单进程运行，无 fork/spawn）
 * 运行：pnpm --filter @workbench/backend exec tsx src/engine/__tests__/executor.smoke.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-smoke-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const shared = await import('@workbench/shared');
const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { service } = await import('../service.ts');
const { getDeliverable } = await import('../../delivery/store.ts');

const { STAGE_COPY, STAGE_MAIN_IMAGE, STAGE_REVIEW, STAGE_DETAIL_IMAGE, STAGE_REQUIREMENT, STAGE_DELIVER, APPROVAL_POINT_STAGES } = shared;

before(async () => {
  ensureSchema();
  seed();
});

test('创建任务进入规划中，看板列映射正确', () => {
  const task = service.createTask({ title: '测试商品', description: '测试', platforms: ['天猫'] });
  assert.equal(task.column, 'planned');
  assert.equal(task.stage, STAGE_REQUIREMENT);
  assert.ok(service.boardCounts().planned >= 1);
});

test('确认开工自动推进到确认点1（卖点文案）待确认', async () => {
  const t = service.createTask({ title: '确认测试', description: '', platforms: [] });
  const task = await service.confirmAndRun(t.id);
  assert.equal(task.column, 'awaiting');
  assert.ok(APPROVAL_POINT_STAGES.includes(task.stage));
});

test('确认点进入待确认，产出文案交付物，活动日志按时间线完整', async () => {
  const t = service.createTask({ title: '拍板测试', description: '', platforms: [] });
  const task = await service.confirmAndRun(t.id);
  assert.equal(task.column, 'awaiting');
  assert.equal(task.stage, STAGE_COPY);
  const copy = getDeliverable(task.id, 'copy', 'copy');
  assert.ok(copy);
  assert.equal(copy!.status, 'pending');
  const events = service.listEvents(task.id);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('TASK_CREATED'));
  assert.ok(types.includes('TASK_CONFIRMED'));
  assert.ok(types.includes('STAGE_COMPLETED'));
  for (let i = 1; i < events.length; i++) {
    assert.ok(new Date(events[i].createdAt).getTime() >= new Date(events[i - 1].createdAt).getTime());
  }
});

test('采纳沿 approved 边推进到主图设计（确认点2）', async () => {
  const t = service.createTask({ title: '采纳测试', description: '', platforms: [] });
  const task = await service.confirmAndRun(t.id);
  const approved = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
  assert.equal(approved.column, 'awaiting');
  assert.equal(approved.stage, STAGE_MAIN_IMAGE);
  assert.ok(getDeliverable(approved.id, 'main-image', 'image'));
});

test('打回沿 rejected 边返工再入待确认（deliverables 重置 pending）', async () => {
  const t = service.createTask({ title: '打回测试', description: '', platforms: [] });
  const task = await service.confirmAndRun(t.id);
  const rejected = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'reject', note: '标题不够吸引' });
  assert.equal(rejected.column, 'awaiting');
  assert.equal(rejected.stage, STAGE_COPY);
  const copy = getDeliverable(rejected.id, 'copy', 'copy');
  assert.equal(copy!.status, 'pending');
  assert.ok(service.listEvents(rejected.id).some((e) => e.type === 'REJECTED'));
});

test('逐张图片采纳联动：主图全采纳后进入详情图确认点待确认', async () => {
  const t = service.createTask({ title: '图片决策测试', description: '', platforms: [] });
  const task = await service.confirmAndRun(t.id);
  const approvedCopy = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
  assert.equal(approvedCopy.stage, STAGE_MAIN_IMAGE);
  const images = getDeliverable(approvedCopy.id, 'main-image', 'image')!;
  const list = JSON.parse(images.content) as { id: string }[];
  let cur = approvedCopy;
  for (const img of list) {
    cur = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
  }
  // 意见7：主图全采纳 → 详情图确认点待确认（不再自动推进）
  assert.equal(cur.column, 'awaiting');
  assert.equal(cur.stage, STAGE_DETAIL_IMAGE);
});

test('逐张图片打回联动：任一打回 → 返工重产出', async () => {
  const t = service.createTask({ title: '图片打回测试', description: '', platforms: [] });
  let task = await service.confirmAndRun(t.id);
  task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
  const images = getDeliverable(task.id, 'main-image', 'image')!;
  const list = JSON.parse(images.content) as { id: string }[];
  let cur = task;
  for (let i = 0; i < list.length; i++) {
    cur = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: list[i].id, decision: i === 0 ? 'reject' : 'approve' });
  }
  assert.equal(cur.column, 'awaiting');
  assert.equal(cur.stage, STAGE_MAIN_IMAGE);
  assert.ok(service.listEvents(task.id).some((e) => e.type === 'REJECTED'));
});

test('主管校对发现问题自动沿 rollback 边回退已完成→进行中', async () => {
  // 注入校对问题（模拟 LLM 主管发现主图文案不一致）
  process.env.WORKBENCH_REVIEW_ISSUE = STAGE_MAIN_IMAGE;
  try {
    const t = service.createTask({ title: '回退测试', description: '', platforms: [] });
    let task = await service.confirmAndRun(t.id);
    task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    const images = getDeliverable(task.id, 'main-image', 'image')!;
    const list = JSON.parse(images.content) as { id: string }[];
    for (const img of list) {
      task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
    }
    // 意见7：主图全采纳 → 详情图确认点待确认
    assert.equal(task.column, 'awaiting');
    assert.equal(task.stage, STAGE_DETAIL_IMAGE);
    // 详情图全采纳 → 进入校对 → 发现问题 → 回退主图返工重产出 → 重新待确认
    const detail = getDeliverable(task.id, 'detail-image', 'image')!;
    const dlist = JSON.parse(detail.content) as { id: string }[];
    for (const img of dlist) {
      task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
    }
    assert.equal(task.column, 'awaiting');
    assert.equal(task.stage, STAGE_MAIN_IMAGE);
    const events = service.listEvents(task.id);
    assert.ok(events.some((e) => e.type === 'REVIEW_ROLLBACK'), 'expected REVIEW_ROLLBACK event');
    // 返工后重产出交付物且重新待确认（detail 产出 + 回退重产出 → 版本 >= 2）
    const regen = getDeliverable(task.id, 'main-image', 'image')!;
    assert.ok(regen, 'expected regenerated image deliverable');
    assert.ok(regen.version >= 2, 'expected rework to bump image deliverable version');
    assert.equal(regen.status, 'pending');
  } finally {
    delete process.env.WORKBENCH_REVIEW_ISSUE;
  }
});

test('全链路：6 阶段自动走完并归档', async () => {
  const t = service.createTask({ title: '全链路测试', description: '', platforms: ['天猫+京东'] });
  let task = await service.confirmAndRun(t.id);
  task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
  const images = getDeliverable(task.id, 'main-image', 'image')!;
  const list = JSON.parse(images.content) as { id: string }[];
  for (const img of list) {
    task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
  }
  // 主图全采纳 → 详情图确认点待确认
  assert.equal(task.column, 'awaiting');
  assert.equal(task.stage, STAGE_DETAIL_IMAGE);
  // 详情图全采纳 → 校对自动放行 → 交付完成
  const detail = getDeliverable(task.id, 'detail-image', 'image')!;
  const dlist = JSON.parse(detail.content) as { id: string }[];
  for (const img of dlist) {
    task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
  }
  assert.equal(task.column, 'done');
  assert.equal(task.stage, STAGE_DELIVER);
  assert.equal(task.progress, 100);
  const events = service.listEvents(task.id);
  assert.ok(events.some((e) => e.type === 'REVIEW_PASSED'));
  assert.ok(events.some((e) => e.type === 'STAGE_COMPLETED' && e.payload.done === true));
});

test('编排开关可读（graph / linear）', async () => {
  const { getOrchestrationMode } = await import('../../db/seed.ts');
  assert.ok(['graph', 'linear'].includes(getOrchestrationMode()));
});

test('并行子任务逐张完成事件', async () => {
  const t = service.createTask({ title: '并行测试', description: '', platforms: [] });
  let task = await service.confirmAndRun(t.id);
  // 通过确认点1，进入主图并行产出
  task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
  const subEvents = service.listEvents(task.id).filter((e) => e.type === 'SUB_TASK_COMPLETE');
  assert.ok(subEvents.length >= 2, `expected >=2 SUB_TASK_COMPLETE, got ${subEvents.length}`);
});

console.log('✅ 图执行引擎 smoke 测试全部通过');
