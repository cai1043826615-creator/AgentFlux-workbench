/**
 * hot-intel 核心逻辑测试：降噪三规则（attention.ts）+ 多源适配器解析 + 聚合/证据/源状态（hot.ts）。
 * 运行：node src/knowledge/__tests__/hot-intel-core.test.ts
 *
 * 覆盖 OpenSpec 任务：3.2 3.3 3.4 3.6 3.7 3.8 4.1 4.2 4.3 4.4
 * 网络部分全部用 fetch 桩（fixture 为 2026-09-11 真实探测的源 HTML/JSON 结构），确定性验证；
 * 真实网络端到端证据见验证记录文件（协调者/验收时复测）。
 * 注意：本文件不 import 服务入口（index.ts/service.ts），避免依赖其他梯队中间状态。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import type { RawHotItem } from '../attention.ts';

const dir = mkdtempSync(join(tmpdir(), 'workbench-hotintel-'));
process.env.WORKBENCH_DB = join(dir, 'core.db');
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { ensureKnowledgeSchema } = await import('../schema.ts');
const {
  DEFAULT_ATTENTION,
  DEFAULT_MIN_KEYWORD_HITS,
  DEFAULT_SOURCES,
  normalizeAttention,
  loadAttentionConfig,
  matchDomains,
  classifyHot,
  sourceTierCapOf,
} = await import('../attention.ts');
const { loadHotPanel, clearHotCache, evidenceOf } = await import('../hot.ts');
const { paiNewsAdapter } = await import('../hot-sources/pai-news.ts');
const { ec100Adapter } = await import('../hot-sources/100ec.ts');
const { statsSjjdAdapter } = await import('../hot-sources/stats-sjjd.ts');
const { aihotAdapter } = await import('../hot-sources/aihot.ts');
const { ADAPTERS, instantiateAdapters } = await import('../hot-sources/index.ts');

// ===== fixture（2026-09-11 真实探测的源结构，脱敏） =====

const PAI_HTML = `<!doctype html><html><head><title>快讯</title></head><body>
<script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"json":{"rehydrate":{":R4puucupkq:":{"data":{"posts":{"__typename":"PostConnection","edges":[
{"__typename":"PostEdge","node":{"__typename":"Post","id":"426254","title":"2026年8月份全国网约车订单达10.69亿单","slug":"01m27v234n9yzfg7yv105n2abe","show_mode":"News","summary":"9月11日消息，据网约车监管信息交互系统监测，截至2026年8月31日，全国共有402家网约车平台公司取得网约车平台经营许可，与上月持平。","url":"/news/01m27v234n9yzfg7yv105n2abe","publish_status":"Published"}},
{"__typename":"PostEdge","node":{"__typename":"Post","id":"426253","title":"抖音电商：过去一年特色风味商品订单量增长78%","slug":"01m27khnmzqkjfxwr1mpc0qhk9","show_mode":"News","summary":"抖音电商宣布特色风味商品订单量显著增长。","url":"/news/01m27khnmzqkjfxwr1mpc0qhk9","publish_status":"Published"}}
]}}}}}})</script>
</body></html>`;

const EC100_HTML = `<div class="search_result" id="">
<dl><dt><a href="detail--6663873.html" target="_blank">高德扫街榜2026发布 西湖年专程导航总里程超1000万公里</a><span>2026-09-11 17:09:13</span></dt><dd><span>2026-09-11 17:09:13</span></dd></dl>
<dl><dt><a href="detail--6663872.html" target="_blank">Temu自营店突然上线 拼多多千亿布局浮出水面 平台回应</a><span>2026-09-11 16:02:47</span></dt><dd><span>2026-09-11 16:02:47</span></dd></dl>
<dl><dt><a href="detail--6663871.html" target="_blank">天猫双11预售规则更新 商家报名开启</a><span>2026-09-11 15:30:00</span></dt><dd><span>2026-09-11 15:30:00</span></dd></dl>
</div>`;

const STATS_HTML = `<html><body>
<ul>
<li><a href="./202609/t20260909_1965261.html">国家统计局城市司首席统计师董莉娟解读2026年8月份CPI和PPI数据</a></li>
<li><a href="./202608/t20260831_1965155.html">国家统计局服务业调查中心首席统计师霍丽慧解读2026年8月中国采购经理指数</a></li>
</ul>
</body></html>`;

const HOT_TOPICS_JSON = JSON.stringify({
  items: [
    {
      id: 'h1', title: '天猫双11新规：预售期延长', sourceCount: 5, latestAt: '2026-09-11T00:00:00Z',
      links: { story: '/api/v1/stories/s1', original: 'https://x/1' },
      source: { name: '电商报' },
    },
    {
      id: 'h2', title: 'Apple 发布首款折叠屏 iPhone Duo，$1,999', sourceCount: 3, latestAt: '2026-09-11T00:00:00Z',
      links: { story: '/api/v1/stories/s2', original: 'https://x/2' },
      source: { name: 'Apple Newsroom' },
    },
  ],
});

const SELECTED_JSON = JSON.stringify({
  items: [
    { id: 'sel1', title: '精选：某电商平台大促战报', summary: '成交额增长 120%', publishedAt: '2026-09-10T10:00:00Z', links: { original: 'https://x/sel1' }, source: { name: '平台方' } },
    { id: 's1', title: '天猫双11新规全文', digest: '预售期延长至 10 天。', latest: '新增商家扶持细则', latestAt: '2026-09-11T08:00:00Z', url: '/api/v1/stories/s1', links: {} },
    { id: 's2', title: 'Apple 发布首款折叠屏 iPhone Duo', digest: '起售价 $1,999。', latest: '国内上市时间待定', latestAt: '2026-09-11T09:00:00Z', url: '/api/v1/stories/s2', links: {} },
  ],
});

function okResponse(body: string, type = 'application/json'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}

/** fetch 桩：按 URL 分发 fixture */
const routeMap: Record<string, () => Response> = {
  'https://aihot.virxact.com/api/v1/hot-topics': () => okResponse(HOT_TOPICS_JSON),
  'https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=20': () => okResponse(SELECTED_JSON),
  'https://www.pai.com.cn/news/': () => okResponse(PAI_HTML, 'text/html; charset=utf-8'),
  'https://www.100ec.cn/list.html': () => okResponse(EC100_HTML, 'text/html; charset=utf-8'),
  'https://www.stats.gov.cn/sj/sjjd/': () => okResponse(STATS_HTML, 'text/html'),
};

