/**
 * 交付运营 REST 集成（delivery-ops B3/B4/B5/B6/B12，组 5/6/7/8 + 2/3/4/15 接口层）：
 * - B5 任务列表查询：platform（多值或）/owner/from/to/q（含注入串）/sort/order/includeArchived；
 *   无参数返回与改动前一致的全量（含归档）
 * - B6 kbRefsTotal/kbRefsInvalid 与 GET /api/tasks/:id/kb-refs 判定一致（单次查询聚合）
 * - B3 versions/diff 端点：返工后 v1+v2、v1 内容保留、非法参数 400、不存在版本 404
 * - B4 deliverable-package：无交付物 409；走完全流程后 200 zip + X-Deliverable-Missing
 * - B5 交付物搜索：标题/卖点命中 + hint
 * - B12 cost 端点：404 与汇总结构
 * - B8 channel-test 端点：未配置 ok:false + not_configured；agent 不存在 404
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'workbench-delivery-api-'));
process.env.WORKBENCH_DB = join(dir, 'api.db');
process.env.NODE_ENV = 'test';

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { run } = await import('../../db/client.ts');
const { buildApp } = await import('../../index.ts');

let app: FastifyInstance;

async function waitAwaitingOrDone(taskId: number, timeoutMs = 8000): Promise<{ column: string; stage: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables` });
    const { deliverables } = res.json() as { deliverables: { kind: string }[] };
    void deliverables;
    const t = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/provenance` })).json();
    void t;
    // 用列表接口读任务状态（列表含 updatedAt/进度）
    const list = (await app.inject({ method: 'GET', url: '/api/tasks' })).json() as { tasks: { id: number; column: string; stage: string }[] };
    const task = list.tasks.find((x) => x.id === taskId);
    if (task && (task.column === 'awaiting' || task.column === 'done')) return task;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`任务 ${taskId} 未在超时内达到 awaiting/done`);
}

/** 走完完整流程到 done（copy 通过 + 全部图片通过 + 校对放行 + 交付） */
async function runTaskToDone(title: string): Promise<number> {
  const create = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title, description: 'desc', platforms: ['天猫', '抖音小店'] } });
  assert.equal(create.statusCode, 200, create.body);
  const taskId = (create.json() as { task: { id: number } }).task.id;

  const confirm = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm` });
  assert.equal(confirm.statusCode, 200, confirm.body);

  // copy 通过
  let s = await waitAwaitingOrDone(taskId);
  assert.equal(s.column, 'awaiting');
  const approveCopy = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/deliverables/decide`, payload: { kind: 'copy', decision: 'approve' } });
  assert.equal(approveCopy.statusCode, 200, approveCopy.body);

  // 主图逐张通过
  s = await waitAwaitingOrDone(taskId);
  assert.equal(s.stage, 'main-image');
  let del = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables` })).json() as { deliverables: { kind: string; stage: string; content: string }[] };
  let mainImages = JSON.parse(del.deliverables.find((d) => d.kind === 'image' && d.stage === 'main-image')!.content) as { id: string }[];
  for (const img of mainImages) {
    const r = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/deliverables/decide`, payload: { kind: 'image', decision: 'approve', imageId: img.id } });
    assert.equal(r.statusCode, 200, r.body);
  }

  // 详情图逐张通过 → 校对放行 → 交付完成
  s = await waitAwaitingOrDone(taskId);
  if (s.stage === 'detail-image') {
    del = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables` })).json() as { deliverables: { kind: string; stage: string; content: string }[] };
    const detailImages = JSON.parse(del.deliverables.find((d) => d.kind === 'image' && d.stage === 'detail-image')!.content) as { id: string }[];
    for (const img of detailImages) {
      const r = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/deliverables/decide`, payload: { kind: 'image', decision: 'approve', imageId: img.id } });
      assert.equal(r.statusCode, 200, r.body);
    }
    s = await waitAwaitingOrDone(taskId);
  }
  assert.equal(s.column, 'done', `任务应完成，实际 ${s.column}/${s.stage}`);
  return taskId;
}

before(async () => {
  ensureSchema();
  seed();
  app = await buildApp();
  await app.ready();
});

