/**
 * 知识库（板块 B）基础层测试：数据域 / Vault 只读接入 / 索引 / 中文检索 / 星图数据。
 * 运行：pnpm --filter @workbench/backend exec tsx src/knowledge/__tests__/knowledge.test.ts
 *
 * 覆盖 OpenSpec 任务：1.1 1.2 1.3 1.4 1.5 2.1 2.2 2.3 4.1 4.2 4.4
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-kb-'));
process.env.WORKBENCH_DB = join(dir, 'kb.db');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { all, get } = await import('../../db/client.ts');
const { ensureKnowledgeSchema, KT } = await import('../schema.ts');
const { saveVaultConfig, resolveVaultConfig, assertVaultReadOnly, vaultAbsPath, inIndexRange, VaultReadOnlyError, VaultPathError } = await import('../vault.ts');
const { rebuildIndex, isIndexing } = await import('../indexer.ts');
const { knowledgeStatus, knowledgeStats, listDirs, listTags, listDocsByDir, listDocsByTag, readDoc, listAllDocs } = await import('../docs.ts');
const { searchDocs } = await import('../search.ts');
const { graphData, nodeDetail, docNodeId, tagNodeId } = await import('../graph.ts');
const { parseFrontmatter, extractTags, extractTitle, parseSections, sliceSection, extractLinks, resolveLinkTarget } = await import('../markdown.ts');

/** 构造测试用 Vault */
const VAULT = join(dir, 'vault');
function writeVault(rel: string, content: string): void {
  const abs = join(VAULT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}
function readVault(rel: string): string {
  return readFileSync(join(VAULT, rel), 'utf8');
}

const PRODUCT_MD = `---
title: 磁吸充电宝产品资料
tags: [产品, 充电]
---

# 产品规格

无线磁吸充电宝，支持 15W 快充。充电宝容量 10000mAh，充电宝机身轻薄。

## 电池

采用锂聚合物电芯，循环寿命 500 次。

# 卖点

磁吸吸附力强，充电宝可当手机支架。

相关文档：[[品牌规范]]
`;

const BRAND_MD = `---
tags:
  - 品牌
  - 充电
---

# 品牌规范

主色 #7C3AED，文案语气克制专业。
`;

const COMPARE_MD = `# 竞品对比

市面上充电宝品类竞争激烈。
`;

const NO_TAG_MD = `# 随手笔记

这是一篇没有任何标签与链接的笔记。
`;

const SECRET_MD = `# 私密笔记

不应进入索引。
`;

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
});

describe('1.1 数据域建表（独立表域，不影响板块 A）', () => {
  test('知识库表全部建立，且板块 A 表可用', () => {
    const tables = all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
    for (const t of [KT.docs, KT.links, KT.fts, KT.hotCache, KT.meta, KT.taskRefs]) {
      assert.ok(tables.includes(t), `缺少表 ${t}`);
    }
    // 板块 A 表仍在
    assert.ok(tables.includes('tasks') && tables.includes('agents') && tables.includes('settings'));
  });

  test('建表幂等：重复调用不报错', () => {
    ensureKnowledgeSchema();
    ensureKnowledgeSchema();
    assert.ok(true);
  });
});