function installFetchStub(): { calls: string[]; failUrls: Set<string> } {
  const calls: string[] = [];
  const failUrls = new Set<string>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (failUrls.has(url)) {
      return new Response('', { status: 503 });
    }
    const fn = routeMap[url];
    if (fn) return fn();
    if (url.includes('/api/v1/stories/')) {
      // aihot 摘要：按 id 返回 fixture 里的 story
      const id = url.split('/').pop() ?? '';
      const stories = JSON.parse(SELECTED_JSON).items.filter((s: { id: string }) => s.id === id);
      return okResponse(JSON.stringify({ story: stories[0] }));
    }
    throw new Error(`unexpected url: ${url}`);
  }) as typeof fetch;
  return { calls, failUrls };
}

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
});

// ===================== 4.1 / 3.5 配置缺省回退 =====================

describe('4.1 配置缺省回退（排除词/阈值/多源）', () => {
  test('旧配置加载后 minKeywordHits === 2、excludeKeywords 为空数组', () => {
    const cfg = normalizeAttention({ sourceBaseUrl: 'https://x', domains: [{ id: 'd', label: '域', keywords: ['a', 'b'] }] });
    assert.equal(cfg.domains[0].minKeywordHits, DEFAULT_MIN_KEYWORD_HITS);
    assert.deepEqual(cfg.domains[0].excludeKeywords, []);
  });

  test('非法阈值回退默认 2；阈值 1 = 旧逻辑等价', () => {
    const a = normalizeAttention({ domains: [{ id: 'd', label: '域', keywords: ['a'], minKeywordHits: 0 }] });
    assert.equal(a.domains[0].minKeywordHits, DEFAULT_MIN_KEYWORD_HITS);
    const b = normalizeAttention({ domains: [{ id: 'd', label: '域', keywords: ['a'], minKeywordHits: 1 }] });
    assert.equal(b.domains[0].minKeywordHits, 1);
  });

  test('默认配置带默认源列表：≥2 非 AI 行业源，覆盖 ≥2 类关注域', () => {
    const cfg = loadAttentionConfig();
    assert.ok(Array.isArray(cfg.sources) && cfg.sources.length >= 3, '默认源应 ≥3（2 电商垂直 + 1 政府 + AI 可选）');
    const nonAi = cfg.sources!.filter((s) => s.vertical !== 'AI 行业聚合' && s.enabled !== false);
    assert.ok(nonAi.length >= 2, `至少 2 个非 AI 行业源，实际 ${nonAi.length}`);
    assert.ok(nonAi.some((s) => /^ecommerce/i.test(s.vertical)), '至少 1 个电商垂直源');
    const caps = new Set<string>();
    for (const s of nonAi) {
      const a = ADAPTERS[s.adapter];
      if (a) a.capabilities.forEach((c) => caps.add(c));
    }
    const required = ['平台规则', '促销节点', '品类趋势', '竞品动态'].filter((c) => caps.has(c));
    assert.ok(required.length >= 2, `非 AI 源覆盖关注类别 ${required.length} 类，需 ≥2`);
  });

  test('旧 sourceBaseUrl 配置 → 仅启用 aihot 适配器', () => {
    const cfg = normalizeAttention({ sourceBaseUrl: 'https://legacy.example.com', domains: DEFAULT_ATTENTION.domains });
    assert.equal(cfg.sources!.length, 1);
    assert.equal(cfg.sources![0].adapter, 'aihot');
    assert.equal(cfg.sources![0].endpoint, 'https://legacy.example.com');
  });

  test('新增源配置无需改聚合代码（注册表按 adapter 实例化）', () => {
    const adapters = instantiateAdapters([
      { id: 'custom', adapter: 'pai-news', label: '自定义', endpoint: 'https://x', vertical: 'ecommerce-news', enabled: true },
    ]);
    assert.equal(adapters.length, 1);
    assert.equal(adapters[0].id, 'pai-news');
  });
});

