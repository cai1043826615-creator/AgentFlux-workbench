import { sqlite } from './client.ts';

/** 幂等建表（启动保底；dev / test / prod 一致） */
export function ensureSchema(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      persona TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      skills TEXT NOT NULL DEFAULT '[]',
      files TEXT NOT NULL DEFAULT '[]',
      online_status TEXT NOT NULL DEFAULT 'idle',
      activity TEXT,
      last_active_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      column TEXT NOT NULL DEFAULT 'planned',
      owner_agent_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      reference_image TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      stage_note TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT '你',
      created_at TEXT NOT NULL
    );
  `);
  // 旧库迁移：补充 reference_image 列（已存在则忽略）
  try {
    sqlite.exec('ALTER TABLE tasks ADD COLUMN reference_image TEXT');
  } catch {
    /* column already exists */
  }
  // 旧库迁移：补充 archived 列（已存在则忽略）
  try {
    sqlite.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  } catch {
    /* column already exists */
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deliverables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_kind TEXT NOT NULL,
      "from" TEXT NOT NULL,
      "to" TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'msg',
      task_id INTEGER,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      stages_json TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      task_id INTEGER,
      stage TEXT,
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
