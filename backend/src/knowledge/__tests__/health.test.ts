/**
 * 知识健康度测试（knowledge-ux：1.3 预设配置化 / 2.7 文档使用率 / 2.8 孤岛判定 / 2.9 图谱 isolated 一致 /
 * 2.10 health 路由 / 2.11 只读边界 / 3.10 图谱既有字段不回归 —— 后端断言部分）。
 * 运行：pnpm --filter @workbench/backend exec tsx src/knowledge/__tests__/health.test.ts
 *
 * 测试库隔离：独立 mkdtemp 临时库，与其它测试并行安全。
 */
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'workbench-kbhealth-'));
process.env.WORKBENCH_DB = join(dir, 'health.db');
delete process.env.WORKBENCH_VAULT_ROOT;
process.env.NODE_ENV = 'test';
/** 测试用 Vault（knowledgeHealth 的「已连接」门禁需要真实存在的目录） */
const VAULT = join(dir, 'vault');
mkdirSync(VAULT, { recursive: true });

const { ensureSchema } = await import('../../db/ensure.ts');
const { all, get, run } = await import('../../db/client.ts');
const { ensureKnowledgeSchema, KT } = await import('../schema.ts');
const { saveVaultConfig, resolveVaultConfig } = await import('../vault.ts');
const { computeDocUsageRate, islandDocPaths, knowledgeHealth } = await import('../health.ts');
const { graphData } = await import('../graph.ts');
const { knowledgeStatus } = await import('../docs.ts');

/** 直接向 knowledge_docs 插入一行（测试构造用） */
function insertDoc(path: string, tags: string[], dirPath = ''): void {
  run(`INSERT INTO ${KT.docs} (path,title,dir_path,tags,body,hash,mtime,size) VALUES (?,?,?,?,?,?,?,?)`, [
    path,
    path.replace(/\.md$/i, ''),
    dirPath,
    JSON.stringify(tags),
    `# ${path}\n\n正文。`,
    'h',
    '2026-09-11T00:00:00.000Z',
    10,
  ]);
}

/** 清空知识库数据表（各区段构造各自样本） */
function clearKnowledge(): void {
  run(`DELETE FROM ${KT.docs}`);
  run(`DELETE FROM ${KT.links}`);
  run(`DELETE FROM ${KT.taskRefs}`);
}

/** 构造 A/B/C/D 样本（spec 孤岛判定场景）：A 链接到 B；C 无链接且标签独有；D 无链接但与 B 共享「产品资料」 */
function seedIslandSample(): void {
  clearKnowledge();
  insertDoc('a.md', ['产品资料', '充电'], '10_raw/products');
  insertDoc('b.md', ['产品资料', '品牌'], 'wiki/brand');
  insertDoc('c.md', ['独有标签'], '10_raw/notes');
  insertDoc('d.md', ['品牌'], 'wiki/brand');
  // A → B 文档间链接（与索引器格式一致）
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['a.md', 'b.md', 'link']);
  // 文档-标签归属边（与索引器格式一致：target 为 tag:<标签>）
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['a.md', 'tag:产品资料', 'tag']);
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['a.md', 'tag:充电', 'tag']);
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['b.md', 'tag:产品资料', 'tag']);
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['b.md', 'tag:品牌', 'tag']);
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['c.md', 'tag:独有标签', 'tag']);
  run(`INSERT INTO ${KT.links} (source_path,target,kind) VALUES (?,?,?)`, ['d.md', 'tag:品牌', 'tag']);
}

let app: FastifyInstance;

/**
 * 路由测试说明：真实路由 `app.get('/api/knowledge/health', async () => ({ health: knowledgeHealth() }))`
 * 注册于 knowledgeRoutes。因并行梯队 T3 进行中的 `knowledge/hot-sources/fetch.ts` 使用 TS 参数属性
 * （Node strip-only 不支持）且 tsx/esbuild 在当前沙箱被 EPERM 拦截，无法加载完整 knowledgeRoutes 模块；
 * 本测试用等价 handler 注册到最小 Fastify 实例验证 HTTP 层契约（200 + 结构 + 空值降级），
 * 函数级断言直接调用 health.ts。
 */
before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
  app = Fastify();
  app.get('/api/knowledge/health', async () => ({ health: knowledgeHealth() }));
  await app.ready();
});

