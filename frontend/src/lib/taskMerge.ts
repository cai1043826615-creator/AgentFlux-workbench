/**
 * 任务元数据合并（9.6：WS 推送不冲掉角标与负责人）。
 * upsertTask 的唯一合并口径：推送体（task:update）来自后端 bus 广播，
 * 仅含 Task 核心字段；ownerName / kbRefsTotal / kbRefsInvalid / updatedAt /
 * stageLabel 等展示元字段缺失时显式保留旧值（不覆盖为默认）。
 */
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import type { Task } from '@workbench/shared';

/** 看板/列表共用的任务展示元数据（来自 GET /api/tasks 的 TaskListItem） */
export interface TaskWithMeta extends Task {
  ownerName: string;
  stageLabel: string;
  /** 关联资料总份数（B6；知识库不可用时降级为 0） */
  kbRefsTotal: number;
  /** 其中已失效份数 */
  kbRefsInvalid: number;
  /** 最近一次阶段/交付物变动时间（updatedAt 排序口径） */
  updatedAt?: string;
}

/** 新条目（来自列表接口）→ 带默认元字段 */
export function taskWithMeta(t: Task): TaskWithMeta {
  const partial = t as Partial<TaskWithMeta>;
  return {
    ...t,
    ownerName: partial.ownerName ?? '',
    stageLabel: partial.stageLabel ?? WORKFLOW_STAGE_LABELS[t.stage] ?? t.stage,
    kbRefsTotal: partial.kbRefsTotal ?? 0,
    kbRefsInvalid: partial.kbRefsInvalid ?? 0,
    updatedAt: partial.updatedAt,
  };
}

/** 推送体合并：缺失的展示元字段保留旧值（9.6 单测对象） */
export function mergeTaskUpdate(prev: TaskWithMeta, incoming: Task): TaskWithMeta {
  const i = incoming as Partial<TaskWithMeta>;
  return {
    ...prev,
    ...incoming,
    ownerName: i.ownerName ?? prev.ownerName,
    stageLabel: i.stageLabel ?? (WORKFLOW_STAGE_LABELS[incoming.stage] ?? prev.stageLabel ?? incoming.stage),
    kbRefsTotal: i.kbRefsTotal ?? prev.kbRefsTotal,
    kbRefsInvalid: i.kbRefsInvalid ?? prev.kbRefsInvalid,
    updatedAt: i.updatedAt ?? prev.updatedAt,
  };
}
