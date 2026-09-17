/**
 * cleanup-legacy-tasks.ts —— 一次性数据清理（report-driven-fixes D-01 数据清理）
 *
 * 删除 5 个卡在已废弃阶段（如 xhs-image）的遗留老任务：#27 / #20 / #19 / #18 / #14，
 * 并写 settings 标记（架构铁律 11：一次性迁移必须落标记），防止重启后重复执行。
 *
 * 用法（在 backend/ 下执行）：
 *   node scripts/cleanup-legacy-tasks.ts          # dry-run（默认）：预览任务与关联表行数，不写库
 *   node scripts/cleanup-legacy-tasks.ts --apply  # 真删：事务内删除 + settings 标记
 *
 * 幂等：settings 已有 `cleanup:legacyTasksV1` 标记时直接退出（不重复删）。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(here, '../data/workbench.db.ts');

const APPLY = process.argv.includes('--apply');
const MARK_KEY = 'cleanup:legacyTasksV1';
/** 待删除的遗留任务 id（D-01：卡在已废弃阶段 xhs-image 等） */
const LEGACY_TASK_IDS = [27, 20, 19, 18, 14];

/** 与 tasks 行关联、需一并清理的子表（均按 task_id 外键；deliverable_images 按 deliverable_id，单独处理） */
const CHILD_TABLES = ['task_events', 'deliverables', 'deliverable_versions', 'messages', 'agent_executions'] as const;

function tableExists(db: DatabaseSync, name: string): boolean {
  const r = db.prepare(`SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name = ?`).get(name) as { c: number };
  return r.c > 0;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`[cleanup-legacy-tasks] 数据库不存在：${DB_PATH}`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');

  // 幂等：标记已存在 → 已执行过，退出
  const mark = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(MARK_KEY) as { value: string } | undefined;
  if (mark) {
    console.log(`[cleanup-legacy-tasks] settings 已有标记 ${MARK_KEY}=${mark.value}，已执行过，跳过（幂等）。`);
    db.close();
    return;
  }

  // 收集目标任务现状
  const placeholders = LEGACY_TASK_IDS.map(() => '?').join(',');
  const tasks = db
    .prepare(`SELECT id, title, \`column\`, stage FROM tasks WHERE id IN (${placeholders})`)
    .all(...LEGACY_TASK_IDS) as { id: number; title: string; column: string; stage: string }[];
  const missing = LEGACY_TASK_IDS.filter((id) => !tasks.some((t) => t.id === id));

  console.log(`[cleanup-legacy-tasks] 目标任务 ${LEGACY_TASK_IDS.join('/')}：命中 ${tasks.length} 个，未命中 ${missing.join('/') || '无'}`);
  for (const t of tasks) {
    console.log(`  - #${t.id}「${t.title}」 状态=${t.column} 阶段=${t.stage}`);
  }

  // 关联子表行数预览
  const childCounts: Record<string, number> = {};
  const placeholders2 = tasks.map(() => '?').join(',');
  if (tasks.length > 0) {
    for (const t of CHILD_TABLES) {
      if (!tableExists(db, t)) continue;
      const r = db.prepare(`SELECT count(*) AS c FROM ${t} WHERE task_id IN (${placeholders2})`).get(...tasks.map((x) => x.id)) as { c: number };
      childCounts[t] = r.c;
    }
    if (tableExists(db, 'task_kb_refs')) {
      const r = db.prepare(`SELECT count(*) AS c FROM task_kb_refs WHERE task_id IN (${placeholders2})`).get(...tasks.map((x) => x.id)) as { c: number };
      childCounts.task_kb_refs = r.c;
    }
    if (tableExists(db, 'task_hot_refs')) {
      const r = db.prepare(`SELECT count(*) AS c FROM task_hot_refs WHERE task_id IN (${placeholders2})`).get(...tasks.map((x) => x.id)) as { c: number };
      childCounts.task_hot_refs = r.c;
    }
    if (tableExists(db, 'deliverable_images')) {
      const r = db
        .prepare(`SELECT count(*) AS c FROM deliverable_images WHERE deliverable_id IN (SELECT id FROM deliverables WHERE task_id IN (${placeholders2}))`)
        .get(...tasks.map((x) => x.id)) as { c: number };
      childCounts.deliverable_images = r.c;
    }
  }
  const summary = ['tasks'].concat(Object.keys(childCounts)).map((t) => `${t}=${t === 'tasks' ? tasks.length : childCounts[t]}`);
  console.log(`[cleanup-legacy-tasks] 将删除行数：${summary.join('，')}`);

  if (!APPLY) {
    console.log('[cleanup-legacy-tasks] dry-run（未执行任何写入），确认后加 --apply 执行；执行时写 settings 标记防重复。');
    db.close();
    return;
  }

  if (tasks.length === 0) {
    console.log('[cleanup-legacy-tasks] 无目标任务，仅写标记。');
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      MARK_KEY,
      JSON.stringify({ at: new Date().toISOString(), taskIds: LEGACY_TASK_IDS, removed: [] }),
    );
    db.close();
    return;
  }

  db.exec('BEGIN');
  try {
    const ids = tasks.map((t) => t.id);
    const ph = ids.map(() => '?').join(',');
    for (const t of CHILD_TABLES) {
      if (!tableExists(db, t)) continue;
      db.prepare(`DELETE FROM ${t} WHERE task_id IN (${ph})`).run(...ids);
    }
    if (tableExists(db, 'task_kb_refs')) db.prepare(`DELETE FROM task_kb_refs WHERE task_id IN (${ph})`).run(...ids);
    if (tableExists(db, 'task_hot_refs')) db.prepare(`DELETE FROM task_hot_refs WHERE task_id IN (${ph})`).run(...ids);
    if (tableExists(db, 'deliverable_images')) {
      db.prepare(`DELETE FROM deliverable_images WHERE deliverable_id IN (SELECT id FROM deliverables WHERE task_id IN (${ph}))`).run(...ids);
    }
    db.prepare(`DELETE FROM tasks WHERE id IN (${ph})`).run(...ids);
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      MARK_KEY,
      JSON.stringify({ at: new Date().toISOString(), taskIds: LEGACY_TASK_IDS, removed: ids }),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  for (const t of tasks) console.log(`  [cleanup-legacy-tasks] 已删除任务 #${t.id}「${t.title}」及其关联数据`);
  console.log(`[cleanup-legacy-tasks] 完成（settings 标记 ${MARK_KEY} 已写入，重启不会重复执行）。`);
  db.close();
}

main();