describe('1.2 Vault 配置与连接状态', () => {
  test('未配置时返回「未连接」并给出原因', () => {
    saveVaultConfig({ root: '' });
    const st = knowledgeStatus();
    assert.equal(st.state, 'disconnected');
    assert.ok(st.reason && st.reason.length > 0, '未连接需给出原因');
    assert.equal(st.root, null);
  });

  test('配置有效路径后返回「已连接」', () => {
    writeVault('产品/磁吸充电宝.md', PRODUCT_MD);
    writeVault('品牌/品牌规范.md', BRAND_MD);
    writeVault('笔记/竞品对比.md', COMPARE_MD);
    writeVault('笔记/随手笔记.md', NO_TAG_MD);
    writeVault('.obsidian/workspace.md', '# 配置\n\n不应进入索引。\n');
    writeVault('私密/secret.md', SECRET_MD);
    saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
    const cfg = resolveVaultConfig();
    assert.ok(cfg.root, '应解析出 Vault 根目录');
    assert.equal(knowledgeStatus().state, 'connected');
    assert.equal(knowledgeStatus().source, 'settings');
  });

  test('环境变量兜底：设置面板未配置时用 WORKBENCH_VAULT_ROOT', () => {
    saveVaultConfig({ root: '' });
    process.env.WORKBENCH_VAULT_ROOT = VAULT;
    const cfg = resolveVaultConfig();
    assert.equal(cfg.root, VAULT);
    assert.equal(knowledgeStatus().source, 'env');
    delete process.env.WORKBENCH_VAULT_ROOT;
  });

  test('路径无效时降级为未连接并说明原因，不抛错', () => {
    saveVaultConfig({ root: join(dir, 'not-exists-dir') });
    const st = knowledgeStatus();
    assert.equal(st.state, 'disconnected');
    assert.match(String(st.reason), /不存在/);
    saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
  });

  test('索引范围限定：白名单与排除目录同时生效', () => {
    const cfg = resolveVaultConfig();
    cfg.includeDirs = ['产品', '品牌'];
    assert.equal(inIndexRange('产品/磁吸充电宝.md', cfg), true);
    assert.equal(inIndexRange('品牌/品牌规范.md', cfg), true);
    assert.equal(inIndexRange('笔记/竞品对比.md', cfg), false, '白名单外不进入索引');
    assert.equal(inIndexRange('产品/子目录/深层.md', cfg), true, '白名单含子目录');
    cfg.includeDirs = [];
    assert.equal(inIndexRange('私密/secret.md', cfg), false, '排除目录生效');
    assert.equal(inIndexRange('.obsidian/workspace.md', cfg), false, '默认排除 .obsidian');
    assert.equal(inIndexRange('产品/磁吸充电宝.md', cfg), true);
  });
});

describe('1.5 只读边界（并覆盖 1.3 只读扫描）', () => {
  test('写/删/移动/建目录一律被拒绝，读操作放行', () => {
    assert.doesNotThrow(() => assertVaultReadOnly('read', '产品/磁吸充电宝.md'));
    for (const op of ['write', 'delete', 'move', 'mkdir'] as const) {
      assert.throws(() => assertVaultReadOnly(op, '产品/磁吸充电宝.md'), VaultReadOnlyError, `${op} 应被拒绝`);
    }
  });

  test('路径逃逸被拒绝（绝对路径与 ..）', () => {
    const root = resolveVaultConfig().root!;
    assert.throws(() => vaultAbsPath(root, '../outside.md'), VaultPathError);
    assert.throws(() => vaultAbsPath(root, 'note/../../outside.md'), VaultPathError);
    assert.throws(() => vaultAbsPath(root, '/etc/passwd'), VaultPathError);
    assert.ok(vaultAbsPath(root, '产品/磁吸充电宝.md').startsWith(root));
  });

  test('索引后 Vault 文件内容与 mtime 均未被改动', async () => {
    const rels = ['产品/磁吸充电宝.md', '品牌/品牌规范.md', '笔记/竞品对比.md', '.obsidian/workspace.md', '私密/secret.md'];
    const before = new Map(rels.map((r) => [r, readVault(r)]));
    await rebuildIndex();
    for (const r of rels) assert.equal(readVault(r), before.get(r), `${r} 内容被改动`);
  });
});

