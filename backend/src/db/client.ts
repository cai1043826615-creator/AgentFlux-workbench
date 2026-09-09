import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = resolve(process.env.WORKBENCH_DB ?? './data/workbench.db.ts');

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

/** 轻量 SQLite 连接（Node 内置 node:sqlite，零原生编译依赖） */
export const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec('PRAGMA journal_mode = WAL');
sqlite.exec('PRAGMA busy_timeout = 5000');

export { DB_PATH };

type SqlParam = string | number | bigint | Uint8Array | null;

/** 查询多行 */
export function all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

/** 查询单行 */
export function get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

/** 执行写操作，返回 lastInsertRowid 与 changes */
export function run(sql: string, params: SqlParam[] = []): { changes: number; lastInsertRowid: number } {
  const r = sqlite.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** 同步事务（单写者，WAL） */
export function tx<T>(fn: () => T): T {
  sqlite.exec('BEGIN');
  try {
    const result = fn();
    sqlite.exec('COMMIT');
    return result;
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}
