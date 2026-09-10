import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// 先设置独立临时数据库，再动态加载后端模块（保证 client.ts 在 env 设置后初始化）
const dir = mkdtempSync(join(tmpdir(), 'workbench-test-'));
process.env.WORKBENCH_DB = join(dir, 'test.db');

const shared = await import('@workbench/shared');
const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { service } = await import('../service.ts');
const { getDeliverable } = await import('../../delivery/store.ts');

const {
  STAGE_COPY,
  STAGE_MAIN_IMAGE,
  STAGE_DETAIL_IMAGE,
  STAGE_REQUIREMENT,
  STAGE_DELIVER,
  APPROVAL_POINT_STAGES,
} = shared;

beforeAll(() => {
  ensureSchema();
  seed();
});

describe('TaskExecutor 图执行引擎（tasks 2.3/2.4/2.5）', () => {
  it('创建任务进入规划中，看板列映射正确', () => {
    const task = service.createTask({ title: '测试商品', description: '测试', platforms: ['天猫'] });
    expect(task.column).toBe('planned');
    expect(task.stage).toBe(STAGE_REQUIREMENT);
    const counts = service.boardCounts();
    expect(counts.planned).toBeGreaterThanOrEqual(1);
  });

  it('确认开工自动推进到确认点1（卖点文案）待确认', async () => {
    const t = service.createTask({ title: '确认测试', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    expect(task.column).toBe('awaiting');
    expect(APPROVAL_POINT_STAGES).toContain(task.stage);
  });

  it('确认点进入待确认，产出文案交付物，活动日志按时间线完整', async () => {
    const t = service.createTask({ title: '拍板测试', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    expect(task.column).toBe('awaiting');
    expect(task.stage).toBe(STAGE_COPY);
    const copy = getDeliverable(task.id, 'copy', 'copy');
    expect(copy).toBeDefined();
    expect(copy!.status).toBe('pending');
    const events = service.listEvents(task.id);
    const types = events.map((e) => e.type);
    expect(types).toContain('TASK_CREATED');
    expect(types).toContain('TASK_CONFIRMED');
    expect(types).toContain('STAGE_COMPLETED');
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(events[i - 1].createdAt).getTime());
    }
  });

  it('采纳沿 approved 边推进到主图设计（确认点2）', async () => {
    const t = service.createTask({ title: '采纳测试', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    const approved = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    expect(approved.column).toBe('awaiting');
    expect(approved.stage).toBe(STAGE_MAIN_IMAGE);
    const images = getDeliverable(approved.id, 'main-image', 'image');
    expect(images).toBeDefined();
  });

  it('打回沿 rejected 边返工再入待确认（deliverables 重置 pending）', async () => {
    const t = service.createTask({ title: '打回测试', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    const rejected = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'reject', note: '标题不够吸引' });
    expect(rejected.column).toBe('awaiting');
    expect(rejected.stage).toBe(STAGE_COPY);
    const copy = getDeliverable(rejected.id, 'copy', 'copy');
    expect(copy!.status).toBe('pending');
    const events = service.listEvents(rejected.id);
    expect(events.some((e) => e.type === 'REJECTED')).toBe(true);
  });

  it('逐张图片采纳联动：主图全采纳后进入详情图确认点待确认', async () => {
    const t = service.createTask({ title: '图片决策测试', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    const approvedCopy = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    expect(approvedCopy.stage).toBe(STAGE_MAIN_IMAGE);
    const images = getDeliverable(approvedCopy.id, 'main-image', 'image')!;
    const list = JSON.parse(images.content) as { id: string }[];
    let cur = approvedCopy;
    for (const img of list) {
      cur = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
    }
    // 意见7：主图全采纳 → 详情图确认点待确认（不再自动推进）
    expect(cur.stage).toBe(STAGE_DETAIL_IMAGE);
    expect(cur.column).toBe('awaiting');
  });

  it('逐张图片打回联动：任一打回 → 返工重产出', async () => {
    const t = service.createTask({ title: '图片打回测试', description: '', platforms: [] });
    let task = await service.confirmAndRun(t.id);
    task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    const images = getDeliverable(task.id, 'main-image', 'image')!;
    const list = JSON.parse(images.content) as { id: string }[];
    let cur = task;
    for (let i = 0; i < list.length; i++) {
      cur = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: list[i].id, decision: i === 0 ? 'reject' : 'approve' });
    }
    // 有打回 → 主图返工并重产出 → 重新待确认
    expect(cur.column).toBe('awaiting');
    expect(cur.stage).toBe(STAGE_MAIN_IMAGE);
    const events = service.listEvents(task.id);
    expect(events.some((e) => e.type === 'REJECTED')).toBe(true);
  });

  it('终审沿 rollback 边回退已完成→进行中', async () => {
    // 注入校对问题（模拟 LLM 主管发现主图文案不一致），走自动回退路径
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
      expect(task.stage).toBe(STAGE_DETAIL_IMAGE);
      // 详情图全采纳 → 校对发现主图问题 → 自动沿 rollback 回退主图返工重产出 → 重新待确认
      const detail = getDeliverable(task.id, 'detail-image', 'image')!;
      const dlist = JSON.parse(detail.content) as { id: string }[];
      for (const img of dlist) {
        task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
      }
      expect(task.column).toBe('awaiting');
      expect(task.stage).toBe(STAGE_MAIN_IMAGE);
      expect(service.listEvents(task.id).some((e) => e.type === 'REVIEW_ROLLBACK')).toBe(true);
      const regen = getDeliverable(task.id, 'main-image', 'image')!;
      expect(regen).toBeDefined();
      expect(regen.version).toBeGreaterThanOrEqual(2);
    } finally {
      delete process.env.WORKBENCH_REVIEW_ISSUE;
    }
  });

  it('全链路：6 阶段走完并归档', async () => {
    const t = service.createTask({ title: '全链路测试', description: '', platforms: ['天猫+京东'] });
    let task = await service.confirmAndRun(t.id);
    task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    const images = getDeliverable(task.id, 'main-image', 'image')!;
    const list = JSON.parse(images.content) as { id: string }[];
    for (const img of list) {
      task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
    }
    // 意见7：主图全采纳 → 详情图确认点待确认
    expect(task.stage).toBe(STAGE_DETAIL_IMAGE);
    expect(task.column).toBe('awaiting');
    // 详情图全采纳 → 校对自动放行 → 交付完成
    const detail = getDeliverable(task.id, 'detail-image', 'image')!;
    const dlist = JSON.parse(detail.content) as { id: string }[];
    for (const img of dlist) {
      task = await service.decideDeliverable({ taskId: task.id, kind: 'image', imageId: img.id, decision: 'approve' });
    }
    expect(task.column).toBe('done');
    expect(task.stage).toBe(STAGE_DELIVER);
    expect(task.progress).toBe(100);
    const events = service.listEvents(task.id);
    expect(events.some((e) => e.type === 'REVIEW_PASSED')).toBe(true);
    expect(events.some((e) => e.type === 'STAGE_COMPLETED' && e.payload.done === true)).toBe(true);
  });

  it('编排开关可读（graph / linear）', async () => {
    const { getOrchestrationMode } = await import('../../db/seed.ts');
    expect(['graph', 'linear']).toContain(getOrchestrationMode());
  });

  it('并行子任务逐张完成事件', async () => {
    const t = service.createTask({ title: '并行测试', description: '', platforms: [] });
    let task = await service.confirmAndRun(t.id);
    task = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    const events = service.listEvents(task.id);
    const subEvents = events.filter((e) => e.type === 'SUB_TASK_COMPLETE');
    expect(subEvents.length).toBeGreaterThanOrEqual(2);
  });
});