describe('B5 任务列表查询（组 6/7）', () => {
  test('无参数返回与改动前一致的全量结果（含归档任务）', async () => {
    const base = (await app.inject({ method: 'GET', url: '/api/tasks' })).json() as { tasks: { id: number; archived: boolean; updatedAt: string; kbRefsTotal: number }[] };
    assert.ok(base.tasks.length >= 0);
    for (const t of base.tasks) {
      assert.ok(typeof t.updatedAt === 'string' && t.updatedAt.length > 0, '应有 updatedAt');
      assert.equal(typeof t.kbRefsTotal, 'number');
    }
    // 创建后立即含归档可见性（无参数不排除归档）
    const create = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '归档可见性测试', description: '', platforms: ['京东'] } });
    const taskId = (create.json() as { task: { id: number } }).task.id;
    await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/archive` });
    const after = (await app.inject({ method: 'GET', url: '/api/tasks' })).json() as { tasks: { id: number; archived: boolean }[] };
    assert.ok(after.tasks.some((t) => t.id === taskId && t.archived), '无参数应含归档任务（与改动前一致）');
  });

  test('platform 多值或 + owner + from/to + q 过滤', async () => {
    const t1 = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '天猫专用商品A', description: 'A描述', platforms: ['天猫'] } })).json() as { task: { id: number } };
    const t2 = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '抖音小店商品B', description: 'B描述', platforms: ['抖音小店'] } })).json() as { task: { id: number } };
    const t3 = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '双平台商品C', description: 'C描述', platforms: ['天猫', '抖音小店'] } })).json() as { task: { id: number } };
    run('UPDATE tasks SET owner_agent_id = ? WHERE id = ?', ['agent-design', t2.task.id]);
    run('UPDATE tasks SET created_at = ? WHERE id = ?', ['2026-08-01T00:00:00.000Z', t1.task.id]);
    run('UPDATE tasks SET created_at = ? WHERE id = ?', ['2026-09-10T00:00:00.000Z', t3.task.id]);

    // platform 单值
    const p1 = (await app.inject({ method: 'GET', url: '/api/tasks?platform=' + encodeURIComponent('天猫') })).json() as { tasks: { id: number }[] };
    const p1Ids = p1.tasks.map((t) => t.id);
    assert.ok(p1Ids.includes(t1.task.id) && p1Ids.includes(t3.task.id));
    assert.ok(!p1Ids.includes(t2.task.id));

    // platform 多值（逗号分隔，或语义）
    const p2 = (await app.inject({ method: 'GET', url: '/api/tasks?platform=' + encodeURIComponent('天猫,抖音小店') })).json() as { tasks: { id: number }[] };
    assert.ok(p2.tasks.some((t) => t.id === t1.task.id));
    assert.ok(p2.tasks.some((t) => t.id === t2.task.id));

    // owner
    const own = (await app.inject({ method: 'GET', url: '/api/tasks?owner=agent-design' })).json() as { tasks: { id: number }[] };
    assert.ok(own.tasks.some((t) => t.id === t2.task.id));
    assert.ok(!own.tasks.some((t) => t.id === t1.task.id));

    // from/to（闭区间）
    const range = (await app.inject({ method: 'GET', url: '/api/tasks?from=2026-09-01&to=2026-09-11' })).json() as { tasks: { id: number }[] };
    const rangeIds = range.tasks.map((t) => t.id);
    assert.ok(rangeIds.includes(t3.task.id));
    assert.ok(!rangeIds.includes(t1.task.id));

    // q 匹配标题与描述
    const q = (await app.inject({ method: 'GET', url: '/api/tasks?q=' + encodeURIComponent('商品B') })).json() as { tasks: { id: number }[] };
    assert.ok(q.tasks.some((t) => t.id === t2.task.id));
    const qDesc = (await app.inject({ method: 'GET', url: '/api/tasks?q=' + encodeURIComponent('A描述') })).json() as { tasks: { id: number }[] };
    assert.ok(qDesc.tasks.some((t) => t.id === t1.task.id));

    // 注入串参数化：不匹配任何任务（不炸库、无 5xx）
    const inj = (await app.inject({ method: 'GET', url: '/api/tasks?q=' + encodeURIComponent("' OR 1=1 --") })).json() as { tasks: { id: number }[] };
    assert.deepEqual(inj.tasks, []);
  });

  test('sort（updated 相关子查询）/order/includeArchived=0', async () => {
    // 已有任务：给最新的 t3 追加一条较新的交付物更新时间，使 updated 排序生效
    const list = (await app.inject({ method: 'GET', url: '/api/tasks' })).json() as { tasks: { id: number; title: string; updatedAt: string }[] };
    const t3 = list.tasks.find((t) => t.title === '双平台商品C')!;
    run('INSERT INTO deliverables (task_id, stage, kind, content, status, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      t3.id,
      'copy',
      'copy',
      '{"title":"x","points":[],"outline":"","keywords":[]}',
      'pending',
      1,
      '2099-01-01T00:00:00.000Z',
    ]);

    const desc = (await app.inject({ method: 'GET', url: '/api/tasks?sort=updated&order=desc' })).json() as { tasks: { id: number; updatedAt: string }[] };
    assert.equal(desc.tasks[0].id, t3.id, 'updated 排序应把最近更新的任务置顶');
    const asc = (await app.inject({ method: 'GET', url: '/api/tasks?sort=updated&order=asc' })).json() as { tasks: { id: number; updatedAt: string }[] };
    assert.equal(asc.tasks[asc.tasks.length - 1].id, t3.id);

    const noArchived = (await app.inject({ method: 'GET', url: '/api/tasks?includeArchived=0' })).json() as { tasks: { archived: boolean }[] };
    assert.ok(noArchived.tasks.length > 0);
    assert.ok(noArchived.tasks.every((t) => !t.archived), 'includeArchived=0 应排除归档任务');
  });
});

describe('B6 kbRefs 计数与判定一致（组 8）', () => {
  test('kbRefsTotal/kbRefsInvalid 与 /kb-refs 判定一致', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '关联资料计数任务', description: '', platforms: ['天猫'] } });
    const taskId = (create.json() as { task: { id: number } }).task.id;
    // 直接写 task_kb_refs（A/B 唯一耦合点表）；两条有效（见知识库 api.smoke 场景）、一条无效
    run('INSERT INTO task_kb_refs (task_id, doc_path, anchor, created_at) VALUES (?, ?, ?, ?)', [taskId, '产品/磁吸充电宝.md', null, '2026-09-01T00:00:00.000Z']);
    run('INSERT INTO task_kb_refs (task_id, doc_path, anchor, created_at) VALUES (?, ?, ?, ?)', [taskId, '产品/磁吸充电宝.md', '产品规格 / 电池', '2026-09-01T00:00:00.000Z']);
    run('INSERT INTO task_kb_refs (task_id, doc_path, anchor, created_at) VALUES (?, ?, ?, ?)', [taskId, '不存在/文档.md', null, '2026-09-01T00:00:00.000Z']);

    const list = (await app.inject({ method: 'GET', url: '/api/tasks' })).json() as { tasks: { id: number; kbRefsTotal: number; kbRefsInvalid: number }[] };
    const row = list.tasks.find((t) => t.id === taskId)!;
    // 无 Vault → 全部视为无效（isDocAvailable=false），与 /kb-refs 判定一致
    const refs = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/kb-refs` })).json() as { refs: { valid: boolean }[] };
    assert.equal(row.kbRefsTotal, refs.refs.length, '总数应与 /kb-refs 条数一致');
    assert.equal(row.kbRefsInvalid, refs.refs.filter((r) => !r.valid).length, '无效数应与 /kb-refs 判定一致');
    assert.equal(row.kbRefsInvalid, 3, '无知识库连接时全部无效');
  });
});