describe('1.3 / 1.4 Vault 扫描与索引构建', () => {
  test('全量索引统计正确，排除目录不进入索引', async () => {
    const result = await rebuildIndex();
    assert.ok(result, '索引应执行成功');
    // 产品/磁吸充电宝.md、品牌/品牌规范.md、笔记/竞品对比.md、笔记/随手笔记.md = 4 篇
    assert.equal(result.docCount, 4, `文档数应为 4，实际 ${result.docCount}`);
    const paths = listAllDocs().map((d) => d.path);
    assert.ok(paths.includes('产品/磁吸充电宝.md'));
    assert.ok(paths.includes('品牌/品牌规范.md'));
    assert.ok(!paths.some((p) => p.startsWith('.obsidian/')), '.obsidian 应被排除');
    assert.ok(!paths.some((p) => p.startsWith('私密/')), '排除目录应被排除');
  });

  test('frontmatter 标题与标签解析正确', () => {
    const docs = listAllDocs();
    const product = docs.find((d) => d.path === '产品/磁吸充电宝.md')!;
    assert.equal(product.title, '磁吸充电宝产品资料', '应使用 frontmatter title');
    assert.deepEqual(product.tags.sort(), ['产品', '充电'].sort());
    assert.equal(product.dir, '产品');
    const brand = docs.find((d) => d.path === '品牌/品牌规范.md')!;
    assert.ok(brand.tags.includes('品牌'), 'YAML 列表式 tags 应被解析');
    assert.ok(!brand.tags.includes('7C3AED'), '色值不应被误判为标签');
    const note = docs.find((d) => d.path === '笔记/随手笔记.md')!;
    assert.equal(note.title, '随手笔记', '无 frontmatter 时回退首个 H1');
    assert.deepEqual(note.tags, []);
  });

  test('总览统计（文档数/标签数/目录数/最近更新）正确', () => {
    const s = knowledgeStats();
    assert.equal(s.docCount, 4);
    // 标签：产品、充电、品牌 = 3
    assert.equal(s.tagCount, 3, `标签数应为 3，实际 ${s.tagCount}`);
    // 目录：产品、品牌、笔记 = 3
    assert.equal(s.dirCount, 3);
    assert.equal(s.recent.length, 4);
    assert.ok(s.indexedAt, '应有索引完成时间');
    assert.equal(s.indexing, false);
  });

  test('目录与标签浏览正确', () => {
    assert.deepEqual(listDocsByDir('产品').map((d) => d.path), ['产品/磁吸充电宝.md']);
    assert.deepEqual(listDocsByDir('笔记').map((d) => d.path).sort(), ['笔记/竞品对比.md', '笔记/随手笔记.md']);
    assert.equal(listDocsByDir('').length, 4, '根目录浏览返回全部');
    assert.deepEqual(listDocsByTag('充电').map((d) => d.path).sort(), ['产品/磁吸充电宝.md', '品牌/品牌规范.md'].sort());
    assert.deepEqual(listDocsByTag('不存在的标签'), [], '无匹配返回空');
    const dirs = listDirs();
    assert.equal(dirs.find((d) => d.dir === '')?.count, 4, '根目录计数含全部文档');
    assert.equal(dirs.find((d) => d.dir === '产品')?.count, 1);
    assert.deepEqual(listTags().map((t) => t.tag).sort(), ['产品', '充电', '品牌'].sort());
  });

  test('文件删除后重新索引，条目不再出现', async () => {
    writeVault('笔记/临时.md', '# 临时\n\n待删除。\n');
    await rebuildIndex();
    assert.ok(listAllDocs().some((d) => d.path === '笔记/临时.md'));
    const { rmSync } = await import('node:fs');
    rmSync(join(VAULT, '笔记/临时.md'));
    await rebuildIndex();
    assert.ok(!listAllDocs().some((d) => d.path === '笔记/临时.md'), '已删除文件不应再被索引');
    assert.equal(knowledgeStats().docCount, 4);
  });

  test('索引进行中不重复触发（串行化）', async () => {
    const first = rebuildIndex();
    const second = rebuildIndex();
    const r2 = await second;
    await first;
    assert.equal(r2, null, '索引进行中的第二次调用应直接返回 null');
    assert.equal(isIndexing(), false);
  });
});

