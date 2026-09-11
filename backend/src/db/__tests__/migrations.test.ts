/**
 * 数据库迁移回归（delivery-ops 1.2/1.3）：
 * - deliverable_versions 表建表幂等、(deliverable_id, version) 唯一约束
 * - agent_executions token 三列幂等迁移，既有行默认 0
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-migrate-'));
process.env.WORKBENCH_DB = join(dir, 'migrate.db');

const { sqlite, all, get, run } = await import('../client.ts');
const { ensureSchema } = await import('../ensure.ts');

function tableInfo(name: string): { name: string }[] {
  return all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [name]);
}

describe('1.2 deliverable_versions 建表与唯一约束', () => {
  test('ensureSchema 幂等：连续两次不抛错、表结构一致', () => {
    ensureSchema();
    ensureSchema();
    assert.equal(tableInfo('deliverable_versions').length, 1);
    assert.equal(tableInfo('agent_executions').length, 1);
  });

  test('(deliverable_id, version) 唯一索引存在，重复插入被拒绝', () => {
    const idx = all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_deliverable_versions_deliv_ver'`);
    assert.equal(idx.length, 1, '唯一索引应存在');
    run('INSERT INTO deliverable_versions (deliverable_id, task_id, stage, kind, version, content, status, created_at) VALUES (1, 1, ?, ?, 1, ?, ?, ?)', [
      'copy',
      'copy',
      '{"title":"v1"}',
      'pending',
      '2026-09-01T00:00:00.000Z',
    ]);
    assert.throws(() => {
      run('INSERT INTO deliverable_versions (deliverable_id, task_id, stage, kind, version, content, status, created_at) VALUES (1, 1, ?, ?, 1, ?, ?, ?)', [
        'copy',
        'copy',
        '{"title":"dup"}',
        'pending',
        '2026-09-01T00:00:00.000Z',
      ]);
    }, /UNIQUE/);
    // 不同 deliverable 同版本可插入
    run('INSERT INTO deliverable_versions (deliverable_id, task_id, stage, kind, version, content, status, created_at) VALUES (2, 1, ?, ?, 1, ?, ?, ?)', [
      'copy',
      'copy',
      '{"title":"v1b"}',
      'pending',
      '2026-09-01T00:00:00.000Z',
    ]);
    const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM deliverable_versions');
    assert.equal(count?.c, 2);
  });
});

describe('1.3 agent_executions token 三列迁移', () => {
  test('列存在且默认 0；既有行读取为 0', () => {
    const cols = all<{ name: string }>(`SELECT name FROM pragma_table_info('agent_executions') WHERE name IN ('input_tokens','output_tokens','tokens_estimated')`);
    assert.equal(cols.length, 3, '三列应存在');
    const res = run('INSERT INTO agent_executions (agent_id, model, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)', [
      'agent-copy',
      'deepseek-chat',
      'success',
      100,
      '2026-09-01T00:00:00.000Z',
    ]);
    const row = get<{ input_tokens: number; output_tokens: number; tokens_estimated: number }>('SELECT input_tokens, output_tokens, tokens_estimated FROM agent_executions WHERE id = ?', [res.lastInsertRowid])!;
    assert.equal(row.input_tokens, 0);
    assert.equal(row.output_tokens, 0);
    assert.equal(row.tokens_estimated, 0);
  });
});

test('清理临时目录', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