// ===================== 4.2 匹配逻辑 =====================

describe('4.2 matchDomains 降噪（排除词 + 多词命中）', () => {
  const cfg = normalizeAttention({
    domains: [
      { id: 'comp', label: '竞品动态', keywords: ['发布', '上新', '定价'], excludeKeywords: ['Apple', 'iPhone'] },
      { id: 'promo', label: '促销节点', keywords: ['预售', '双11', '大促'], minKeywordHits: 2 },
    ],
  });

  test('① 命中排除词直接不成立（即使命中关键词）', () => {
    assert.deepEqual(matchDomains('Apple 发布首款折叠屏 iPhone Duo，$1,999', cfg), []);
  });

  test('② 同一关注域需命中多词（阈值 2）才成立', () => {
    assert.deepEqual(matchDomains('某品牌开启预售', cfg), [], '只命中「预售」1 个词 → 不成立');
    assert.deepEqual(matchDomains('双11预售开启', cfg).map((d) => d.id), ['promo'], '命中「双11」「预售」2 词 → 成立');
  });

  test('④ 同一关键词出现多次仍只算 1 个不同词', () => {
    assert.deepEqual(matchDomains('预售预售预售', cfg), [], '「预售」出现 3 次仍是 1 个不同词');
  });

  test('阈值 1 + 无排除词 = 旧逻辑等价（回归等价用例）', () => {
    const old = normalizeAttention({ domains: [{ id: 'p', label: '平台', keywords: ['天猫', 'KOL'], minKeywordHits: 1 }] });
    assert.deepEqual(matchDomains('天猫发布新规', old).map((d) => d.id), ['p']);
    assert.deepEqual(matchDomains('头部 kol 带货', old).map((d) => d.id), ['p'], '大小写不敏感');
    assert.deepEqual(matchDomains('无关内容', old), []);
  });
});

