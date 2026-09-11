/**
 * 知识库 REST 端到端冒烟测试（板块 B 全链路 + 板块 A 耦合点回归）。
 * 运行：pnpm --filter @workbench/backend exec tsx src/knowledge/__tests__/api.smoke.ts
 *
 * 覆盖 OpenSpec 任务：7.1（配置→索引→浏览/搜索→星图→热点→关联→注入→追溯）、7.2（板块独立性）
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'workbench-kbapi-'));
process.env.WORKBENCH_DB = join(dir, 'api.db');
// 必须在 import ../../index.ts 之前设置：index.ts 仅在 NODE_ENV !== 'test' 时启动真实服务
process.env.NODE_ENV = 'test';
const VAULT = join(dir, 'vault');
process.env.WORKBENCH_VAULT_ROOT = VAULT;
// 关注域配置隔离到临时目录，避免测试写入本机 backend/config/attention.json
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { installSmartProducer } = await import('../../agents/smart-producer.ts');
const { buildApp } = await import('../../index.ts');
const { ensureKnowledgeSchema } = await import('../schema.ts');
const { saveVaultConfig } = await import('../vault.ts');
const { buildKnowledgeContext } = await import('../refs.ts');

let app: FastifyInstance;

function writeVault(rel: string, content: string): void {
  const abs = join(VAULT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** 轮询等待索引完成（验证「接口返回进行中状态」这一契约） */
async function waitIndexed(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/stats' });
    const { stats } = res.json() as { stats: { indexing: boolean } };
    if (!stats.indexing) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('索引超时未完成');
}

before(async () => {
  writeVault('产品/磁吸充电宝.md', `---
title: 磁吸充电宝产品资料
tags: [产品, 充电]
---

# 产品规格

无线磁吸充电宝，15W 磁吸快充，容量 10000mAh。

## 电池

锂聚合物电芯，循环寿命 500 次。

# 品牌要求

文案语气克制专业。

参见 [[品牌规范]]。
`);
  writeVault('品牌/品牌规范.md', `---
title: 品牌规范
tags: [品牌, 充电]
---

# 色彩规范

主色为紫色，禁止使用高饱和撞色。
`);
  writeVault('.obsidian/workspace.md', '# 不应进入索引\n');

  ensureSchema();
  ensureKnowledgeSchema();
  seed();
  installSmartProducer();
  saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
  app = await buildApp();
  await app.ready();
});

