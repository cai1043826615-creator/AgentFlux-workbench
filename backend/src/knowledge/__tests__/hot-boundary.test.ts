/**
 * 边界修订回归测试（hot-intel 组1）：断言「热点面板 → 任务」通路不存在。
 * 运行：pnpm --filter @workbench/backend exec tsx src/knowledge/__tests__/hot-boundary.test.ts
 *
 * 覆盖 OpenSpec 任务：1.3（后端语义收口）1.4（边界回归）
 * ① 热点模块导出的函数集合中不存在创建任务的函数；
 * ② 调用 POST /api/tasks 只接受 title/description/platforms/referenceImage/workflowId/kbRefs，
 *    传入热点形状的额外字段后任务数与内容不变。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'workbench-hotbound-'));
process.env.WORKBENCH_DB = join(dir, 'bound.db');
process.env.NODE_ENV = 'test';
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { installSmartProducer } = await import('../../agents/smart-producer.ts');
const { buildApp } = await import('../../index.ts');
const { ensureKnowledgeSchema } = await import('../schema.ts');

let app: FastifyInstance;

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
  installSmartProducer();
  app = await buildApp();
  await app.ready();
});

describe('1.3 / 1.4 边界修订：热点面板 → 任务通路不存在', () => {
  test('① 热点模块导出的函数集合中不存在创建任务的函数', async () => {
    const hot = await import('../hot.ts');
    const fns = Object.keys(hot).filter((k) => typeof (hot as Record<string, unknown>)[k] === 'function');
    // 热点模块只应暴露只读面板能力：拉取面板 / 清缓存；不得有任何创建/派生任务的函数
    for (const fn of fns) {
      assert.ok(!/(create|toTask|derive|newTask)/i.test(fn), `热点模块不应导出创建任务的函数：${fn}`);
    }
    assert.ok(fns.includes('loadHotPanel'), '拉取面板函数应保留');
    assert.ok(fns.includes('clearHotCache'), '清缓存函数应保留');
  });

  test('① 热点相关路由均为只读/配置端点，无热点→任务写入端点', async () => {
    // 遍历已注册路由，断言热点域内没有写入任务的端点
    const routes = app.printRoutes();
    for (const line of routes.split('\n')) {
      const m = /(GET|POST|PUT|DELETE|PATCH)\s+\/api\/hot/.exec(line);
      if (!m) continue;
      const method = m[1];
      assert.ok(method === 'GET' || method === 'PUT', `热点路由不应包含写任务语义的方法：${line.trim()}`);
    }
    // 明确断言：不存在热点→任务的端点（如 /api/hot/:id/task）
    assert.ok(!routes.includes('/api/hot/:id/task'), '不应存在热点→任务端点');
    assert.ok(!routes.includes('hot') || !/\/api\/hot\S*task/.test(routes), '热点域路由不应含 task 路径');
  });

  test('② POST /api/tasks 传入热点形状的额外字段后被忽略（任务数与内容不变）', async () => {
    const baseline = await app.inject({ method: 'GET', url: '/api/tasks' });
    const beforeCount = (baseline.json() as { tasks: unknown[] }).tasks.length;

    // 热点形状的额外字段（若被落库则违反边界）
    const hotExtra = {
      title: '热点派生的任务',
      description: '产品主体来自热点',
      platforms: ['天猫'],
      hot: { id: 'cmtugou9e1cddrofptz3jwh4j', title: 'Apple 发布首款折叠屏 iPhone Duo，$1,999' },
      hotRefs: [{ hotId: 'h1', title: '某热点' }],
    };
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: hotExtra });
    assert.equal(res.statusCode, 200, res.body);
    const { task } = res.json() as { task: { id: number; title: string; description: string } };
    assert.equal(task.title, '热点派生的任务', '标题来自表单而非热点');
    assert.equal(task.description, '产品主体来自热点');

    // 任务总数只 +1；再建一个普通任务验证计数口径
    const after = await app.inject({ method: 'GET', url: '/api/tasks' });
    const afterCount = (after.json() as { tasks: unknown[] }).tasks.length;
    assert.equal(afterCount, beforeCount + 1, '热点额外字段不应多创建任务');

    const plain = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '普通任务', description: '正常内容', platforms: ['京东'] } });
    assert.equal(plain.statusCode, 200);
    const after2 = await app.inject({ method: 'GET', url: '/api/tasks' });
    const after2Count = (after2.json() as { tasks: unknown[] }).tasks.length;
    assert.equal(after2Count, beforeCount + 2, '计数与普通创建一致');

    // 任务内容不含热点字段
    const list = (after2.json() as { tasks: { id: number; title: string; description: string }[] }).tasks;
    const hotTask = list.find((t) => t.id === task.id)!;
    assert.ok(!JSON.stringify(hotTask).includes('iPhone Duo'), '任务内容不得含热点内容');
    assert.ok(!JSON.stringify(hotTask).includes('hotRefs'), '任务内容不得含热点关联字段');
  });

  test('② GET /api/hot 与 GET/PUT /api/hot/attention 的响应不含任何可用于派生任务的字段', async () => {
    const hot = await app.inject({ method: 'GET', url: '/api/hot' });
    assert.equal(hot.statusCode, 200);
    const body = hot.json() as { panel: Record<string, unknown> };
    assert.ok(!('taskTemplate' in body.panel), '面板不应携带任务模板');
    assert.ok(!('prefill' in body.panel), '面板不应携带预填内容');

    const attention = await app.inject({ method: 'GET', url: '/api/hot/attention' });
    assert.equal(attention.statusCode, 200);
    const attBody = attention.json() as { config: Record<string, unknown> };
    assert.ok(!('createTask' in attBody.config), '关注域配置不应含创建任务能力');
  });
});