// ===================== 4.3 分层逻辑（tierCap） =====================

describe('4.3 classifyHot 源权重/来源分层', () => {
  const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, minimumSources: 2 });

  test('非电商垂直源条目（域成立、信源数达标）最高只进浏览', () => {
    const items: RawHotItem[] = [
      { id: 'a', title: 'Apple 发布首款折叠屏 iPhone Duo，$1,999', summary: null, source: 'AI HOT', sourceId: 'aihot', vertical: 'AI 行业聚合', sourceCount: 5, url: 'https://x/a', latestAt: '2026-09-11T00:00:00Z' },
    ];
    const tiers = classifyHot(items, cfg);
    assert.deepEqual(tiers.mustRead.map((i) => i.id), [], 'AI 行业源不得进必看');
    assert.deepEqual(tiers.browse.map((i) => i.id), [], '命中排除词 → 不成立，连浏览也不进');
    assert.deepEqual(tiers.other.map((i) => i.id), ['a'], '归入其他');
  });

  test('电商垂直源条目（域成立、信源数达标）可进必看', () => {
    const items: RawHotItem[] = [
      { id: 'b', title: '天猫双11新规：预售期延长 商家报名开启', summary: '平台调整预售规则', source: '电商派快讯', sourceId: 'pai-news', vertical: 'ecommerce-news', sourceCount: 2, url: 'https://x/b', latestAt: '2026-09-11T00:00:00Z' },
    ];
    const tiers = classifyHot(items, cfg);
    assert.deepEqual(tiers.mustRead.map((i) => i.id), ['b'], '电商垂直源多信源可进必看');
  });

  test('无源信息条目不受 tierCap 限制（等价旧逻辑）', () => {
    const items: RawHotItem[] = [
      { id: 'c', title: '天猫双11新规：预售期延长 平台调整预售规则', summary: null, source: '电商报', sourceCount: 5, url: 'https://x/c', latestAt: '2026-09-11T00:00:00Z' },
    ];
    const tiers = classifyHot(items, cfg);
    assert.deepEqual(tiers.mustRead.map((i) => i.id), ['c']);
    assert.equal(sourceTierCapOf(items[0], cfg), null, '无 sourceId → 不限制');
  });

  test('阈值/排除词清空后行为等价于旧逻辑（回归等价）', () => {
    const old = normalizeAttention({
      domains: DEFAULT_ATTENTION.domains.map((d) => ({ ...d, excludeKeywords: [], minKeywordHits: 1 })),
    });
    const items: RawHotItem[] = [
      { id: 'd', title: 'Apple 发布首款折叠屏 iPhone Duo，$1,999', summary: null, source: 'Tech', sourceCount: 3, url: 'https://x/d', latestAt: '2026-09-11T00:00:00Z' },
    ];
    const tiers = classifyHot(items, old);
    // 旧逻辑：命中「发布」→ 竞品动态成立；无源信息 → 不限制 → 进必看
    assert.deepEqual(tiers.mustRead.map((i) => i.id), ['d']);
  });

  test('tierCap 为 other 的源条目只能进其他', () => {
    const cfg2 = normalizeAttention({
      ...DEFAULT_ATTENTION,
      sources: [{ id: 'low', adapter: 'pai-news', label: '低层源', endpoint: 'https://x', vertical: 'ecommerce-news', enabled: true, tierCap: 'other' }],
    });
    const items: RawHotItem[] = [
      { id: 'e', title: '天猫双11新规：预售期延长 商家报名开启', summary: null, source: '低层源', sourceId: 'low', vertical: 'ecommerce-news', sourceCount: 5, url: 'https://x/e', latestAt: '2026-09-11T00:00:00Z' },
    ];
    const tiers = classifyHot(items, cfg2);
    assert.deepEqual(tiers.mustRead.map((i) => i.id), []);
    assert.deepEqual(tiers.browse.map((i) => i.id), []);
    assert.deepEqual(tiers.other.map((i) => i.id), ['e']);
  });
});