describe('7.1 端到端：Vault → 索引 → 浏览/搜索 → 星图 → 热点 → 关联 → 注入 → 追溯', () => {
  test('步骤1 健康检查与知识库状态（已连接）', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);

    const res = await app.inject({ method: 'GET', url: '/api/knowledge/status' });
    assert.equal(res.statusCode, 200);
    const { status } = res.json() as { status: { state: string; root: string; source: string; range: { excludeDirs: string[] } } };
    assert.equal(status.state, 'connected');
    assert.equal(status.source, 'settings', '本用例通过设置面板写入 Vault 配置');
    assert.ok(status.root, '应返回生效的 Vault 根路径');
    assert.ok(status.range.excludeDirs.includes('.obsidian'), '应返回生效的排除目录');
  });

  test('环境变量兜底：设置面板未配置时仍可连接', async () => {
    const { saveVaultConfig } = await import('../vault.ts');
    saveVaultConfig({ root: '' }); // 清空设置面板配置 → 回落到 WORKBENCH_VAULT_ROOT
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/status' });
    const { status } = res.json() as { status: { state: string; source: string; root: string } };
    assert.equal(status.state, 'connected', '环境变量应兜底生效');
    assert.equal(status.source, 'env');
    saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
  });

  test('步骤2 触发索引：接口立即返回，索引在后台完成', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/knowledge/reindex' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { started: boolean; status: { state: string } };
    assert.equal(body.status.state, 'connected');
    await waitIndexed();

    const stats = (await app.inject({ method: 'GET', url: '/api/knowledge/stats' })).json() as {
      stats: { docCount: number; tagCount: number; dirCount: number; edgeCount: number; indexedAt: string; indexing: boolean; lastError: string | null };
    };
    assert.equal(stats.stats.indexing, false);
    assert.equal(stats.stats.docCount, 2, '2 篇文档（.obsidian 被排除）');
    assert.equal(stats.stats.tagCount, 3, '标签：产品/充电/品牌');
    assert.equal(stats.stats.dirCount, 2);
    assert.ok(stats.stats.edgeCount > 0, '应建立关系边');
    assert.ok(stats.stats.indexedAt, '应有索引时间');
    assert.ok(!stats.stats.lastError, `索引不应有错误：${stats.stats.lastError}`);
  });

  test('步骤3 浏览：目录 / 标签 / 文档列表 / 阅读原文', async () => {
    const dirs = (await app.inject({ method: 'GET', url: '/api/knowledge/dirs' })).json() as { dirs: { dir: string; count: number }[] };
    assert.ok(dirs.dirs.some((d) => d.dir === '产品'));
    assert.ok(dirs.dirs.some((d) => d.dir === '品牌'));

    const tags = (await app.inject({ method: 'GET', url: '/api/knowledge/tags' })).json() as { tags: { tag: string; count: number }[] };
    assert.ok(tags.tags.some((t) => t.tag === '充电' && t.count === 2), '共享标签计数应为 2');

    const byTag = (await app.inject({ method: 'GET', url: '/api/knowledge/docs?tag=' + encodeURIComponent('充电') })).json() as { docs: unknown[] };
    assert.equal(byTag.docs.length, 2);

    const byDir = (await app.inject({ method: 'GET', url: '/api/knowledge/docs?dir=' + encodeURIComponent('产品') })).json() as { docs: unknown[] };
    assert.equal(byDir.docs.length, 1);

    const doc = (await app.inject({ method: 'GET', url: '/api/knowledge/doc?path=' + encodeURIComponent('产品/磁吸充电宝.md') })).json() as {
      doc: { title: string; content: string; anchors: { anchor: string }[] };
    };
    assert.equal(doc.doc.title, '磁吸充电宝产品资料');
    assert.ok(doc.doc.content.includes('10000mAh'));
    assert.ok(doc.doc.anchors.some((a) => a.anchor === '产品规格 / 电池'), '应返回章节锚点供片段选择');

    const missing = await app.inject({ method: 'GET', url: '/api/knowledge/doc?path=' + encodeURIComponent('不存在.md') });
    assert.equal(missing.statusCode, 404);
  });

  test('步骤4 搜索：中文长词（trigram）与短词（LIKE 兜底）均命中', async () => {
    const long = (await app.inject({ method: 'GET', url: '/api/knowledge/search?q=' + encodeURIComponent('充电宝') })).json() as {
      hits: { path: string; matchMode: string; snippet: string; title: string }[];
    };
    assert.ok(long.hits.length >= 1);
    assert.equal(long.hits[0].matchMode, 'fts');
    assert.ok(long.hits[0].snippet.includes('充电宝'));

    const short = (await app.inject({ method: 'GET', url: '/api/knowledge/search?q=' + encodeURIComponent('磁吸') })).json() as { hits: { matchMode: string }[] };
    assert.ok(short.hits.length >= 1, '短词应经 LIKE 兜底命中');
    assert.equal(short.hits[0].matchMode, 'like');

    const none = (await app.inject({ method: 'GET', url: '/api/knowledge/search?q=' + encodeURIComponent('绝不存在的词xyz') })).json() as { hits: unknown[]; hint?: string };
    assert.deepEqual(none.hits, []);
    assert.ok(none.hint);
  });

  test('步骤5 知识星图：图数据与节点详情/跳转', async () => {
    const graph = (await app.inject({ method: 'GET', url: '/api/knowledge/graph' })).json() as {
      graph: { nodes: { id: string; kind: string; label: string }[]; edges: { source: string; target: string; kind: string }[] };
    };
    assert.ok(graph.graph.nodes.some((n) => n.kind === 'doc' && n.label === '磁吸充电宝产品资料'));
    assert.ok(graph.graph.nodes.some((n) => n.kind === 'tag' && n.label === '充电'));
    assert.ok(graph.graph.edges.some((e) => e.kind === 'link'), '应有文档间链接边');

    const nodeId = 'doc:' + '产品/磁吸充电宝.md';
    const detail = (await app.inject({ method: 'GET', url: '/api/knowledge/node?id=' + encodeURIComponent(nodeId) })).json() as {
      detail: { outLinks: { path: string }[]; sharedTagDocs: { path: string }[] };
    };
    assert.deepEqual(detail.detail.outLinks.map((x) => x.path), ['品牌/品牌规范.md']);
    assert.ok(detail.detail.sharedTagDocs.some((x) => x.path === '品牌/品牌规范.md'));

    const tagDetail = (await app.inject({ method: 'GET', url: '/api/knowledge/node?id=' + encodeURIComponent('tag:充电') })).json() as { detail: { sharedTagDocs: unknown[] } };
    assert.equal(tagDetail.detail.sharedTagDocs.length, 2);

    const notFound = await app.inject({ method: 'GET', url: '/api/knowledge/node?id=' + encodeURIComponent('doc:none.md') });
    assert.equal(notFound.statusCode, 404);
  });

  test('步骤6 热点面板：真实公共 API 或优雅降级（两态都不抛错）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hot' });
    assert.equal(res.statusCode, 200);
    const { panel } = res.json() as {
      panel: {
        status: string;
        counts: { upstream: number };
        tiers: { mustRead: unknown[]; browse: unknown[]; other: unknown[] };
        error: unknown;
        sourceUrl: string;
        sourceName: string;
        sources: { id: string; label: string; status: string }[];
      };
    };
    assert.ok(['live', 'stale', 'unavailable'].includes(panel.status), `未知状态：${panel.status}`);
    // hot-intel B10：单源 sourceUrl 已由 sources[] 逐源状态取代（多源聚合无单一源 URL）
    assert.ok(panel.sourceName.length > 0, '应标注数据源摘要');
    assert.ok(Array.isArray(panel.sources) && panel.sources.length > 0, '应含逐源状态（3.8）');
    if (panel.status === 'live') {
      const total = panel.tiers.mustRead.length + panel.tiers.browse.length + panel.tiers.other.length;
      assert.ok(total > 0, 'live 状态应有分层内容');
      assert.ok(panel.counts.upstream >= total);
    } else {
      assert.ok(panel.error, '非 live 状态应给出错误说明');
    }
  });

  test('步骤7 新建任务关联资料（唯一耦合点）→ 追溯 → 注入', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: '磁吸充电宝新品上架',
        description: '新品全套物料',
        platforms: ['天猫', '抖音小店'],
        kbRefs: [{ docPath: '产品/磁吸充电宝.md', anchor: '产品规格 / 电池' }, { docPath: '品牌/品牌规范.md' }],
      },
    });
    assert.equal(create.statusCode, 200, create.body);
    const { task } = create.json() as { task: { id: number; column: string } };
    assert.equal(task.column, 'planned', '板块 A 行为不变：创建后仍在规划中');

    // 追溯：任务详情读关联资料
    const refsRes = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/kb-refs` })).json() as {
      refs: { docPath: string; title: string; anchor: string | null; valid: boolean }[];
    };
    assert.equal(refsRes.refs.length, 2);
    assert.equal(refsRes.refs[0].anchor, '产品规格 / 电池', '应保留片段范围');
    assert.equal(refsRes.refs[0].title, '磁吸充电宝产品资料', '应可追溯标题');
    assert.ok(refsRes.refs.every((r) => r.valid));

    // 注入：producer 上下文含所选片段
    const ctx = await buildKnowledgeContext(task.id);
    assert.ok(ctx.includes('锂聚合物电芯'), '应注入所选章节片段');
    assert.ok(ctx.includes('主色为紫色'), '应注入第二份资料');
    assert.ok(ctx.includes('产品规格 / 电池'), '应标注片段范围');
    assert.ok(!ctx.includes('文案语气克制专业'), '不应注入未选择的章节');

    // 确认开工：板块 A 照常推进（注入不改变状态机行为）
    const confirm = await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/confirm` });
    assert.equal(confirm.statusCode, 200);
    const advanced = confirm.json() as { task: { column: string; id: number } };
    assert.ok(['progress', 'awaiting', 'done'].includes(advanced.task.column), `任务应正常推进，实际 ${advanced.task.column}`);
  });

  test('步骤8 超限与非法关联被拒绝（不产生半成品任务）', async () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ docPath: '产品/磁吸充电宝.md', anchor: `章节${i}` }));
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '超限', description: '', platforms: ['天猫'], kbRefs: seven } });
    assert.equal(res.statusCode, 400);
    assert.match((res.json() as { error: string }).error, /最多 6 份/);

    const bad = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '非法资料', description: '', platforms: ['天猫'], kbRefs: [{ docPath: '不在库/xx.md' }] } });
    assert.equal(bad.statusCode, 400);
    assert.match((bad.json() as { error: string }).error, /不存在/);

    // 校验失败时任务不应被创建
    const tasks = (await app.inject({ method: 'GET', url: '/api/tasks' })).json() as { tasks: { title: string }[] };
    assert.ok(!tasks.tasks.some((t) => t.title === '超限' || t.title === '非法资料'), '校验失败不应创建任务');
  });

  test('步骤9 关注域配置读写：自定义关注域后重新分层生效', async () => {
    const current = (await app.inject({ method: 'GET', url: '/api/hot/attention' })).json() as { config: { domains: { id: string; label: string }[] } };
    assert.ok(current.config.domains.length >= 5, '默认应带电商化关注域');

    const put = await app.inject({
      method: 'PUT',
      url: '/api/hot/attention',
      payload: { domains: [{ id: 'custom', label: '自定义域', keywords: ['磁吸'] }], minimumSources: 1 },
    });
    assert.equal(put.statusCode, 200);
    const saved = (put.json() as { config: { domains: { id: string }[]; minimumSources: number } }).config;
    assert.equal(saved.domains.length, 1);
    assert.equal(saved.minimumSources, 1);

    const readBack = (await app.inject({ method: 'GET', url: '/api/hot/attention' })).json() as { config: { domains: { id: string }[] } };
    assert.equal(readBack.config.domains[0].id, 'custom', '配置应持久化到本地文件');
  });

  test('步骤10 任务热点背景路由（2.4）：GET 空 / PUT 往返 / 去重 / 超限 400 / kb 表不受影响', async () => {
    const create = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '热点背景路由任务', description: '', platforms: ['天猫'] } });
    assert.equal(create.statusCode, 200, create.body);
    const { task } = create.json() as { task: { id: number } };

    // ① GET 空任务 → {refs: []}
    const empty = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/hot-refs` })).json() as { refs: unknown[] };
    assert.deepEqual(empty.refs, []);

    // ② PUT 2 条 → GET 返回 2 条且字段完整
    const two = [
      { hotId: 'pai-a1b2c3d4e5f6g7h8i9j0k1l2m', title: '热点一：某平台新规', sourceId: 'pai-news', sourceName: '电商派快讯', evidence: 'traceable', url: 'https://www.pai.com.cn/news/a1b2c3d4e5f6g7h8i9j0k1l2m', latestAt: '2026-09-11T09:00:00.000Z' },
      { hotId: '100ec-6660001', title: '热点二：某品类销量增长', sourceId: '100ec-24h', sourceName: '网经社 24h 播报', evidence: 'single-source', latestAt: '2026-09-11T16:00:00.000Z' },
    ];
    const put2 = await app.inject({ method: 'PUT', url: `/api/tasks/${task.id}/hot-refs`, payload: { refs: two } });
    assert.equal(put2.statusCode, 200, put2.body);
    const got = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/hot-refs` })).json() as { refs: { hotId: string; title: string; sourceId: string; sourceName: string; evidence: string; url: string | null; latestAt: string | null }[] };
    assert.equal(got.refs.length, 2);
    assert.equal(got.refs[0].hotId, 'pai-a1b2c3d4e5f6g7h8i9j0k1l2m');
    assert.equal(got.refs[0].evidence, 'traceable');
    assert.equal(got.refs[0].url, 'https://www.pai.com.cn/news/a1b2c3d4e5f6g7h8i9j0k1l2m');

    // ③ 重复 PUT 同一条 → 仍 1 条（hotId 去重）
    const dup = await app.inject({ method: 'PUT', url: `/api/tasks/${task.id}/hot-refs`, payload: { refs: [two[0]] } });
    assert.equal(dup.statusCode, 200, dup.body);
    const afterDup = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/hot-refs` })).json() as { refs: unknown[] };
    assert.equal(afterDup.refs.length, 1);

    // ④ 超额 → 400 且错误信息可读
    const seven = Array.from({ length: 7 }, (_, i) => ({ hotId: `h${i}`, title: `热点${i}` }));
    const over = await app.inject({ method: 'PUT', url: `/api/tasks/${task.id}/hot-refs`, payload: { refs: seven } });
    assert.equal(over.statusCode, 400);
    assert.match((over.json() as { error: string }).error, /最多挂 6 条/);

    // ⑤ 上述请求后 task_kb_refs 仍为空（独立表，互不影响）
    const kbRefs = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/kb-refs` })).json() as { refs: unknown[] };
    assert.deepEqual(kbRefs.refs, []);
  });
});