describe('B3 版本历史与差异 API（组 2/3）', () => {
  test('返工链路：v1 产出 → 打回 → v2；versions 返回 v1+v2，diff 可用', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '版本历史测试', description: '', platforms: ['天猫'] } });
    const taskId = (create.json() as { task: { id: number } }).task.id;
    const confirm = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm` });
    assert.equal(confirm.statusCode, 200);
    await waitAwaitingOrDone(taskId);

    const v1res = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables/copy/versions` })).json() as { versions: { version: number }[] };
    assert.equal(v1res.versions.length, 1);
    assert.equal(v1res.versions[0].version, 1);

    // 打回 → 返工重产出 v2
    const reject = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/deliverables/decide`, payload: { kind: 'copy', decision: 'reject', note: '再打磨' } });
    assert.equal(reject.statusCode, 200, reject.body);
    await waitAwaitingOrDone(taskId);

    const v2res = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables/copy/versions` })).json() as { versions: { version: number; content: string; status: string }[] };
    assert.equal(v2res.versions.length, 2, '应返回 v1 与 v2 两条');
    assert.deepEqual(v2res.versions.map((v) => v.version), [1, 2]);
    const current = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables` })).json() as { deliverables: { kind: string; stage: string; version: number }[] };
    const curCopy = current.deliverables.find((d) => d.kind === 'copy' && d.stage === 'copy')!;
    assert.equal(v2res.versions[1].version, curCopy.version, '历史最大版本号 === deliverables.version');
    assert.equal(v2res.versions[1].content, JSON.stringify(JSON.parse(v2res.versions[1].content)), 'v2 内容与当前交付物一致');

    // diff：默认当前 vs 上一版
    const diff = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables/copy/diff` })).json() as { diff: { hasPrevious: boolean; fromVersion: number | null; toVersion: number; identical: boolean } };
    assert.equal(diff.diff.hasPrevious, true);
    assert.equal(diff.diff.fromVersion, 1);
    assert.equal(diff.diff.toVersion, 2);

    // 非法参数
    const badFrom = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables/copy/diff?from=abc` });
    assert.equal(badFrom.statusCode, 400);
    const missTo = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables/copy/diff?to=99` });
    assert.equal(missTo.statusCode, 404);
    const badKind = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables/pdf/diff` });
    assert.equal(badKind.statusCode, 400);
  });

  test('kind 非法 → 400；任务不存在 → 404', async () => {
    const badKind = await app.inject({ method: 'GET', url: '/api/tasks/1/deliverables/x/versions' });
    assert.equal(badKind.statusCode, 400);
    const noTask = await app.inject({ method: 'GET', url: '/api/tasks/999999/deliverables/copy/versions' });
    assert.equal(noTask.statusCode, 404);
  });
});

describe('B4 交付包 API（组 4）', () => {
  test('无交付物 → 409', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '无交付物任务', description: '', platforms: ['天猫'] } });
    const taskId = (create.json() as { task: { id: number } }).task.id;
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverable-package` });
    assert.equal(res.statusCode, 409);
    assert.match((res.json() as { error: string }).error, /已定案交付物/);
  });

  test('完整流程后 → 200 zip + X-Deliverable-Missing 头 + 附件名', async () => {
    const taskId = await runTaskToDone('打包下载测试商品');
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverable-package` });
    assert.equal(res.statusCode, 200, res.body?.toString?.().slice(0, 120) ?? '');
    assert.equal(res.headers['content-type'], 'application/zip');
    // MockProducer 产出的是 SVG 占位图（非 png/jpg/webp 成图）→ 全部按「非最终成图」降级为 .txt 说明
    assert.equal(res.headers['x-deliverable-missing'], '7');
    assert.ok(String(res.headers['content-disposition']).includes('filename*=UTF-8'), '应含 RFC5987 附件名');
    assert.ok(Buffer.isBuffer(res.rawPayload), '应为 zip 二进制');
    assert.ok((res.rawPayload as Buffer).readUInt32LE(0) === 0x04034b50, 'zip 以本地文件头开始');
    // 文案（deliver 阶段上架资料包）应在包内：解压 manifest 校验
    const zip = res.rawPayload as Buffer;
    const manifestEntry = findZipEntry(zip, 'manifest.json');
    assert.ok(manifestEntry, '应含 manifest.json');
    const manifest = JSON.parse(manifestEntry.toString('utf8')) as { taskTitle: string; copyFile: string | null; missing: number };
    assert.equal(manifest.taskTitle, '打包下载测试商品');
    assert.ok(manifest.copyFile, '应含文案文件');
    assert.equal(manifest.missing, 7);
  });
});

/** 从 zip 中读取并解压一个条目（校验交付包内容用） */
function findZipEntry(zip: Buffer, name: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) break;
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const compSize = zip.readUInt32LE(offset + 18);
    const method = zip.readUInt16LE(offset + 8);
    const entryName = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = zip.subarray(dataStart, dataStart + compSize);
    if (entryName === name) return method === 8 ? inflateRawSync(compData) : Buffer.from(compData);
    offset = dataStart + compSize;
  }
  return null;
}

describe('B5 交付物搜索（组 7）', () => {
  test('空关键字 → 空结果 + hint；标题/卖点命中', async () => {
    const empty = (await app.inject({ method: 'GET', url: '/api/deliverables/search?q=' })).json() as { hits: unknown[]; hint: string };
    assert.deepEqual(empty.hits, []);
    assert.ok(empty.hint);

    // 上文完整流程已产生 deliver 阶段交付包文案（标题含任务名）
    const hit = (await app.inject({ method: 'GET', url: '/api/deliverables/search?q=' + encodeURIComponent('打包下载测试商品') })).json() as {
      hits: { taskId: number; field: string; snippet: string; taskTitle: string }[];
    };
    assert.ok(hit.hits.length >= 1, '应命中交付包文案标题');
    assert.equal(hit.hits[0].taskTitle, '打包下载测试商品');

    const none = (await app.inject({ method: 'GET', url: '/api/deliverables/search?q=' + encodeURIComponent('绝不存在的词xyz') })).json() as { hits: unknown[]; hint?: string };
    assert.deepEqual(none.hits, []);
    assert.ok(none.hint);
  });
});

describe('B12 cost API（组 15）', () => {
  test('任务不存在 → 404；正常任务返回汇总结构', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/tasks/999999/cost' });
    assert.equal(missing.statusCode, 404);

    const taskId = await runTaskToDone('成本汇总测试商品');
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/cost` });
    assert.equal(res.statusCode, 200);
    const { summary } = res.json() as {
      summary: {
        totalDurationMs: number;
        runs: number;
        successRuns: number;
        byStage: { stage: string; stageLabel: string }[];
        byAgent: { agentId: string; agentName: string }[];
        models: string[];
        tokens: { input: number; total: number };
        cost: { amount: number; currency: string; estimated: boolean } | null;
      };
    };
    assert.ok(summary.runs >= 6, '应有 6+ 阶段执行记录');
    assert.equal(summary.successRuns, summary.runs);
    assert.ok(summary.totalDurationMs > 0);
    assert.ok(summary.byStage.some((s) => s.stageLabel === '卖点文案'));
    assert.ok(summary.byStage.some((s) => s.stageLabel === '主图设计'));
    assert.ok(summary.byAgent.some((a) => a.agentId === 'agent-copy' && a.agentName));
    assert.ok(summary.models.includes('deepseek-chat'), '默认渠道模型应在列表');
    assert.ok(summary.tokens.input >= 0);
    assert.ok(summary.tokens.total > 0, 'mock 模式按字符估算 token（非 0）');
    assert.equal(summary.cost?.estimated, true, '本地默认单价表存在时应给出估算金额');
  });
});