describe('1.3 业务预设依据配置化（后端）', () => {
  test('未配置 presetDirs 时回退内置默认（只看产品资料 → 10_raw/products，只看品牌规范 → wiki/brand）', () => {
    saveVaultConfig({ root: '' });
    const cfg = resolveVaultConfig();
    assert.equal(cfg.presetDirs.products, '10_raw/products');
    assert.equal(cfg.presetDirs.brand, 'wiki/brand');
    const st = knowledgeStatus();
    assert.equal(st.presets?.type, 'dir');
    assert.equal(st.presets?.products, '10_raw/products');
    assert.equal(st.presets?.brand, 'wiki/brand');
  });

  test('保存 presetDirs 后重新解析返回新值', () => {
    saveVaultConfig({ root: '', presetDirs: { products: '20_products', brand: 'wiki/brand2' } });
    const cfg = resolveVaultConfig();
    assert.equal(cfg.presetDirs.products, '20_products');
    assert.equal(cfg.presetDirs.brand, 'wiki/brand2');
    const st = knowledgeStatus();
    assert.equal(st.presets?.products, '20_products');
    assert.equal(st.presets?.brand, 'wiki/brand2');
    // 复位为未配置，避免影响后续断言
    saveVaultConfig({ root: '' });
  });

  test('presetDirs 传空字符串/非法时回退内置默认且不抛异常（Vault 未连接场景）', () => {
    saveVaultConfig({ root: '', presetDirs: { products: '  ', brand: '' } });
    const st = knowledgeStatus();
    assert.equal(st.state, 'disconnected');
    assert.equal(st.presets?.products, '10_raw/products');
    assert.equal(st.presets?.brand, 'wiki/brand');
    saveVaultConfig({ root: '' });
  });
});

describe('2.7 文档使用率（computeDocUsageRate）', () => {
  test('12 篇文档、3 篇被关联（其中 1 篇被 2 个任务关联）→ { linkedDocs: 3, totalDocs: 12, ratio: 0.25 }', () => {
    clearKnowledge();
    for (let i = 1; i <= 12; i++) insertDoc(`p${i}.md`, []);
    run(`INSERT INTO ${KT.taskRefs} (task_id,doc_path,title,anchor,note,created_at) VALUES (1,'p1.md','t','', '', '2026-09-11T00:00:00.000Z')`);
    run(`INSERT INTO ${KT.taskRefs} (task_id,doc_path,title,anchor,note,created_at) VALUES (1,'p2.md','t','', '', '2026-09-11T00:00:00.000Z')`);
    run(`INSERT INTO ${KT.taskRefs} (task_id,doc_path,title,anchor,note,created_at) VALUES (2,'p1.md','t','', '', '2026-09-11T00:00:00.000Z')`);
    run(`INSERT INTO ${KT.taskRefs} (task_id,doc_path,title,anchor,note,created_at) VALUES (2,'p3.md','t','', '', '2026-09-11T00:00:00.000Z')`);
    const r = computeDocUsageRate();
    assert.equal(r.linkedDocs, 3, '重复关联同一文档只计一次（分子为 3 而非 4）');
    assert.equal(r.totalDocs, 12);
    assert.ok(Math.abs((r.ratio ?? -1) - 0.25) < 1e-9);
  });

  test('task_kb_refs 中已不在当前索引的 doc_path 不计入分子', () => {
    // 当前索引 12 篇（p1..p12）；补一条指向 gone.md 的失效关联
    run(`INSERT INTO ${KT.taskRefs} (task_id,doc_path,title,anchor,note,created_at) VALUES (3,'gone.md','t','', '', '2026-09-11T00:00:00.000Z')`);
    const r = computeDocUsageRate();
    assert.equal(r.linkedDocs, 3, '失效关联不计入分子');
    assert.equal(r.totalDocs, 12, '分母仍为当前已索引文档总数');
    assert.ok(Math.abs((r.ratio ?? -1) - 0.25) < 1e-9);
  });

  test('已索引文档总数为 0 时 ratio 为 null，不出现除零/NaN', () => {
    clearKnowledge();
    const r = computeDocUsageRate();
    assert.equal(r.totalDocs, 0);
    assert.equal(r.linkedDocs, 0);
    assert.equal(r.ratio, null);
  });
});

describe('2.8 孤岛判定（islandDocPaths）', () => {
  test('A 链接 B / B 被 A 链接 / C 无链接且标签独有 / D 无链接但与 B 共享「产品资料」→ 孤岛集合为 {c.md}，孤岛数 1', () => {
    seedIslandSample();
    const islands = islandDocPaths();
    assert.deepEqual(islands, ['c.md']);
  });

  test('无标签且无链接的文档计入孤岛', () => {
    clearKnowledge();
    insertDoc('e.md', []);
    const islands = islandDocPaths();
    assert.deepEqual(islands, ['e.md']);
  });

  test('标签比较按 trim 后原字符串：带首尾空格的「品牌」与「品牌」视为同一标签（共享 → 不算孤岛）', () => {
    clearKnowledge();
    insertDoc('x.md', ['品牌']);
    insertDoc('y.md', [' 品牌 ']);
    // x 与 y 共享 trim 后标签「品牌」→ 均不算孤岛
    const islands = islandDocPaths();
    assert.deepEqual(islands, []);
  });

  test('只有独有标签的文档仍算孤岛（「有标签边」不等于「有共享标签」，design.md D4 反例）', () => {
    clearKnowledge();
    insertDoc('s1.md', ['独有1']);
    insertDoc('s2.md', ['独有2']);
    const islands = islandDocPaths();
    assert.deepEqual(islands.sort(), ['s1.md', 's2.md'].sort());
  });
});