describe('7.2 板块独立性回归', () => {
  test('知识库断开后，板块 A 全流程照常（新建→确认→产出→拍板）', async () => {
    // 断开 Vault 并让索引清空
    saveVaultConfig({ root: join(dir, 'not-exists') });
    await app.inject({ method: 'POST', url: '/api/knowledge/reindex' });
    await waitIndexed();

    const status = (await app.inject({ method: 'GET', url: '/api/knowledge/status' })).json() as { status: { state: string; reason?: string } };
    assert.equal(status.status.state, 'disconnected');
    assert.ok(status.status.reason, '应给出未连接原因');

    // 知识库相关接口全部优雅返回（非 5xx）
    for (const url of ['/api/knowledge/stats', '/api/knowledge/dirs', '/api/knowledge/tags', '/api/knowledge/docs', '/api/knowledge/graph', '/api/knowledge/search?q=x']) {
      const res = await app.inject({ method: 'GET', url });
      assert.ok(res.statusCode < 500, `${url} 返回 ${res.statusCode}`);
    }

    // 板块 A：新建任务（不带关联资料）→ 确认开工 → 产出 → 拍板
    const create = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: '知识库断开时的任务', description: '纯文案更新', platforms: ['京东'] },
    });
    assert.equal(create.statusCode, 200);
    const taskId = (create.json() as { task: { id: number } }).task.id;

    const confirm = await app.inject({ method: 'POST', url: `/api/tasks/${taskId}/confirm` });
    assert.equal(confirm.statusCode, 200);
    const t = (confirm.json() as { task: { column: string; stage: string } }).task;
    assert.ok(['progress', 'awaiting', 'done'].includes(t.column), '任务应正常推进');

    // 关联资料为空，注入跳过
    const refs = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/kb-refs` })).json() as { refs: unknown[] };
    assert.deepEqual(refs.refs, []);
    assert.equal(await buildKnowledgeContext(taskId), '', '未关联资料时不注入，上下文与既有完全一致');

    // 拍板接口可用
    const deliverables = (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/deliverables` })).json() as { deliverables: { kind: string }[] };
    assert.ok(Array.isArray(deliverables.deliverables));
  });

  test('恢复连接后知识库恢复可用', async () => {
    saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
    await app.inject({ method: 'POST', url: '/api/knowledge/reindex' });
    await waitIndexed();
    const stats = (await app.inject({ method: 'GET', url: '/api/knowledge/stats' })).json() as { stats: { docCount: number } };
    assert.equal(stats.stats.docCount, 2, '恢复连接后索引重建成功');
  });

  test('Vault 文件在整轮测试后未被修改（只读边界端到端）', () => {
    const content = readFileSync(join(VAULT, '产品/磁吸充电宝.md'), 'utf8');
    assert.ok(content.includes('10000mAh'));
    assert.ok(content.startsWith('---'), 'frontmatter 未被改写');
    // 清理临时目录
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
});