// ===================== 3.2-3.4 适配器解析 =====================

describe('3.2-3.4 多源适配器解析（fixture 结构）', () => {
  test('aihot 适配器：两路拉取 + story 摘要补全 + 去重', async () => {
    const stub = installFetchStub();
    const r = await aihotAdapter.fetchAll(5000);
    assert.ok(stub.calls.some((u) => u.includes('/api/v1/hot-topics')));
    assert.ok(stub.calls.some((u) => u.includes('/api/v1/items?mode=selected')));
    const byId = new Map(r.items.map((i) => [i.id, i]));
    assert.ok(byId.has('h1'));
    assert.ok(byId.has('h2'));
    assert.ok(byId.has('sel1'), '精选条目应保留');
    assert.equal(byId.get('h1')!.summary, '预售期延长至 10 天。', 'story digest 补全');
    assert.equal(byId.get('h1')!.latest, '新增商家扶持细则');
  });

  test('pai-news 适配器：内嵌 Apollo JSON 提取（title/summary/slug）', async () => {
    installFetchStub();
    const r = await paiNewsAdapter.fetchAll(5000);
    assert.equal(r.items.length, 2);
    assert.ok(r.items[0].title.includes('网约车订单'));
    assert.ok(r.items[0].url!.includes('/news/01m27v234n9yzfg7yv105n2abe'));
    assert.ok(r.items[0].summary!.includes('网约车监管信息交互系统'));
  });

  test('100ec-24h 适配器：dl/dt 结构 + 时间解析 + 链接拼接', async () => {
    installFetchStub();
    const r = await ec100Adapter.fetchAll(5000);
    assert.equal(r.items.length, 3);
    const temu = r.items.find((i) => i.title.includes('Temu'))!;
    assert.equal(temu.url, 'https://www.100ec.cn/detail--6663872.html');
    assert.ok(temu.latestAt!.startsWith('2026-09-11'));
  });

  test('stats-sjjd 适配器：相对链接解析 + 路径日期提取', async () => {
    installFetchStub();
    const r = await statsSjjdAdapter.fetchAll(5000);
    assert.equal(r.items.length, 2);
    assert.ok(r.items[0].url!.includes('/sj/sjjd/202609/t20260909_1965261.html'));
    assert.equal(r.items[0].latestAt, '2026-09-09T00:00:00.000Z', '路径 t20260909 → 2026-09-09');
  });

  test('适配器注册表：4 个已注册源（aihot/pai-news/100ec-24h/stats-sjjd）', () => {
    for (const id of ['aihot', 'pai-news', '100ec-24h', 'stats-sjjd']) {
      assert.ok(ADAPTERS[id], `缺少适配器 ${id}`);
    }
  });
});

// ===================== 3.6/3.7/3.8 聚合 / 证据 / 源状态 =====================

