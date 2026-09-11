/**
 * reset-demo.ts —— 备份并清空演示/测试数据（保留 agents/workflows/settings）
 *
 * 用法（在 backend/ 下执行）：
 *   node scripts/reset-demo.ts            # dry-run：仅预览将被清空的表与行数，不写库
 *   node scripts/reset-demo.ts --force    # 先备份到 data/backups/<ts>-pre-reset.db 再清空
 *
 * 参考：openspec/changes/real-ops-enhancement/design.md D2
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(here, '../data/workbench.db.ts');
const BACKUP_DIR = resolve(here, '../data/backups');

const FORCE = process.argv.includes('--force');

/** 清空的目标表（保留 agents / workflows / settings） */
const TRUNCATE_TABLES = ['tasks', 'task_events', 'deliverables', 'messages', 'agent_executions'] as const;

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`[reset-demo] 数据库不存在：${DB_PATH}`);
    process.exit(1);
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');
  // WAL 合并回主文件，保证备份一致
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

  const counts: Record<string, number> = {};
  for (const t of TRUNCATE_TABLES) {
    const r = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
    counts[t] = r.c;
  }

  if (!FORCE) {
    console.log('[reset-demo] dry-run（未执行任何写入），加 --force 执行：');
    for (const t of TRUNCATE_TABLES) console.log(`  - ${t}: ${counts[t]} 行`);
    console.log('  - 执行时将先备份到 data/backups/<ts>-pre-reset.db，再清空以上表（保留 agents/workflows/settings）');
    db.close();
    return;
  }

  // 1. 备份（先于任何清空动作）
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = resolve(BACKUP_DIR, `${ts}-pre-reset.db`);
  copyFileSync(DB_PATH, backup);
  console.log(`[reset-demo] 已备份：${backup}`);

  // 2. 清空 + 重置自增计数
  db.exec('BEGIN');
  try {
    for (const t of TRUNCATE_TABLES) db.prepare(`DELETE FROM ${t}`).run();
    const seq = db.prepare(`SELECT name FROM sqlite_sequence WHERE name IN (${TRUNCATE_TABLES.map(() => '?').join(',')})`).all(...TRUNCATE_TABLES) as { name: string }[];
    for (const r of seq) db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(r.name);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  for (const t of TRUNCATE_TABLES) console.log(`  [reset-demo] 已清空 ${t}: ${counts[t]} 行`);
  console.log('[reset-demo] 完成（agents/workflows/settings 保留）。');
  db.close();
}

main();
