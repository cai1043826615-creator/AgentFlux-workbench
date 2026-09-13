import { all, run, sqlite } from './client.ts';

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
  // 旧库迁移：工作流专属表单扩展字段（JSON；小红书存内容类型/人群/产品，电商为空）
  try {
    sqlite.exec('ALTER TABLE tasks ADD COLUMN brief TEXT');
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
  // 交付物版本历史（delivery-ops B3）：每次重新产出前把上一版快照留档；(deliverable_id, version) 唯一
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deliverable_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deliverable_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      stage TEXT NOT NULL,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
  `);
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_deliverable_versions_deliv_ver ON deliverable_versions (deliverable_id, version);');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_deliverable_versions_task ON deliverable_versions (task_id);');
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
  // 旧库迁移：token 列（delivery-ops B12，幂等；已存在则忽略，与 tasks.reference_image/archived 迁移写法一致）
  try {
    sqlite.exec('ALTER TABLE agent_executions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0');
  } catch {
    /* column already exists */
  }
  try {
    sqlite.exec('ALTER TABLE agent_executions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0');
  } catch {
    /* column already exists */
  }
  try {
    sqlite.exec('ALTER TABLE agent_executions ADD COLUMN tokens_estimated INTEGER NOT NULL DEFAULT 0');
  } catch {
    /* column already exists */
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  migrateAgentFileMounts();
}

/**
 * 旧库迁移：文件挂载扩展名修正（skill-category-sections）。
 * 存量库 agents.files 里的「品牌手册.pdf / 品牌视觉规范.pdf」指向白名单外文件（readFileContent 必然读空），
 * 替换为同名 .md 对应物（已在 backend/files/ 落地），使存量库的文件挂载同样可解析。
 * 幂等：仅精确匹配这两个元素；JSON 坏行跳过不动（保持既有容错语义）；其余元素原样保留。
 */
const FILE_MOUNT_RENAMES: Record<string, string> = {
  '品牌手册.pdf': '品牌手册.md',
  '品牌视觉规范.pdf': '品牌视觉规范.md',
};

function migrateAgentFileMounts(): void {
  let rows: { id: string; files: string }[] = [];
  try {
    rows = all<{ id: string; files: string }>('SELECT id, files FROM agents');
  } catch {
    return; // 表尚未建好等异常场景：交给下次启动
  }
  for (const row of rows) {
    let list: unknown;
    try {
      list = JSON.parse(row.files);
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    let changed = false;
    const next = list.map((x) => {
      if (typeof x === 'string' && FILE_MOUNT_RENAMES[x]) {
        changed = true;
        return FILE_MOUNT_RENAMES[x];
      }
      return x;
    });
    if (changed) run('UPDATE agents SET files = ? WHERE id = ?', [JSON.stringify(next), row.id]);
  }
}
