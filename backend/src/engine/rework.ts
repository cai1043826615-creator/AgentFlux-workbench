/**
 * 返工上下文（OpenSpec quality-loop · rework-context）
 *
 * 读取 task_events 的 REJECTED / REVIEW_ROLLBACK 事件，做阶段匹配与产出后失效判定，
 * 并组装注入 producer 的返工意见文本。供质量回环集成（executor / service / smart-producer）使用。
 */
import { all, get } from '../db/client.ts';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import type { ReworkRecord, ReworkInfo } from '@workbench/shared';

/** 注入文本中意见原文的长度上限 */
export const MAX_REWORK_NOTE_LEN = 500;

export interface PendingRework {
  /** 当前待处理意见（最新一条）；无则 null */
  latest: ReworkRecord | null;
  /** 当前阶段的累计返工次数（该阶段全部 REJECTED + 回退到该阶段的 REVIEW_ROLLBACK） */
  stageCount: number;
  /** 任务累计返工次数 */
  totalCount: number;
}

/** payload TEXT(JSON) → 对象；解析失败按空对象处理 */
function parsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'string') return {};
  try {
    const v: unknown = JSON.parse(payload);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 事件所属返工阶段（REJECTED→stage；REVIEW_ROLLBACK→targetStage）；无法确定（非字符串）时返回 null */
function stageOf(type: string, payload: Record<string, unknown>): string | null {
  if (type === 'REJECTED') {
    return typeof payload.stage === 'string' ? payload.stage : null;
  }
  if (type === 'REVIEW_ROLLBACK') {
    return typeof payload.targetStage === 'string' ? payload.targetStage : null;
  }
  return null;
}

/** 读该任务全部返工事件（REJECTED + REVIEW_ROLLBACK），按时间升序 */
export function readReworkEvents(taskId: number): ReworkRecord[] {
  const rows = all<{ type: string; payload: string; created_at: string }>(
    `SELECT * FROM task_events WHERE task_id = ? AND type IN ('REJECTED','REVIEW_ROLLBACK') ORDER BY id ASC`,
    [taskId],
  );
  const records: ReworkRecord[] = [];
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    const stage = stageOf(row.type, payload);
    if (stage === null) continue;
    const note = typeof payload.note === 'string' ? payload.note : '';
    records.push({ stage, note, at: row.created_at });
  }
  return records;
}

/** 任务累计返工信息（供 GET /api/tasks/:id/rework） */
export function getReworkInfo(taskId: number): ReworkInfo {
  const records = readReworkEvents(taskId);
  return { count: records.length, records };
}

/** 指定阶段最近一次产出完成时间；无该阶段 STAGE_COMPLETED 时为 null（视为 epoch 起点） */
function lastCompletedAt(taskId: number, currentStage: string): string | null {
  const rows = all<{ payload: string; created_at: string }>(
    `SELECT payload, created_at FROM task_events WHERE task_id = ? AND type = 'STAGE_COMPLETED'`,
    [taskId],
  );
  let latest: string | null = null;
  for (const row of rows) {
    const payload = parsePayload(row.payload);
    if (payload.stage === currentStage && (latest === null || row.created_at > latest)) {
      latest = row.created_at;
    }
  }
  return latest;
}

/** 阶段匹配 + 产出后失效判定；currentStage 缺省时从 tasks 表读任务当前 stage */
export function getPendingRework(taskId: number, currentStage?: string): PendingRework {
  let stage = currentStage;
  if (stage === undefined) {
    const row = get<{ stage: string }>('SELECT stage FROM tasks WHERE id = ?', [taskId]);
    if (!row) return { latest: null, stageCount: 0, totalCount: 0 };
    stage = row.stage;
  }
  const events = readReworkEvents(taskId);
  const lastCompleted = lastCompletedAt(taskId, stage);
  const stageEvents = events.filter((e) => e.stage === stage);
  const pending = stageEvents.filter((e) => lastCompleted === null || e.at > lastCompleted);
  const latest = pending.length ? pending.reduce((a, b) => (a.at >= b.at ? a : b)) : null;
  return { latest, stageCount: stageEvents.length, totalCount: events.length };
}

/** 组装注入 producer 的返工段文本；note 超长截断并标注「（已截断）」；无意见时由调用方决定不调用本函数 */
export function assembleReworkText(stage: string, stageCount: number, note: string): string {
  const truncatedNote =
    note.length > MAX_REWORK_NOTE_LEN ? `${note.slice(0, MAX_REWORK_NOTE_LEN)}…（已截断）` : note;
  return [
    '【上次返工意见】',
    `该任务当前阶段（${WORKFLOW_STAGE_LABELS[stage] ?? stage}）已被打回 ${stageCount} 次。最近一次打回意见：`,
    `「${truncatedNote}」`,
    '要求：本次产出需针对该意见修改，不得原样重复上次产出；只针对意见所指问题修改，其余内容保持。',
  ].join('\n');
}