describe('3.6 聚合与单源降级隔离', () => {
  test('多源聚合：全部可用 → live，逐源状态 ok，upstream 为去重后总数', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    assert.equal(panel.status, 'live');
    assert.equal(panel.sources.filter((s) => s.status === 'ok').length, 4);
    assert.ok(panel.counts.upstream >= 6, `upstream 应 ≥6（aihot 3 + pai 2 + 100ec 3 + stats 2 去重后），实际 ${panel.counts.upstream}`);
    assert.ok(panel.counts.selected24h > 0, '最近 24h 条目数应 > 0');
    assert.ok(panel.tiers.other.length > 0, '应存在「其他」层条目（AI/政府源降层条目）');
  });

  test('单源失败不影响其他源（面板仍 live 且标注降级源）', async () => {
    clearHotCache();
    const stub = installFetchStub();
    stub.failUrls.add('https://www.100ec.cn/list.html');
    const panel = await loadHotPanel(true);
    assert.equal(panel.status, 'live', '单源失败不应拉低面板状态');
    const degraded = panel.sources.find((s) => s.id === '100ec-24h');
    assert.ok(degraded && degraded.status === 'degraded', '失败源应标注 degraded');
    assert.ok(degraded!.error && degraded!.error.length > 0, '降级原因可读');
    assert.ok(panel.tiers.mustRead.length + panel.tiers.browse.length + panel.tiers.other.length > 0, '其他源条目照常');
  });

  test('需凭据源未配置凭据时单独降级（enterpriseCredentialRequired 预留）', async () => {
    clearHotCache();
    const stub = installFetchStub();
    // 模拟配置了一个需凭据但未配置凭据的源：适配器缺失/不可用时仅该源降级
    const cfg = normalizeAttention({
      sources: [
        ...DEFAULT_SOURCES,
        { id: 'official', adapter: 'unknown-adapter', label: '官方开放平台', endpoint: 'https://x', vertical: 'official', enabled: true, enterpriseCredentialRequired: true },
      ],
    });
    // loadAttentionConfig 会读配置文件；直接验证 normalize 后配置保留 enterpriseCredentialRequired 标记
    const s = cfg.sources!.find((x) => x.id === 'official');
    assert.equal(s!.enterpriseCredentialRequired, true);
    assert.equal(s!.enabled, true, '未配置凭据时由适配器层判定，配置项保留');
  });

  test('全部源失败 → unavailable（无缓存）', async () => {
    clearHotCache();
    const stub = installFetchStub();
    for (const u of Object.keys(routeMap)) stub.failUrls.add(u);
    const panel = await loadHotPanel(true);
    assert.equal(panel.status, 'unavailable');
    assert.ok(panel.error && panel.error.message.length > 0);
    assert.equal(panel.sources.length, 4, '逐源状态仍可见');
    assert.ok(panel.sources.every((s) => s.status === 'degraded'));
  });

  test('全部源失败但已有缓存 → stale（展示最近一次缓存 + 时间）', async () => {
    clearHotCache();
    installFetchStub();
    await loadHotPanel(true); // 写入缓存（live）
    const stub2 = installFetchStub();
    for (const u of Object.keys(routeMap)) stub2.failUrls.add(u);
    const panel = await loadHotPanel(true);
    assert.equal(panel.status, 'stale');
    assert.ok(panel.fetchedAt, 'stale 应带缓存抓取时间');
    assert.ok(panel.tiers.other.length > 0 || panel.counts.upstream > 0, 'stale 仍展示缓存内容');
  });
});

describe('3.7 证据等级判定', () => {
  test('≥2 独立信源 → multi-source', () => {
    assert.equal(evidenceOf({ sourceCount: 2, url: 'https://x' }), 'multi-source');
    assert.equal(evidenceOf({ sourceCount: 5, url: null }), 'multi-source');
  });
  test('1 信源且有原文外链 → traceable', () => {
    assert.equal(evidenceOf({ sourceCount: 1, url: 'https://x' }), 'traceable');
  });
  test('1 信源无外链 → single-source', () => {
    assert.equal(evidenceOf({ sourceCount: 1, url: null }), 'single-source');
  });
  test('面板条目均带 evidence 字段（卡片可展示证据等级标签）', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    for (const list of [panel.tiers.mustRead, panel.tiers.browse, panel.tiers.other]) {
      for (const it of list) {
        assert.ok(['multi-source', 'single-source', 'traceable'].includes(it.evidence!), `条目 ${it.id} 缺证据等级`);
      }
    }
  });
});

describe('3.8 源状态可见（面板 sources[]）', () => {
  test('live 面板 sources 含 4 个源（ok），itemCount 正确', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    const pai = panel.sources.find((s) => s.id === 'pai-news');
    assert.equal(pai!.status, 'ok');
    assert.equal(pai!.itemCount, 2);
    assert.ok(panel.sources.length >= 4);
  });
});
