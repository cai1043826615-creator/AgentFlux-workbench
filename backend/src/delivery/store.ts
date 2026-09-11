import type { CopyPackage, Deliverable, DeliverableDecisionInput, DeliverableKind, ImageItem, ProvenanceResult } from '@workbench/shared';
import { all, get, run, tx } from '../db/client.ts';
import type { DeliverableRow } from '../db/schema.ts';
import { bus } from '../engine/bus.ts';
import { archiveVersion, trimVersions } from './versions.ts';

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

/** 按 (任务, 阶段, 种类) 唯一定位交付物行（修复：主图/详情图/文案互相覆盖的问题） */
function getRow(taskId: number, stage: string, kind: string): DeliverableRow | undefined {
  return get<DeliverableRow>('SELECT * FROM deliverables WHERE task_id = ? AND stage = ? AND kind = ? ORDER BY id ASC', [taskId, stage, kind]);
}

/** 按任务+阶段+种类取交付物 */
export function getDeliverable(taskId: number, stage: string, kind: DeliverableKind): Deliverable | undefined {
  const row = getRow(taskId, stage, kind);
  return row ? toDeliverable(row) : undefined;
}

export function listDeliverables(taskId: number): Deliverable[] {
  return all<DeliverableRow>('SELECT * FROM deliverables WHERE task_id = ? ORDER BY id ASC', [taskId]).map(toDeliverable);
}

/** 保存交付物（文案包/图片集/溯源结果），同一 (任务,阶段,种类) 重复产出时版本递增；
 *  覆盖前把上一版快照写入 deliverable_versions（同一事务：留档失败则覆盖也不发生） */
export function saveDeliverable(taskId: number, stage: string, kind: DeliverableKind, content: CopyPackage | ImageItem[] | ProvenanceResult): Deliverable {
  const updatedAt = now();
  const existing = getRow(taskId, stage, kind);
  if (existing) {
    const version = existing.version + 1;
    const newContent = JSON.stringify(content);
    tx(() => {
      archiveVersion({
        deliverableId: existing.id,
        taskId,
        stage,
        kind,
        version: existing.version,
        content: existing.content,
        status: existing.status,
      });
      run('UPDATE deliverables SET content = ?, stage = ?, status = ?, version = ?, updated_at = ? WHERE id = ?', [
        newContent,
        stage,
        'pending',
        version,
        updatedAt,
        existing.id,
      ]);
      trimVersions(existing.id);
    });
    const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [existing.id])!;
    const del = toDeliverable(row);
    bus.emitDeliverable(del);
    return del;
  }
  let id = 0;
  tx(() => {
    const res = run('INSERT INTO deliverables (task_id, stage, kind, content, status, version, updated_at) VALUES (?,?,?,?,?,?,?)', [
      taskId,
      stage,
      kind,
      JSON.stringify(content),
      'pending',
      1,
      updatedAt,
    ]);
    id = res.lastInsertRowid;
    // 首次产出同时写 v1 历史（与交付物同一事务）
    archiveVersion({ deliverableId: id, taskId, stage, kind, version: 1, content: JSON.stringify(content), status: 'pending' });
  });
  const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [id])!;
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

/** 更新交付物状态：copy 整包；image 按 imageId 逐张（无 imageId 则整批），全部决策后交付物状态同步 */
export function updateDeliverableStatus(
  taskId: number,
  stage: string,
  kind: DeliverableKind,
  imageId: string | undefined,
  status: 'approved' | 'rejected' | 'skipped',
): Deliverable | undefined {
  const existing = getRow(taskId, stage, kind);
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
    // 全部决策仅指「不存在待确认（pending）图」；failed（生成失败）不参与判定：等待打回/重试/跳过，但不阻塞拍板点推进
    const allDecided = !images.some((i) => i.status === 'pending');
    run('UPDATE deliverables SET content = ?, status = ? WHERE id = ?', [JSON.stringify(images), allDecided ? status : 'pending', existing.id]);
  }
  const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [existing.id])!;
  const updated = toDeliverable(row);
  bus.emitDeliverable(updated);
  return updated;
}

/** 某阶段图片集是否全部决策完成（判定只看是否存在待确认 pending 图；failed 生成失败不参与，仅剩 failed 时拍板点仍可推进） */
export function allImagesDecided(taskId: number, stage: string): boolean {
  const existing = getRow(taskId, stage, 'image');
  if (!existing) return false;
  try {
    const images = JSON.parse(existing.content) as ImageItem[];
    return images.length > 0 && !images.some((i) => i.status === 'pending');
  } catch {
    return false;
  }
}

/** 某阶段图片集里生成失败（failed）的图片数（推进时供事件记录与界面警示） */
export function countFailedImages(taskId: number, stage: string): number {
  const existing = getRow(taskId, stage, 'image');
  if (!existing) return 0;
  try {
    const images = JSON.parse(existing.content) as ImageItem[];
    return images.filter((i) => i.status === 'failed').length;
  } catch {
    return 0;
  }
}

/** 写回某阶段整组图片条目（单张重试/跳过更新 attempts、url、status 后整体持久化） */
export function updateImageItems(taskId: number, stage: string, images: ImageItem[]): Deliverable | undefined {
  const existing = getRow(taskId, stage, 'image');
  if (!existing) return undefined;
  // 与 allImagesDecided 一致：pending 才算未决策；failed 不阻塞推进
  const allDecided = !images.some((i) => i.status === 'pending');
  run('UPDATE deliverables SET content = ?, status = ? WHERE id = ?', [JSON.stringify(images), allDecided ? existing.status : 'pending', existing.id]);
  const row = get<DeliverableRow>('SELECT * FROM deliverables WHERE id = ?', [existing.id])!;
  const updated = toDeliverable(row);
  bus.emitDeliverable(updated);
  return updated;
}

/** 某阶段图片集是否存在打回 */
export function anyImageRejected(taskId: number, stage: string): boolean {
  const existing = getRow(taskId, stage, 'image');
  if (!existing) return false;
  try {
    const images = JSON.parse(existing.content) as ImageItem[];
    return images.some((i) => i.status === 'rejected');
  } catch {
    return false;
  }
}

export type { DeliverableDecisionInput };
