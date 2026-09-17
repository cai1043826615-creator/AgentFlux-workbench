/**
 * cleanup-hotspot-task-7.ts —— 一次性数据清理（复核报告 Q8）
 *
 * 清理看板残留的热点类任务 #7「Apple 发布首款折叠屏 iPhone Duo，起售价 $1,999」
 * （workflow=ecom-new-listing, stage=copy）。项目 spec 明确「热点不派生任务」，判定为早期测试残留。
 *
 * 只按 **id = 7** 精确删除（不按标题模糊匹配，避免误伤真实任务）；
 * 删除前先校验该 id 的标题确为上述残留任务，不一致则拒绝执行（防误删）。
 * 并写 settings 标记（架构铁律 11：一次性迁移必须落标记），防止重复执行。
 *
 * 用法（在 backend/ 下执行）：
 *   node scripts/cleanup-hotspot-task-7.ts          # dry-run（默认）：预览任务与关联表行数，不写库
 *   node scripts/cleanup-hotspot-task-7.ts --apply   # 真删：事务内删除 + settings 标记
 *
 * 幂等：settings 已有 `cleanup:hotspotTask7V1` 标记时直接退出（不重复删）。
 * 备份参考：backend/data/backups/2026-09-17T23-59-02-pre-q8-cleanup.db.ts
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(here, '../data/workbench.db.ts');

const APPLY = process.argv.includes('--apply');
const MARK_KEY = 'cleanup:hotspotTask7V1';

/** 目标任务 id（Q8 复核报告点名的残留热点任务） */
const TARGET_ID = 7;
/** 预期标题：防误删校验，实际标题不符则拒绝执行 */
const EXPECTED_TITLE = 'Apple 发布首款折叠屏 iPhone Duo，起售价 $1,999';

/** 与 tasks 行关联、需一并清理的子表（均按 task_id 外键；deliverable_images 按 deliverable_id，单独处理） */
const CHILD_TABLES = ['task_events', 'deliverables', 'deliverable_versions', 'messages', 'agent_executions'] as const;

function tableExists(db: DatabaseSync, name: string): boolean {
  const r = db.prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name = ?`).get(name) as { c: number };
  return r.c > 0;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`[cleanup-hotspot-task-7] 数据库不存在：${DB_PATH}`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');

  // 幂等：标记已存在 → 已执行过，退出
  const mark = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(MARK_KEY) as { value: string } | undefined;
  if (mark) {
    console.log(`[cleanup-hotspot-task-7] settings 已有标记 ${MARK_KEY}=${mark.value}，已执行过，跳过（幂等）。`);
    db.close();
    return;
  }

  // 只按 id 精确匹配（Q8 要求：dry-run 确认只命中 1 个）
  const rows = db.prepare(`SELECT id, title, \`column\`, workflow_id, stage FROM tasks WHERE id = ?`).all(TARGET_ID) as {
    id: number;
    title: string;
    column: string;
    workflow_id: string;
    stage: string;
  }[];

  console.log(`[cleanup-hotspot-task-7] 按 id=${TARGET_ID} 精确匹配到 ${rows.length} 个任务：`);
  for (const t of rows) {
    console.log(`  - #${t.id}「${t.title}」 状态=${t.column} 工作流=${t.workflow_id} 阶段=${t.stage}`);
  }
  if (rows.length === 0) {
    console.log(`[cleanup-hotspot-task-7] 未命中任务 #${TARGET_ID}（可能已删除）。`);
  } else if (rows.length > 1) {
    console.error(`[cleanup-hotspot-task-7] 命中 ${rows.length} 个任务，与预期 1 个不符，拒绝执行。`);
    db.close();
    process.exit(1);
  } else if (rows[0].title !== EXPECTED_TITLE) {
    console.error(
      `[cleanup-hotspot-task-7] 任务 #${TARGET_ID} 标题为「${rows[0].title}」，与预期残留任务「${EXPECTED_TITLE}」不符，拒绝执行（防误删）。`,
    );
    db.close();
    process.exit(1);
  }

  // 关联子表行数预览
  const ids = rows.map((t) => t.id);
  const childCounts: Record<string, number> = {};
  const ph = ids.map(() => '?').join(',');
  if (ids.length > 0) {
    for (const t of CHILD_TABLES) {
      if (!tableExists(db, t)) continue;
      const r = db.prepare(`SELECT count(*) AS c FROM ${t} WHERE task_id IN (${ph})`).get(...ids) as { c: number };
      childCounts[t] = r.c;
    }
    for (const t of ['task_kb_refs', 'task_hot_refs']) {
      if (!tableExists(db, t)) continue;
      const r = db.prepare(`SELECT count(*) AS c FROM ${t} WHERE task_id IN (${ph})`).get(...ids) as { c: number };
      childCounts[t] = r.c;
    }
    if (tableExists(db, 'deliverable_images')) {
      const r = db
        .prepare(`SELECT count(*) AS c FROM deliverable_images WHERE deliverable_id IN (SELECT id FROM deliverables WHERE task_id IN (${ph}))`)
        .get(...ids) as { c: number };
      childCounts.deliverable_images = r.c;
    }
  }
  const summary = ['tasks'].concat(Object.keys(childCounts)).map((t) => `${t}=${t === 'tasks' ? rows.length : childCounts[t]}`);
  console.log(`[cleanup-hotspot-task-7] 将删除行数：${summary.join('，')}`);

  if (!APPLY) {
    console.log('[cleanup-hotspot-task-7] dry-run（未执行任何写入），确认后加 --apply 执行；执行时写 settings 标记防重复。');
    db.close();
    return;
  }

  if (rows.length === 0) {
    console.log('[cleanup-hotspot-task-7] 无目标任务，仅写标记。');
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      MARK_KEY,
      JSON.stringify({ at: new Date().toISOString(), taskId: TARGET_ID, removed: [] }),
    );
    db.close();
    return;
  }

  db.exec('BEGIN');
  try {
    for (const t of CHILD_TABLES) {
      if (!tableExists(db, t)) continue;
      db.prepare(`DELETE FROM ${t} WHERE task_id IN (${ph})`).run(...ids);
    }
    for (const t of ['task_kb_refs', 'task_hot_refs']) {
      if (!tableExists(db, t)) continue;
      db.prepare(`DELETE FROM ${t} WHERE task_id IN (${ph})`).run(...ids);
    }
    if (tableExists(db, 'deliverable_images')) {
      db.prepare(`DELETE FROM deliverable_images WHERE deliverable_id IN (SELECT id FROM deliverables WHERE task_id IN (${ph}))`).run(...ids);
    }
    db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...ids);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      MARK_KEY,
      JSON.stringify({ at: new Date().toISOString(), taskId: TARGET_ID, removed: ids }),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  for (const t of rows) console.log(`  [cleanup-hotspot-task-7] 已删除任务 #${t.id}「${t.title}」及其关联数据`);
  console.log(`[cleanup-hotspot-task-7] 完成（settings 标记 ${MARK_KEY} 已写入，重启不会重复执行）。`);
  db.close();
}

main();