describe('2.1 / 2.2 / 2.3 中文全文检索', () => {
  test('2.1 ≥3 字中文关键词命中并按相关度排序', () => {
    const r = searchDocs('充电宝');
    assert.ok(r.hits.length >= 1, '「充电宝」应有命中');
    assert.equal(r.hits[0].path, '产品/磁吸充电宝.md');
    assert.equal(r.hits[0].matchMode, 'fts');
    // 出现次数更多的文档应排在前（bm25 越小越相关）
    const compare = r.hits.find((h) => h.path === '笔记/竞品对比.md');
    if (compare) assert.ok(r.hits[0].score <= compare.score, '相关度排序应生效');
  });

  test('2.1 四字词命中（trigram 多 gram 匹配）', () => {
    const r = searchDocs('无线磁吸');
    assert.equal(r.hits.length, 1);
    assert.equal(r.hits[0].path, '产品/磁吸充电宝.md');
  });

  test('2.2 短词（2 字）经 LIKE 兜底命中', () => {
    const r = searchDocs('磁吸');
    assert.ok(r.hits.length >= 1, '「磁吸」应经兜底命中');
    assert.equal(r.hits[0].path, '产品/磁吸充电宝.md');
    assert.equal(r.hits[0].matchMode, 'like', '2 字短词应走 LIKE 兜底');
  });

  test('2.2 短词命中标签类文档', () => {
    const r = searchDocs('品牌');
    assert.ok(r.hits.some((h) => h.path === '品牌/品牌规范.md'));
    assert.ok(r.hits.every((h) => h.matchMode === 'like'));
  });

  test('2.3 命中结构含标题/相对路径/命中片段', () => {
    const r = searchDocs('充电宝');
    const hit = r.hits[0];
    assert.equal(typeof hit.title, 'string');
    assert.ok(hit.title.length > 0);
    assert.ok(hit.path.endsWith('.md'));
    assert.ok(hit.snippet.includes('充电宝'), '片段应包含命中词');
    assert.equal(typeof hit.dir, 'string');
    assert.ok(Array.isArray(hit.tags));
    assert.equal(typeof hit.score, 'number');
  });

  test('2.3 无命中返回空结果与提示，不报错', () => {
    const r = searchDocs('绝对不存在的关键词zzz');
    assert.deepEqual(r.hits, []);
    assert.ok(r.hint && r.hint.includes('未找到'));
  });

  test('空查询返回空结果且不报错', () => {
    assert.deepEqual(searchDocs('').hits, []);
    assert.deepEqual(searchDocs('   ').hits, []);
  });

  test('FTS 语法字符不会导致抛错', () => {
    for (const q of ['"', '充*电', 'NEAR(', '充电宝 AND', 'a"b']) {
      assert.doesNotThrow(() => searchDocs(q), `查询 ${q} 不应抛错`);
    }
  });

  test('混合长短词查询取交集', () => {
    const r = searchDocs('磁吸 电芯');
    assert.ok(r.hits.length >= 1);
    assert.ok(r.hits.every((h) => h.path === '产品/磁吸充电宝.md'));
  });
});