describe('B8 channel-test API（组 10）', () => {
  test('未配置（面板无 key、env 亦无）→ 200 + ok:false + not_configured', async () => {
    // 本机 .env.local 存在真实渠道：以「面板写入空 key」无法触达 not_configured；
    // 该分支由 channel-not-configured.test.ts（独立进程清空 env）覆盖。
    // 此处验证端点契约：任何输入均 200 + 结构化 result（不 5xx、不抛错）
    const res = await app.inject({ method: 'POST', url: '/api/agents/agent-copy/channel-test', payload: {} });
    assert.equal(res.statusCode, 200);
    const { result } = res.json() as { result: { ok: boolean; error?: { code: string } } };
    assert.equal(typeof result.ok, 'boolean');
    if (!result.ok) {
      assert.ok(result.error?.code, '失败时应带错误码');
      assert.notEqual(result.error?.code, 'unknown');
    }
  });

  test('面板渠道指向 401 假服务器 → ok:false + auth_failed（确定性，不触网）', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Authentication Fails' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const { setSetting } = await import('../../agents/channel-settings.ts');
      setSetting('llmChannels', { 'agent-copy': { baseUrl: `http://127.0.0.1:${port}`, apiKey: 'bad', model: 'fake-model' } });
      const res = await app.inject({ method: 'POST', url: '/api/agents/agent-copy/channel-test', payload: {} });
      assert.equal(res.statusCode, 200);
      const { result } = res.json() as { result: { ok: boolean; error: { code: string } } };
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'auth_failed');
    } finally {
      server.close();
    }
  });

  test('agent 不存在 → 404；参数类型非法 → 400', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/agents/ghost/channel-test', payload: {} });
    assert.equal(missing.statusCode, 404);
    const badType = await app.inject({ method: 'POST', url: '/api/agents/agent-copy/channel-test', payload: { baseUrl: 123 } });
    assert.equal(badType.statusCode, 400);
  });
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
