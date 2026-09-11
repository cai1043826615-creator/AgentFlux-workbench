/**
 * 每日热点与任务关联资料测试。
 * 运行：pnpm --filter @workbench/backend exec tsx src/knowledge/__tests__/workflow-context.test.ts
 *
 * 覆盖 OpenSpec 任务：5.1 5.2 6.1 6.2 6.3 6.4 6.5
 * 网络部分用可控的 fetch 桩，保证确定性；真实网络端到端在 smoke 脚本中验证。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-kbctx-'));
process.env.WORKBENCH_DB = join(dir, 'ctx.db');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { run } = await import('../../db/client.ts');
const { ensureKnowledgeSchema, KT } = await import('../schema.ts');
const { saveVaultConfig } = await import('../vault.ts');
const { rebuildIndex } = await import('../indexer.ts');
const { DEFAULT_ATTENTION, normalizeAttention, classifyHot, matchDomains, loadAttentionConfig } = await import('../attention.ts');
const { loadHotPanel, clearHotCache } = await import('../hot.ts');
const { setTaskKbRefs, listTaskKbRefs, validateTaskKbRefs, buildKnowledgeContext, loadTaskKbFragments, KbRefLimitError, KbRefInvalidError } = await import('../refs.ts');
const { readDoc } = await import('../docs.ts');

const VAULT = join(dir, 'vault');
function writeVault(rel: string, content: string): void {
  const abs = join(VAULT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

const PRODUCT_MD = `---
title: 磁吸充电宝产品资料
tags: [产品]
---

# 产品规格

充电宝容量 10000mAh，支持 15W 磁吸快充。

## 电池

锂聚合物电芯，循环寿命 500 次。

# 品牌要求

文案语气克制专业，不使用夸张词。
`;

const BRAND_MD = `---
title: 品牌规范
tags: [品牌]
---

# 色彩

主色为紫色。
`;

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
  writeVault('产品/磁吸充电宝.md', PRODUCT_MD);
  writeVault('品牌/品牌规范.md', BRAND_MD);
  saveVaultConfig({ root: VAULT });
  await rebuildIndex();
});

// ===================== 5.2 电商化关注域分层 =====================

describe('5.2 电商化关注域配置（坑2）', () => {
  test('内置默认关注域为电商场景（品类/平台/竞品/促销/内容），非 AI 行业', () => {
    const labels = DEFAULT_ATTENTION.domains.map((d) => d.label);
    for (const expect of ['品类趋势', '平台规则', '竞品动态', '促销节点', '内容营销']) {
      assert.ok(labels.includes(expect), `缺少默认关注域：${expect}`);
    }
    assert.ok(!labels.some((l) => /AI|模型|Agent/.test(l)), '默认关注域不应是 AI 行业域');
    const cfg = loadAttentionConfig();
    assert.ok(cfg.domains.length >= 5);
    assert.ok(cfg.mustReadLimit! > 0 && cfg.browseLimit! > 0 && cfg.otherLimit! > 0);
  });

  test('关注域关键词匹配（不区分大小写）', () => {
    const cfg = normalizeAttention({ domains: [{ id: 'p', label: '平台', keywords: ['天猫', 'KOL'] }] });
    assert.deepEqual(matchDomains('天猫发布新规', cfg).map((d) => d.id), ['p']);
    assert.deepEqual(matchDomains('头部 kol 带货', cfg).map((d) => d.id), ['p'], '大小写不敏感');
    assert.deepEqual(matchDomains('无关内容', cfg), []);
  });

  test('命中关注域 + 多信源 → 必看；命中但单信源 → 浏览；未命中 → 其他', () => {
    const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, minimumSources: 2 });
    const tiers = classifyHot(
      [
        { id: 'a', title: '天猫双11新规：预售期延长', summary: '平台调整预售规则', source: '电商报', sourceCount: 5, url: 'https://x/a', latestAt: '2026-09-10T00:00:00Z' },
        { id: 'b', title: '某品牌发布新款耳机', summary: '竞品上新', source: 'TechCrunch', sourceCount: 1, url: 'https://x/b', latestAt: '2026-09-10T00:00:00Z' },
        { id: 'c', title: '某地天气预报', summary: '今日多云', source: '天气网', sourceCount: 1, url: 'https://x/c', latestAt: '2026-09-10T00:00:00Z' },
      ],
      cfg,
    );
    assert.deepEqual(tiers.mustRead.map((i) => i.id), ['a'], '命中关注域且多信源应进必看');
    assert.deepEqual(tiers.browse.map((i) => i.id), ['b'], '命中关注域但信源不足应进浏览');
    assert.deepEqual(tiers.other.map((i) => i.id), ['c'], '未命中关注域应进其他');
    assert.ok(tiers.mustRead[0].domains.length > 0, '必看项应带命中的关注域');
    assert.ok(tiers.mustRead[0].reason.includes('关注域'), '应给出进入必看的理由');
  });

  test('各层按限制数截断', () => {
    const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, mustReadLimit: 1, browseLimit: 1, otherLimit: 1, minimumSources: 1 });
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`,
      title: `天猫大促第${i}期`,
      summary: null,
      source: 's',
      sourceCount: 3,
      url: null,
      latestAt: null,
    }));
    const tiers = classifyHot(items, cfg);
    assert.equal(tiers.mustRead.length, 1);
    assert.equal(tiers.browse.length, 1);
    assert.equal(tiers.other.length, 1);
  });
});

// ===================== 5.1 热点拉取 / 缓存 / 降级 =====================

describe('5.1 热点拉取、缓存与降级', () => {
  const realFetch = globalThis.fetch;
  let calls: string[] = [];

  const okFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    let body: unknown;
    if (url.includes('/api/v1/hot-topics')) {
      body = {
        items: [
          { id: 'h1', title: '天猫双11新规：预售期延长', source: { name: '电商报' }, sourceCount: 5, links: { story: 'https://aihot.virxact.com/story/s1', original: 'https://x/1' }, latestAt: '2026-09-10T01:00:00Z' },
          { id: 'h2', title: '某品牌发布新款耳机', source: { name: 'TechCrunch' }, sourceCount: 1, links: { story: 'https://aihot.virxact.com/story/s2', original: 'https://x/2' }, latestAt: '2026-09-10T01:00:00Z' },
        ],
      };
    } else if (url.includes('/api/v1/stories/s1')) {
      body = { story: { title: '天猫双11新规', digest: '预售期延长至 10 天。', latestAt: '2026-09-10T01:00:00Z' } };
    } else if (url.includes('/api/v1/stories/s2')) {
      body = { story: { title: '某品牌发布新款耳机', digest: '定价 599 元。' } };
    } else if (url.includes('/api/v1/items')) {
      body = { items: [{ id: 'sel1', title: '某地天气预报', summary: '今日多云', source: { name: '天气网' }, links: { original: 'https://x/3' }, publishedAt: '2026-09-10T01:00:00Z' }] };
    } else {
      body = {};
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  test('成功拉取：分层、字段、数据时间齐备', async () => {
    clearHotCache();
    globalThis.fetch = okFetch;
    calls = [];
    const panel = await loadHotPanel();
    assert.equal(panel.status, 'live');
    assert.ok(panel.fetchedAt && panel.expiresAt, '应标注数据时间与过期时间');
    assert.equal(panel.counts.upstream, 3, '应合并多源热点与精选条目');
    assert.ok(panel.tiers.mustRead.some((i) => i.id === 'h1'), '天猫双11应进必看');
    assert.ok(panel.tiers.browse.some((i) => i.id === 'h2'), '单信源竞品应进浏览');
    assert.ok(panel.tiers.other.some((i) => i.id === 'sel1'), '未命中关注域应进其他');
    const must = panel.tiers.mustRead.find((i) => i.id === 'h1')!;
    assert.equal(must.source, '电商报');
    assert.ok(must.summary?.includes('预售期'), '应带上分源摘要');
    assert.equal(must.url, 'https://x/1');
  });

  test('TTL 内命中缓存，不重复请求源', async () => {
    const before = calls.length;
    const panel = await loadHotPanel();
    assert.equal(panel.status, 'live');
    assert.equal(calls.length, before, 'TTL 内不应再次请求热点源');
  });

  test('force=true 忽略 TTL 重新拉取', async () => {
    const before = calls.length;
    await loadHotPanel(true);
    assert.ok(calls.length > before, 'force 应重新请求');
  });

  test('源不可用时降级为缓存数据并标注 stale', async () => {
    globalThis.fetch = (async () => {
      throw new Error('网络不可达');
    }) as typeof fetch;
    const panel = await loadHotPanel(true);
    assert.equal(panel.status, 'stale', '有缓存时应降级为 stale');
    assert.ok(panel.error && panel.error.message.includes('网络不可达'));
    assert.ok(panel.tiers.mustRead.length > 0, '降级仍应展示缓存内容');
  });

  test('缓存过期后重新拉取', async () => {
    globalThis.fetch = okFetch;
    calls = [];
    run(`UPDATE ${KT.hotCache} SET expires_at = ? WHERE cache_key = 'daily-hot'`, [new Date(Date.now() - 1000).toISOString()]);
    await loadHotPanel();
    assert.ok(calls.length > 0, '缓存过期后应重新拉取');
  });

  test('无缓存且源不可用 → unavailable（不抛错，板块 B 其余功能不受影响）', async () => {
    clearHotCache();
    globalThis.fetch = (async () => {
      throw new Error('网络不可达');
    }) as typeof fetch;
    const panel = await loadHotPanel();
    assert.equal(panel.status, 'unavailable');
    assert.ok(panel.error, '应给出错误说明');
    assert.deepEqual(panel.tiers.mustRead, []);
    assert.deepEqual(panel.tiers.browse, []);
    assert.deepEqual(panel.tiers.other, []);
    globalThis.fetch = realFetch;
  });

  test('上游 HTTP 错误码也走降级（不抛给调用方）', async () => {
    clearHotCache();
    globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
    const panel = await loadHotPanel();
    assert.equal(panel.status, 'unavailable');
    assert.match(String(panel.error?.message), /503/);
    globalThis.fetch = realFetch;
  });
});

// ===================== 6.1 / 6.2 / 6.3 关联资料 =====================

describe('6.1 关联存储与上限', () => {
  test('勾选资料后持久化，含标题与片段范围', () => {
    const refs = setTaskKbRefs(101, [
      { docPath: '产品/磁吸充电宝.md', anchor: '产品规格 / 电池' },
      { docPath: '品牌/品牌规范.md' },
    ]);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].docPath, '产品/磁吸充电宝.md');
    assert.equal(refs[0].title, '磁吸充电宝产品资料', '应冗余标题以便追溯');
    assert.equal(refs[0].anchor, '产品规格 / 电池');
    assert.equal(refs[1].anchor, null, '未指定锚点即整篇');
    assert.ok(refs.every((r) => r.valid), '存在的资料应标记有效');
    assert.deepEqual(listTaskKbRefs(101).map((r) => r.docPath), ['产品/磁吸充电宝.md', '品牌/品牌规范.md']);
  });

  test('超过 6 份被拒绝（阻止继续勾选）', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ docPath: `产品/磁吸充电宝.md`, anchor: `章节${i}` }));
    assert.throws(() => setTaskKbRefs(102, seven), KbRefLimitError);
    assert.throws(() => validateTaskKbRefs(seven), KbRefLimitError);
    assert.deepEqual(listTaskKbRefs(102), [], '超限不应写入任何关联');
    const six = Array.from({ length: 6 }, (_, i) => ({ docPath: '产品/磁吸充电宝.md', anchor: `章节${i}` }));
    assert.doesNotThrow(() => validateTaskKbRefs(six));
  });

  test('资料不在知识库时被拒绝', () => {
    assert.throws(() => setTaskKbRefs(103, [{ docPath: '不存在/没有.md' }]), KbRefInvalidError);
    assert.throws(() => validateTaskKbRefs([{ docPath: '../逃逸.md' }]), KbRefInvalidError);
    assert.deepEqual(listTaskKbRefs(103), []);
  });

  test('同一文档同一片段去重', () => {
    const refs = setTaskKbRefs(104, [
      { docPath: '品牌/品牌规范.md' },
      { docPath: '品牌/品牌规范.md' },
      { docPath: '品牌/品牌规范.md', anchor: '色彩' },
    ]);
    assert.equal(refs.length, 2, '重复的整篇应去重，不同锚点保留');
  });

  test('重新写入会覆盖旧的关联', () => {
    setTaskKbRefs(105, [{ docPath: '品牌/品牌规范.md' }]);
    setTaskKbRefs(105, [{ docPath: '产品/磁吸充电宝.md' }]);
    assert.deepEqual(listTaskKbRefs(105).map((r) => r.docPath), ['产品/磁吸充电宝.md']);
  });

  test('移除（清空）后不残留', () => {
    setTaskKbRefs(106, [{ docPath: '品牌/品牌规范.md' }]);
    assert.equal(listTaskKbRefs(106).length, 1);
    setTaskKbRefs(106, []);
    assert.deepEqual(listTaskKbRefs(106), [], '取消勾选后应移除');
  });
});

describe('6.2 片段锚点解析（整篇 / 章节两种粒度）', () => {
  test('按章节锚点截取片段范围正确', async () => {
    setTaskKbRefs(201, [
      { docPath: '产品/磁吸充电宝.md', anchor: '产品规格 / 电池' },
      { docPath: '产品/磁吸充电宝.md', anchor: '品牌要求' },
      { docPath: '品牌/品牌规范.md' },
    ]);
    const frags = await loadTaskKbFragments(201);
    assert.equal(frags.length, 3);
    assert.equal(frags[0].state, 'ok');
    assert.ok(frags[0].content!.includes('锂聚合物电芯'), '章节片段应含该章节正文');
    assert.ok(!frags[0].content!.includes('品牌要求'), '片段不应越界到下一章节');
    assert.ok(frags[1].content!.includes('文案语气克制专业'));
    assert.ok(!frags[1].content!.includes('循环寿命'), '不应包含前面的章节');
    // 整篇粒度
    assert.ok(frags[2].content!.includes('主色为紫色'));
  });

  test('锚点在最新文档中找不到时降级为整篇并标记', async () => {
    setTaskKbRefs(202, [{ docPath: '产品/磁吸充电宝.md', anchor: '已删除的章节' }]);
    const frags = await loadTaskKbFragments(202);
    assert.equal(frags[0].state, 'anchor-missing');
    assert.ok(frags[0].content!.includes('产品规格'), '降级为整篇内容');
  });

  test('文档锚点列表可用于选择片段（阅读接口）', async () => {
    const doc = (await readDoc('产品/磁吸充电宝.md'))!;
    assert.deepEqual(doc.anchors.map((a) => a.anchor), ['产品规格', '产品规格 / 电池', '品牌要求']);
    assert.deepEqual(doc.anchors.map((a) => a.level), [1, 2, 1]);
  });
});

describe('6.3 关联可见与失效标记', () => {
  test('文件从 Vault 消失后标记为失效（仍可追溯路径与标题）', async () => {
    writeVault('临时/待删.md', '# 待删\n\n内容。\n');
    await rebuildIndex();
    setTaskKbRefs(203, [{ docPath: '临时/待删.md' }]);
    assert.ok(listTaskKbRefs(203)[0].valid);
    rmSync(join(VAULT, '临时/待删.md'));
    await rebuildIndex();
    const refs = listTaskKbRefs(203);
    assert.equal(refs.length, 1, '失效资料仍应保留在任务详情中');
    assert.equal(refs[0].valid, false, '应标记失效');
    assert.equal(refs[0].docPath, '临时/待删.md', '路径仍可追溯');
    assert.ok(refs[0].title.length > 0, '标题仍可追溯');
  });
});

// ===================== 6.4 注入 Agent 上下文 =====================

describe('6.4 注入 producer 上下文', () => {
  test('注入内容包含所选片段与路径', async () => {
    setTaskKbRefs(301, [{ docPath: '产品/磁吸充电宝.md', anchor: '产品规格 / 电池' }]);
    const ctx = await buildKnowledgeContext(301);
    assert.ok(ctx.includes('【关联知识库资料】'), '应有明确的资料段标题');
    assert.ok(ctx.includes('磁吸充电宝产品资料'), '应含资料标题');
    assert.ok(ctx.includes('产品规格 / 电池'), '应标注片段范围');
    assert.ok(ctx.includes('产品/磁吸充电宝.md'), '应含相对路径');
    assert.ok(ctx.includes('锂聚合物电芯'), '应含片段正文');
    assert.ok(!ctx.includes('品牌要求'), '不应注入未选择的章节');
    assert.match(ctx, /只读|不要编造/, '应声明只读与不编造约束');
  });

  test('多份资料按顺序注入', async () => {
    setTaskKbRefs(302, [{ docPath: '产品/磁吸充电宝.md' }, { docPath: '品牌/品牌规范.md' }]);
    const ctx = await buildKnowledgeContext(302);
    const first = ctx.indexOf('### 资料 1：《磁吸充电宝产品资料》');
    const second = ctx.indexOf('### 资料 2：《品牌规范》');
    assert.ok(first >= 0 && second > first, '应按勾选顺序编号注入（资料1 在前，资料2 在后）');
    assert.ok(ctx.indexOf('锂聚合物电芯') < ctx.indexOf('主色为紫色'), '正文顺序与资料顺序一致');
  });

  test('资料缺失时降级为「资料缺失」提示，不抛错', async () => {
    writeVault('临时/会消失.md', '# 会消失\n\n内容。\n');
    await rebuildIndex();
    setTaskKbRefs(303, [{ docPath: '临时/会消失.md' }]);
    rmSync(join(VAULT, '临时/会消失.md'));
    await rebuildIndex();
    const ctx = await buildKnowledgeContext(303);
    assert.ok(ctx.includes('资料缺失'), '应注入缺失提示');
    assert.ok(ctx.includes('临时/会消失.md'), '仍应标出路径');
    assert.match(ctx, /不要凭空编造/, '应指示忽略该资料');
  });

  test('锚点漂移时注入整篇并说明', async () => {
    setTaskKbRefs(304, [{ docPath: '产品/磁吸充电宝.md', anchor: '不存在的章节' }]);
    const ctx = await buildKnowledgeContext(304);
    assert.ok(ctx.includes('原章节未找到'), '应说明降级原因');
    assert.ok(ctx.includes('产品规格'), '应注入整篇');
  });

  test('无关联资料时不注入（返回空串）', async () => {
    assert.equal(await buildKnowledgeContext(999), '');
    setTaskKbRefs(305, []);
    assert.equal(await buildKnowledgeContext(305), '');
    assert.equal(await buildKnowledgeContext(null), '');
    assert.equal(await buildKnowledgeContext(undefined), '');
  });

  test('注入落在 producer 的最终 system prompt 上（LLM 调用边界）', async () => {
    const { buildProducerSystemPrompt } = await import('../../agents/smart-producer.ts');
    setTaskKbRefs(306, [{ docPath: '产品/磁吸充电宝.md', anchor: '产品规格 / 电池' }]);
    const withKb = await buildProducerSystemPrompt('agent-copy', 'BASE_SYSTEM', 306);
    assert.ok(withKb.startsWith('BASE_SYSTEM'), '基础 system 应保留在最前');
    assert.ok(withKb.includes('【关联知识库资料】'), '最终 prompt 应含知识库资料段');
    assert.ok(withKb.includes('锂聚合物电芯'), '最终 prompt 应含所选片段正文');

    // 未关联资料：最终 prompt 与既有完全一致（独立性）
    const plain = await buildProducerSystemPrompt('agent-copy', 'BASE_SYSTEM', 307);
    const noTask = await buildProducerSystemPrompt('agent-copy', 'BASE_SYSTEM');
    assert.equal(plain, noTask, '无关联时不应附加任何知识库内容');
    assert.ok(!plain.includes('【关联知识库资料】'));
  });
});

// ===================== 6.5 与工作流独立 =====================

describe('6.5 板块独立性（坑5：异常不阻塞板块 A）', () => {
  test('知识库未连接时新建任务流程与既有行为一致（无关联资料、不报错）', async () => {
    const { seed } = await import('../../db/seed.ts');
    const { service } = await import('../../engine/service.ts');
    seed();

    saveVaultConfig({ root: '' });
    await rebuildIndex();

    const task = service.createTask({ title: '未连接知识库时的新品上架', description: '描述', platforms: ['天猫'] });
    assert.ok(task.id > 0, '任务应正常创建');
    assert.equal(task.column, 'planned');
    assert.deepEqual(listTaskKbRefs(task.id), [], '未关联资料');
    assert.equal(await buildKnowledgeContext(task.id), '', '注入跳过，上下文与既有完全一致');
    // 任务可继续推进（确认开工）
    const advanced = await service.confirmAndRun(task.id);
    assert.ok(['progress', 'awaiting', 'done'].includes(advanced.column), '任务应正常推进，不受板块 B 影响');
  });

  test('知识库连接后新建任务同样不受影响', async () => {
    const { service } = await import('../../engine/service.ts');
    saveVaultConfig({ root: VAULT });
    await rebuildIndex();
    const task = service.createTask({ title: '已连接知识库时的任务', description: '', platforms: ['京东'] });
    const advanced = await service.confirmAndRun(task.id);
    assert.ok(['progress', 'awaiting', 'done'].includes(advanced.column));
    assert.deepEqual(listTaskKbRefs(task.id), []);
  });

  test('索引元信息表与关联表独立于板块 A 业务表', () => {
    // 板块 B 的表清单固定，且都与板块 A 业务表不同名
    const aTables = ['tasks', 'task_events', 'deliverables', 'messages', 'workflows', 'agent_executions', 'agents'];
    for (const t of Object.values(KT)) {
      assert.ok(!aTables.includes(t), `${t} 不应与板块 A 表同名`);
    }
  });
});