describe('4.1 / 4.2 / 4.4 知识星图数据', () => {
  test('4.1 文档间链接生成边；共享标签通过标签节点连通', () => {
    const g = graphData();
    const productId = docNodeId('产品/磁吸充电宝.md');
    const brandId = docNodeId('品牌/品牌规范.md');
    // [[品牌规范]] → link 边
    assert.ok(g.edges.some((e) => e.source === productId && e.target === brandId && e.kind === 'link'), '缺少文档间链接边');
    // 共享标签「充电」→ 两篇文档都连到 tag:充电
    const tagId = tagNodeId('充电');
    assert.ok(g.edges.some((e) => e.source === productId && e.target === tagId && e.kind === 'tag'));
    assert.ok(g.edges.some((e) => e.source === brandId && e.target === tagId && e.kind === 'tag'));
    // 标签节点存在且按类型区分
    assert.ok(g.nodes.some((n) => n.id === tagId && n.kind === 'tag'));
    assert.ok(g.nodes.some((n) => n.id === productId && n.kind === 'doc' && n.path === '产品/磁吸充电宝.md'));
  });

  test('4.1 索引范围外的文档不成为节点，指向它的链接不生成有效边', async () => {
    // 临时加一篇链接到「私密/secret.md」（范围外）的文档
    writeVault('笔记/外链.md', '# 外链\n\n参见 [[secret]] 与 [私密](私密/secret.md)。\n');
    await rebuildIndex();
    const g = graphData();
    const linkEdges = g.edges.filter((e) => e.kind === 'link');
    assert.ok(!linkEdges.some((e) => e.target.includes('secret')), '指向范围外文档的链接不应生成有效边');
    const { rmSync } = await import('node:fs');
    rmSync(join(VAULT, '笔记/外链.md'));
    await rebuildIndex();
  });

  test('4.2 图数据节点/边结构与索引范围一致', () => {
    const g = graphData();
    const docNodes = g.nodes.filter((n) => n.kind === 'doc');
    assert.equal(docNodes.length, 4, '文档节点数应等于索引文档数');
    // 所有边端点都必须是已存在的节点
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      assert.ok(ids.has(e.source), `边源节点不存在：${e.source}`);
      assert.ok(ids.has(e.target), `边目标节点不存在：${e.target}`);
    }
  });

  test('4.2 节点详情：出链/入链/共享标签文档', () => {
    const d = nodeDetail(docNodeId('品牌/品牌规范.md'))!;
    assert.ok(d, '品牌规范节点详情应存在');
    assert.equal(d.node.kind, 'doc');
    assert.deepEqual(d.inLinks.map((x) => x.path), ['产品/磁吸充电宝.md'], '反向链接（入链）应包含产品资料');
    assert.ok(d.sharedTagDocs.some((x) => x.path === '产品/磁吸充电宝.md'), '共享标签「充电」的文档应出现');

    const out = nodeDetail(docNodeId('产品/磁吸充电宝.md'))!;
    assert.deepEqual(out.outLinks.map((x) => x.path), ['品牌/品牌规范.md']);
  });

  test('4.2 标签节点详情列出该标签下文档', () => {
    const t = nodeDetail(tagNodeId('充电'))!;
    assert.equal(t.node.kind, 'tag');
    assert.deepEqual(t.sharedTagDocs.map((x) => x.path).sort(), ['产品/磁吸充电宝.md', '品牌/品牌规范.md'].sort());
  });

  test('4.2 不存在的节点返回 null（不抛错）', () => {
    assert.equal(nodeDetail(docNodeId('不存在/没有.md')), null);
    assert.equal(nodeDetail(tagNodeId('空标签')), null);
    assert.equal(nodeDetail(''), null);
  });

  test('4.4 无链接无标签时返回空图而非报错', async () => {
    const emptyVault = join(dir, 'vault-empty');
    mkdirSync(join(emptyVault, '随手'), { recursive: true });
    writeFileSync(join(emptyVault, '随手', 'a.md'), '# A\n\n没有任何标签和链接。\n', 'utf8');
    saveVaultConfig({ root: emptyVault });
    await rebuildIndex();
    const g = graphData();
    assert.equal(g.nodes.length, 1);
    assert.deepEqual(g.edges, [], '无链接无标签应无边');
    assert.equal(g.nodes[0].degree, 0);
    // 完全空的 Vault
    saveVaultConfig({ root: join(dir, 'vault-empty-2') });
    mkdirSync(join(dir, 'vault-empty-2'), { recursive: true });
    await rebuildIndex();
    const g2 = graphData();
    assert.deepEqual(g2.nodes, []);
    assert.deepEqual(g2.edges, []);
    // 复位
    saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
    await rebuildIndex();
  });
});