describe('2.9 图谱 isolated 标记与健康度计数一致', () => {
  test('graphData 中 isolated===true 的文档节点数与 health.islands.count 相等，且孤岛集合一致', () => {
    seedIslandSample();
    saveVaultConfig({ root: VAULT }); // 连接 Vault，使 knowledgeHealth 走真实索引统计
    const g = graphData();
    const isolatedDocs = g.nodes.filter((n) => n.kind === 'doc' && n.isolated === true).map((n) => n.path!).sort();
    const health = knowledgeHealth();
    assert.deepEqual(isolatedDocs, health.islands.paths.sort());
    assert.equal(isolatedDocs.length, health.islands.count);
    assert.equal(health.islands.count, 1, 'A/B/D 有链接或共享标签，仅 C 为孤岛');
  });

  test('标签节点不携带 isolated 标记', () => {
    seedIslandSample();
    saveVaultConfig({ root: VAULT });
    const g = graphData();
    const tagNodes = g.nodes.filter((n) => n.kind === 'tag');
    assert.ok(tagNodes.length > 0, '样本应产生标签节点');
    for (const t of tagNodes) {
      assert.ok(!('isolated' in t) || t.isolated === undefined, `标签节点 ${t.id} 不应有 isolated`);
    }
  });
});

describe('2.10 GET /api/knowledge/health 路由', () => {
  test('接口结构正确：200 且 usage/islands/computedAt 齐全，paths.length === count', async () => {
    seedIslandSample();
    saveVaultConfig({ root: VAULT });
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/health' });
    assert.equal(res.statusCode, 200);
    const { health } = res.json() as { health: { usage: { linkedDocs: number; totalDocs: number; ratio: number | null }; islands: { count: number; paths: string[] }; computedAt: string } };
    assert.equal(typeof health.usage.linkedDocs, 'number');
    assert.equal(typeof health.usage.totalDocs, 'number');
    assert.equal(typeof health.islands.count, 'number');
    assert.ok(Array.isArray(health.islands.paths));
    assert.equal(health.islands.paths.length, health.islands.count);
    assert.ok(typeof health.computedAt === 'string' && !Number.isNaN(Date.parse(health.computedAt)));
  });

  test('Vault 未连接时返回 200 与可解释空值（ratio null、paths 空），不 5xx', async () => {
    saveVaultConfig({ root: '' });
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/health' });
    assert.equal(res.statusCode, 200);
    const { health } = res.json() as { health: { usage: { ratio: number | null }; islands: { paths: string[] } } };
    assert.equal(health.usage.ratio, null);
    assert.deepEqual(health.islands.paths, []);
    // 复位：恢复 Vault 连接（供后续区段使用）
    saveVaultConfig({ root: VAULT });
  });
});

describe('2.11 health 只读边界（不改表结构、不改数据）', () => {
  test('调用 health 接口前后 knowledge_docs / knowledge_links / task_kb_refs 表结构与行数均不变', async () => {
    seedIslandSample();
    const schemaOf = (t: string) => all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name).join(',');
    const docsBefore = schemaOf(KT.docs);
    const linksBefore = schemaOf(KT.links);
    const refsBefore = schemaOf(KT.taskRefs);
    const docCountBefore = Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.docs}`)?.c ?? 0);
    const linkCountBefore = Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.links}`)?.c ?? 0);
    const refCountBefore = Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.taskRefs}`)?.c ?? 0);

    await app.inject({ method: 'GET', url: '/api/knowledge/health' });
    await app.inject({ method: 'GET', url: '/api/knowledge/graph' });

    assert.equal(schemaOf(KT.docs), docsBefore);
    assert.equal(schemaOf(KT.links), linksBefore);
    assert.equal(schemaOf(KT.taskRefs), refsBefore);
    assert.equal(Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.docs}`)?.c ?? 0), docCountBefore);
    assert.equal(Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.links}`)?.c ?? 0), linkCountBefore);
    assert.equal(Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.taskRefs}`)?.c ?? 0), refCountBefore);
  });
});

describe('3.10 图谱既有字段不回归（后端）', () => {
  test('文档节点 id/kind/label/path/tags/degree 语义不变，仅新增 isolated', () => {
    seedIslandSample();
    const g = graphData();
    const a = g.nodes.find((n) => n.path === 'a.md')!;
    assert.ok(a, 'a.md 应为文档节点');
    assert.equal(a.id, 'doc:a.md');
    assert.equal(a.kind, 'doc');
    assert.equal(a.label, 'a', 'label = 索引中的 title');
    assert.equal(a.path, 'a.md');
    assert.deepEqual(a.tags, ['产品资料', '充电']);
    assert.equal(a.degree, 3, 'a 的边：A→B link（1）+ 标签归属边 2 条（产品资料/充电）= 3');
    assert.equal(typeof a.isolated, 'boolean');
    // 有链接 → 非孤岛
    assert.equal(a.isolated, false);
  });
});
