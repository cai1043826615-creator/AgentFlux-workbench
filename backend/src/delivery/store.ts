import type { CopyPackage, Deliverable, DeliverableDecisionInput, DeliverableKind, ImageItem } from '@workbench/shared';
import { all, get, run } from '../db/client.ts';
import type { DeliverableRow } from '../db/schema.ts';
import { bus } from '../engine/bus.ts';

function now(): string {
  return new Date().toISOString();
}

function toDeliverable(row: DeliverableRow): Deliverable {
  return {
    id: row.id,
    taskId: row.task_id,
    stage: row.stage,
    kind: row.kind as DeliverableKind,
    content: row.content,
    status: row.status as Deliverable['status'],
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function getRow(taskId: number, kind: string): DeliverableRow | undefined {
  return get<DeliverableRow>('SELECT * FROM deliverables WHERE task_id = ? AND kind = ? ORDER BY id ASC', [taskId, kind]);
}

/** 按任务+种类取交付物（v1 每任务每种类一条记录，content 内含文案包或图片数组） */
export function getDeliverable(taskId: number, kind: DeliverableKind): Deliverable | undefined {
  const row = getRow(taskId, kind);
  return row ? toDeliverable(row) : undefined;
}

export function listDeliverables(taskId: number): Deliverable[] {
  return all<DeliverableRow>('SELECT * FROM deliverables WHERE task_id = ? ORDER BY id ASC', [taskId]).map(toDeliverable);
}

/** 保存交付物（文案包或图片集），重复产出时版本递增 */
export function saveDeliverable(taskId: number, stage: string, kind: DeliverableKind, content: CopyPackage | ImageItem[]): Deliverable {
  const updatedAt = now();
  const existing = getRow(taskId, kind);
  if (existing) {
    const version = existing.version + 1;
    run('UPDATE deliverables SET content = ?, stage = ?, status = ?, version = ?, updated_at = ? WHERE id = ?', [
      JSON.stringify(content),
      stage,
      'pending',
      version,
      updatedAt,
      existing.id,
    ]);
    const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [existing.id])!;
    const del = toDeliverable(row);
    bus.emitDeliverable(del);
    return del;
  }
  const res = run('INSERT INTO deliverables (task_id, stage, kind, content, status, version, updated_at) VALUES (?,?,?,?,?,?,?)', [
    taskId,
    stage,
    kind,
    JSON.stringify(content),
    'pending',
    1,
    updatedAt,
  ]);
  const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [res.lastInsertRowid])!;
  const del = toDeliverable(row);
  bus.emitDeliverable(del);
  return del;
}

/** 重入待确认时重置该阶段交付物为 pending（spec: rework re-enters approval with reset deliverables） */
export function resetStageDeliverables(taskId: number, stage: string): void {
  const list = all<DeliverableRow>('SELECT * FROM deliverables WHERE task_id = ? AND stage = ?', [taskId, stage]);
  for (const row of list) {
    run('UPDATE deliverables SET status = ? WHERE id = ?', ['pending', row.id]);
    const updated = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [row.id])!;
    bus.emitDeliverable(toDeliverable(updated));
  }
}

export function updateDeliverableStatus(taskId: number, kind: DeliverableKind, imageId: string | undefined, status: 'approved' | 'rejected'): Deliverable | undefined {
  const existing = getRow(taskId, kind);
  if (!existing) return undefined;
  let content: CopyPackage | ImageItem[];
  try {
    content = JSON.parse(existing.content);
  } catch {
    content = [];
  }
  if (kind === 'copy') {
    run('UPDATE deliverables SET status = ? WHERE id = ?', [status, existing.id]);
  } else {
    const images = content as ImageItem[];
    const target = imageId ? images.find((i) => i.id === imageId) : undefined;
    if (imageId && target) {
      target.status = status;
    } else {
      for (const img of images) img.status = status;
    }
    const allDecided = images.every((i) => i.status !== 'pending');
    run('UPDATE deliverables SET content = ?, status = ? WHERE id = ?', [JSON.stringify(images), allDecided ? status : 'pending', existing.id]);
  }
  const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [existing.id])!;
  const updated = toDeliverable(row);
  bus.emitDeliverable(updated);
  return updated;
}

/** 图片集是否全部决策完成 */
export function allImagesDecided(taskId: number): boolean {
  const existing = getRow(taskId, 'image');
  if (!existing) return false;
  try {
    const images = JSON.parse(existing.content) as ImageItem[];
    return images.length > 0 && images.every((i) => i.status !== 'pending');
  } catch {
    return false;
  }
}

/** 图片集是否存在打回 */
export function anyImageRejected(taskId: number): boolean {
  const existing = getRow(taskId, 'image');
  if (!existing) return false;
  try {
    const images = JSON.parse(existing.content) as ImageItem[];
    return images.some((i) => i.status === 'rejected');
  } catch {
    return false;
  }
}

export type { DeliverableDecisionInput };
