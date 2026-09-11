/**
 * 交付物版本历史（delivery-ops B3）
 *
 * - deliverable_versions 表由 db/ensure.ts 幂等建表
 * - saveDeliverable 覆盖前调用 archiveVersion 把上一版留档（同一事务内）
 * - 每个交付物只保留最近 MAX_VERSIONS_PER_DELIVERABLE 版
 * - 既有数据启动时回填基线记录（幂等）
 */
import type { Deliverable, DeliverableKind, DeliverableVersion } from '@workbench/shared';
import { all, get, run } from '../db/client.ts';
import type { DeliverableRow, DeliverableVersionRow } from '../db/schema.ts';

/** 每个交付物保留的最近版本数上限（B3 常量集中定义，便于调整） */
export const MAX_VERSIONS_PER_DELIVERABLE = 20;

function now(): string {
  return new Date().toISOString();
}

function toVersion(row: DeliverableVersionRow): DeliverableVersion {
  return {
    id: row.id,
    deliverableId: row.deliverable_id,
    taskId: row.task_id,
    stage: row.stage,
    kind: row.kind as DeliverableKind,
    version: row.version,
    content: row.content,
    status: row.status as DeliverableVersion['status'],
    createdAt: row.created_at,
  };
}

/**
 * 写一版历史快照：同 (deliverable_id, version) 已存在则跳过（幂等）。
 * 不在此处做任何内容改写（content 原样落库）。
 */
export function archiveVersion(input: {
  deliverableId: number;
  taskId: number;
  stage: string;
  kind: string;
  version: number;
  content: string;
  status: string;
}): void {
  const exists = get<{ id: number }>('SELECT id FROM deliverable_versions WHERE deliverable_id = ? AND version = ?', [
    input.deliverableId,
    input.version,
  ]);
  if (exists) return;
  run('INSERT INTO deliverable_versions (deliverable_id, task_id, stage, kind, version, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)', [
    input.deliverableId,
    input.taskId,
    input.stage,
    input.kind,
    input.version,
    input.content,
    input.status,
    now(),
  ]);
}

/** 按版本号升序读取某交付物的全部历史版本 */
export function listVersions(deliverableId: number): DeliverableVersion[] {
  return all<DeliverableVersionRow>('SELECT * FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version ASC', [deliverableId]).map(toVersion);
}

/** 按任务读取某阶段/种类的全部版本历史（按 version 升序） */
export function listVersionsByTask(taskId: number, stage: string, kind: string): DeliverableVersion[] {
  return all<DeliverableVersionRow>(
    'SELECT * FROM deliverable_versions WHERE task_id = ? AND stage = ? AND kind = ? ORDER BY version ASC',
    [taskId, stage, kind],
  ).map(toVersion);
}

/**
 * 保留上限裁剪：历史快照与当前交付物合计不超过 MAX_VERSIONS_PER_DELIVERABLE
 * （当前行不在历史表内，因此历史表最多保留 MAX-1 条），超出时删除最旧记录。
 */
export function trimVersions(deliverableId: number): void {
  const rows = all<{ id: number }>('SELECT id FROM deliverable_versions WHERE deliverable_id = ? ORDER BY version ASC', [deliverableId]);
  if (rows.length < MAX_VERSIONS_PER_DELIVERABLE) return;
  const excess = rows.length - (MAX_VERSIONS_PER_DELIVERABLE - 1);
  const ids = rows.slice(0, excess).map((r) => r.id);
  run(`DELETE FROM deliverable_versions WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

/**
 * 既有交付物回填基线历史（幂等）：每个缺失「当前版本记录」的 deliverables 行写入一条
 * version = 当前 version、内容为当前 content 的基线记录。返回本次新增行数。
 * 说明（design D3）：本次上线前的中间版本不可恢复，回填只声明当前内容为历史基线。
 */
export function backfillVersionHistory(): number {
  const rows = all<DeliverableRow>('SELECT * FROM deliverables ORDER BY id ASC');
  let added = 0;
  for (const d of rows) {
    const exists = get<{ id: number }>('SELECT id FROM deliverable_versions WHERE deliverable_id = ? AND version = ?', [d.id, d.version]);
    if (exists) continue;
    run('INSERT INTO deliverable_versions (deliverable_id, task_id, stage, kind, version, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)', [
      d.id,
      d.task_id,
      d.stage,
      d.kind,
      d.version,
      d.content,
      d.status,
      d.updated_at,
    ]);
    added += 1;
  }
  return added;
}

/**
 * 完整版本历史视图 = 历史快照（deliverable_versions）+ 当前交付物（deliverables 当前行）。
 * 按 version 去重（同一版本以历史记录为准，内容一致）；保证「历史最大版本号 === deliverables.version」。
 * 首次产出（仅 v1）时历史与当前同版本，去重后恰一条。
 */
export function fullVersionHistory(deliverable: Deliverable): DeliverableVersion[] {
  const versions = listVersions(deliverable.id);
  const map = new Map<number, DeliverableVersion>(versions.map((v) => [v.version, v]));
  map.set(deliverable.version, {
    id: -1,
    deliverableId: deliverable.id,
    taskId: deliverable.taskId,
    stage: deliverable.stage,
    kind: deliverable.kind,
    version: deliverable.version,
    content: deliverable.content,
    status: deliverable.status,
    createdAt: deliverable.updatedAt,
  });
  return [...map.values()].sort((a, b) => a.version - b.version);
}

export type { DeliverableVersion };