describe('Markdown 解析单元（1.3 / 6.2 基础）', () => {
  test('frontmatter 与标题回退', () => {
    const fm = parseFrontmatter('---\ntitle: 标题A\ntags: [x, y]\n---\n\n# H1\n');
    assert.equal(extractTitle(fm, 'a.md'), '标题A');
    assert.deepEqual(extractTags(fm), ['x', 'y'].sort());
    const noFm = parseFrontmatter('# H1\n\n正文\n');
    assert.equal(extractTitle(noFm, '目录/文件名.md'), 'H1');
    assert.equal(extractTitle(parseFrontmatter('正文无标题\n'), '目录/文件名.md'), '文件名');
  });

  test('标题层级锚点与片段范围（坑4）', () => {
    const sections = parseSections(PRODUCT_MD.slice(PRODUCT_MD.indexOf('# 产品规格')));
    const anchors = sections.map((s) => s.anchor);
    assert.ok(anchors.includes('产品规格'), `缺少 产品规格 锚点：${anchors.join(',')}`);
    assert.ok(anchors.includes('产品规格 / 电池'), `缺少子章节锚点：${anchors.join(',')}`);
    assert.ok(anchors.includes('卖点'));
    const sliced = sliceSection(PRODUCT_MD, '产品规格 / 电池')!;
    assert.ok(sliced.content.includes('锂聚合物电芯'), '片段应包含该章节正文');
    assert.ok(!sliced.content.includes('卖点'), '片段不应越界到下一章节');
    assert.equal(sliceSection(PRODUCT_MD, '不存在的锚点'), null, '锚点缺失返回 null 供降级');
  });

  test('链接提取与解析（wiki 与相对路径）', () => {
    const links = extractLinks('参见 [[品牌规范]] 与 [私密](私密/secret.md) 以及 [[A|别名]] 和 [外链](https://x.com/a.md)');
    assert.deepEqual(links.filter((l) => l.kind === 'wiki').map((l) => l.raw).sort(), ['A', '品牌规范'].sort());
    assert.deepEqual(links.filter((l) => l.kind === 'md').map((l) => l.raw), ['私密/secret.md']);
    const indexed = new Set(['品牌/品牌规范.md', '产品/磁吸充电宝.md']);
    assert.equal(resolveLinkTarget({ raw: '品牌规范', kind: 'wiki' }, '产品/磁吸充电宝.md', indexed), '品牌/品牌规范.md');
    assert.equal(resolveLinkTarget({ raw: '不存在', kind: 'wiki' }, '产品/磁吸充电宝.md', indexed), null);
  });
});

describe('阅读原文（3.1 后端能力）', () => {
  test('读取文档返回正文与章节锚点', async () => {
    const doc = (await readDoc('产品/磁吸充电宝.md'))!;
    assert.ok(doc, '文档应可读取');
    assert.equal(doc.title, '磁吸充电宝产品资料');
    assert.ok(doc.content.includes('无线磁吸充电宝'));
    assert.ok(!doc.content.includes('---\ntitle:'), '正文应已剥离 frontmatter');
    assert.ok(doc.anchors.some((a) => a.anchor === '产品规格 / 电池'));
    assert.ok(doc.mtime && doc.size > 0);
  });

  test('不存在文档返回 null', async () => {
    assert.equal(await readDoc('不存在/没有.md'), null);
    assert.equal(await readDoc(''), null);
  });

  test('Vault 断开后仍可读索引内正文（板块 B 降级不崩）', async () => {
    saveVaultConfig({ root: '' });
    const doc = await readDoc('产品/磁吸充电宝.md');
    assert.ok(doc, 'Vault 断开后应回退索引内正文');
    assert.ok(doc!.content.includes('无线磁吸充电宝'));
    saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
    await rebuildIndex();
  });
});
