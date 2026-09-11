/**
 * 9.6 WS 推送不冲掉角标与负责人：mergeTaskUpdate 单测。
 * 推送体（task:update）缺失 ownerName / kbRefsTotal / kbRefsInvalid / updatedAt 时保留旧值；
 * 携带时以新值为准；新条目（列表接口 TaskListItem）默认值齐全。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeTaskUpdate, taskWithMeta, type TaskWithMeta } from '../taskMerge.ts';
import type { Task } from '@workbench/shared';

function baseTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: '磁吸充电宝新品上架',
    workflowId: 'wf-new-product',
    description: '新品全套物料',
    platform: '',
    platforms: ['天猫'],
    column: 'awaiting',
    stage: 'copy',
    progress: 33,
    stageNote: '',
    referenceImage: '',
    createdBy: '你',
    archived: false,
    createdAt: '2026-09-11T08:00:00.000Z',
    ...over,
  } as Task;
}

describe('9.6 mergeTaskUpdate（推送体缺失元字段时保留旧值）', () => {
  test('缺 ownerName/kbRefsTotal/kbRefsInvalid/updatedAt → 保留旧值', () => {
    const prev: TaskWithMeta = {
      ...baseTask(),
      ownerName: '美美',
      stageLabel: '卖点文案',
      kbRefsTotal: 3,
      kbRefsInvalid: 1,
      updatedAt: '2026-09-11T09:00:00.000Z',
    };
    // 模拟 WS task:update 推送体（仅核心字段 + 状态推进）
    const incoming = baseTask({ column: 'progress', stage: 'main-image', progress: 55 });
    const merged = mergeTaskUpdate(prev, incoming);
    assert.equal(merged.ownerName, '美美', '负责人名保留');
    assert.equal(merged.kbRefsTotal, 3, '角标总数保留');
    assert.equal(merged.kbRefsInvalid, 1, '失效数保留');
    assert.equal(merged.updatedAt, '2026-09-11T09:00:00.000Z', 'updatedAt 保留');
    assert.equal(merged.column, 'progress');
    assert.equal(merged.stage, 'main-image');
  });

  test('推送体携带元字段时以新值为准', () => {
    const prev: TaskWithMeta = { ...baseTask(), ownerName: '美美', stageLabel: '卖点文案', kbRefsTotal: 3, kbRefsInvalid: 1 };
    // 推送体（Task 契约）携带元字段：以新值为准
    const incoming = { ...baseTask({ column: 'done', stage: 'deliver' }), kbRefsTotal: 0, kbRefsInvalid: 0 } as Task;
    const merged = mergeTaskUpdate(prev, incoming);
    assert.equal(merged.kbRefsTotal, 0);
    assert.equal(merged.kbRefsInvalid, 0);
  });

  test('新条目（列表接口）元字段齐全', () => {
    const t = taskWithMeta({ ...baseTask({ id: 2, stage: 'detail-image' }), kbRefsTotal: 2, kbRefsInvalid: 0 } as Task & Partial<TaskWithMeta>);
    assert.equal(t.ownerName, '');
    assert.equal(t.stageLabel, '详情图设计');
    assert.equal(t.kbRefsTotal, 2);
  });
});
