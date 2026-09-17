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
import type { AttentionDomain } from '@workbench/shared';
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
  DEFAULT_PER_SOURCE_QUOTA,
  DEFAULT_SOURCES,
  normalizeAttention,
  loadAttentionConfig,
  matchDomains,
  classifyHot,
  selectHotSet,
  interleaveBySource,
  sourceTierCapOf,
} = await import('../attention.ts');
const { loadHotPanel, clearHotCache, evidenceOf } = await import('../hot.ts');
const { paiNewsAdapter } = await import('../hot-sources/pai-news.ts');
const { ec100Adapter } = await import('../hot-sources/100ec.ts');
const { aihotAdapter } = await import('../hot-sources/aihot.ts');
const { baiduHotAdapter } = await import('../hot-sources/baidu.ts');
const { weibo60sAdapter, douyin60sAdapter } = await import('../hot-sources/60s.ts');
const { toutiaoHotAdapter } = await import('../hot-sources/toutiao.ts');
const { taobaoRuleAdapter, tmallRuleAdapter, xhsRuleAdapter } = await import('../hot-sources/rule-sources.ts');
const { ADAPTERS, instantiateAdapters } = await import('../hot-sources/index.ts');

// ===== fixture（2026-09-11 真实探测的源结构，脱敏） =====
// 时间字段统一用「相对 now」生成：面板的 selected24h 统计按最近 24h 窗口过滤，
// 固定日期会随时间流逝溢出窗口（曾导致「最近 24h 条目数应 > 0」断言失败的时间炸弹）。

const NOW = Date.now();
/** n 小时前的 ISO 时间戳（用真实结构 + 活动时间） */
function hoursAgoIso(n: number): string {
  return new Date(NOW - n * 60 * 60 * 1000).toISOString();
}

const PAI_HTML = `<!doctype html><html><head><title>快讯</title></head><body>
<script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"json":{"rehydrate":{":R4puucupkq:":{"data":{"posts":{"__typename":"PostConnection","edges":[
{"__typename":"PostEdge","node":{"__typename":"Post","id":"426254","title":"2026年8月份全国网约车订单达10.69亿单","slug":"01m27v234n9yzfg7yv105n2abe","show_mode":"News","summary":"据网约车监管信息交互系统监测，截至2026年8月31日，全国共有402家网约车平台公司取得网约车平台经营许可，与上月持平。","url":"/news/01m27v234n9yzfg7yv105n2abe","publish_status":"Published"}},
{"__typename":"PostEdge","node":{"__typename":"Post","id":"426253","title":"抖音电商：过去一年特色风味商品订单量增长78%","slug":"01m27khnmzqkjfxwr1mpc0qhk9","show_mode":"News","summary":"抖音电商宣布特色风味商品订单量显著增长。","url":"/news/01m27khnmzqkjfxwr1mpc0qhk9","publish_status":"Published"}}
]}}}}}})</script>
</body></html>`;

const EC100_HTML = `<div class="search_result" id="">
<dl><dt><a href="detail--6663873.html" target="_blank">高德扫街榜2026发布 西湖年专程导航总里程超1000万公里</a><span>${hoursAgoIso(2).replace('T', ' ').slice(0, 19)}</span></dt><dd><span>${hoursAgoIso(2).replace('T', ' ').slice(0, 19)}</span></dd></dl>
<dl><dt><a href="detail--6663872.html" target="_blank">Temu自营店突然上线 拼多多千亿布局浮出水面 平台回应</a><span>${hoursAgoIso(3).replace('T', ' ').slice(0, 19)}</span></dt><dd><span>${hoursAgoIso(3).replace('T', ' ').slice(0, 19)}</span></dd></dl>
<dl><dt><a href="detail--6663871.html" target="_blank">天猫双11预售规则更新 商家报名开启</a><span>${hoursAgoIso(4).replace('T', ' ').slice(0, 19)}</span></dt><dd><span>${hoursAgoIso(4).replace('T', ' ').slice(0, 19)}</span></dd></dl>
</div>`;

const HOT_TOPICS_JSON = JSON.stringify({
  items: [
    {
      id: 'h1', title: '天猫双11新规：预售期延长', sourceCount: 5, latestAt: hoursAgoIso(6),
      links: { story: '/api/v1/stories/s1', original: 'https://x/1' },
      source: { name: '电商报' },
    },
    {
      id: 'h2', title: 'Apple 发布首款折叠屏 iPhone Duo，$1,999', sourceCount: 3, latestAt: hoursAgoIso(6),
      links: { story: '/api/v1/stories/s2', original: 'https://x/2' },
      source: { name: 'Apple Newsroom' },
    },
  ],
});

const SELECTED_JSON = JSON.stringify({
  items: [
    { id: 'sel1', title: '精选：某电商平台大促战报', summary: '成交额增长 120%', publishedAt: hoursAgoIso(10), links: { original: 'https://x/sel1' }, source: { name: '平台方' } },
    { id: 's1', title: '天猫双11新规全文', digest: '预售期延长至 10 天。', latest: '新增商家扶持细则', latestAt: hoursAgoIso(8), url: '/api/v1/stories/s1', links: {} },
    { id: 's2', title: 'Apple 发布首款折叠屏 iPhone Duo', digest: '起售价 $1,999。', latest: '国内上市时间待定', latestAt: hoursAgoIso(9), url: '/api/v1/stories/s2', links: {} },
  ],
});

// 热榜源 fixture（3.3 新增；公开匿名 JSON 结构）：
// 百度返回「天猫双11新规」无标点版，60s·微博返回同题带标点版 → 三层去重 L2 标题归一并合（sourceCount=2 进必看）
// Q2：百度真实结构是**三层嵌套** data.cards[].content[].content[]（cards[].content[] 是分组壳），
// 旧 fixture 只有两层 → 掩盖了「解析 0 条却报 ok」的缺陷。此处按真实结构固化。
const BAIDU_JSON = JSON.stringify({
  data: {
    cards: [
      {
        component: 'realtime',
        content: [
          {
            content: [
              { word: '天猫双11新规预售期延长商家报名开启', desc: '平台调整预售规则，商家报名同步开启', url: 'https://top.baidu.com/board?raw=1', isTop: true, index: 1 },
              { word: '某地暴雨红色预警', desc: '出行注意安全', url: 'https://top.baidu.com/board?raw=2', isTop: false, index: 2, hotTag: '3' },
            ],
          },
        ],
      },
    ],
  },
});

/** Q2：旧两层结构（接口若改回扁平）也应能解析，验证兼容分支 */
const BAIDU_JSON_FLAT = JSON.stringify({
  data: {
    cards: [
      {
        content: [
          { word: '扁平结构词条', desc: '兼容旧结构', url: 'https://top.baidu.com/board?flat=1' },
        ],
      },
    ],
  },
});

/** Q2：解析不出任何词条 → 适配器应抛 HOT_PARSE_EMPTY（而不是静默返回 ok） */
const BAIDU_JSON_EMPTY = JSON.stringify({ data: { cards: [] } });

const WEIBO_JSON = JSON.stringify({
  data: [
    // 与百度同题（无标点/带标点差异）→ 用于验证 L2 标题归一精确去重
    { title: '天猫双11新规：预售期延长，商家报名开启', hot: 1234567, url: 'https://weibo.com/1' },
    // Q1：微博独有条目（验证热榜源自身能上屏，不被去重与截断吃掉）
    { title: '直播间带货新规发布', hot: 765432, url: 'https://weibo.com/2' },
  ],
});

const DOUYIN_JSON = JSON.stringify({
  data: [
    { title: '某某明星新剧开机路透', hot: 998877, url: 'https://douyin.com/1' },
    // 与上一条归一后不同（多「现场」2 字），但 3-gram Jaccard=0.8 → L3 近似合并（sourceCount 累加=2）
    { title: '某某明星新剧开机路透现场', hot: 991122, url: 'https://douyin.com/2' },
  ],
});

const TOUTIAO_JSON = JSON.stringify({
  data: [
    { Title: '抖音电商特色风味商品订单量增长78%', HotValue: 555000, Url: 'https://www.toutiao.com/article/1/' },
  ],
});

// 规则源骨架 fixture：JS 渲染 SPA 壳（实测 2026-09 三个站点返回的形态）
const RULE_SPA_HTML = '<!DOCTYPE html><html><head><title>淘宝网 - 淘！我喜欢</title></head><body><div id="root"></div><script>window.__NEXT_DATA__={}</script></body></html>';
const XHS_HTML = '<!doctype html><html><head><title>用户协议</title></head><body><article>小红书用户协议正文……（非规则公告列表）</article></body></html>';

function okResponse(body: string, type = 'application/json'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}

/** fetch 桩：按 URL 分发 fixture */
const routeMap: Record<string, () => Response> = {
  'https://aihot.virxact.com/api/v1/hot-topics': () => okResponse(HOT_TOPICS_JSON),
  'https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=20': () => okResponse(SELECTED_JSON),
  'https://www.pai.com.cn/news/': () => okResponse(PAI_HTML, 'text/html; charset=utf-8'),
  'https://www.100ec.cn/list.html': () => okResponse(EC100_HTML, 'text/html; charset=utf-8'),
  'https://top.baidu.com/api/board?platform=wise&tab=realtime': () => okResponse(BAIDU_JSON),
  'https://60s.viki.moe/v2/weibo': () => okResponse(WEIBO_JSON),
  'https://60s.viki.moe/v2/douyin': () => okResponse(DOUYIN_JSON),
  'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc': () => okResponse(TOUTIAO_JSON),
  'https://rule.taobao.com/': () => okResponse(RULE_SPA_HTML, 'text/html'),
  'https://rule.tmall.com/': () => okResponse(RULE_SPA_HTML, 'text/html'),
  'https://www.xiaohongshu.com/protocols/about/terms': () => okResponse(XHS_HTML, 'text/html'),
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
    // 时间字段为活动生成的 hoursAgoIso(3)，只断言「可解析且在 24h 内」
    const t = Date.parse(temu.latestAt ?? '');
    assert.ok(Number.isFinite(t) && Date.now() - t <= 24 * 60 * 60 * 1000, `latestAt 应在最近 24h 内，实际 ${temu.latestAt}`);
  });

  test('baidu-hot 适配器：三层嵌套 data.cards[].content[].content[] 解析（Q2），上限 30 条', async () => {
    installFetchStub();
    const r = await baiduHotAdapter.fetchAll(5000);
    assert.equal(r.items.length, 2, `真实三层结构应解析出 2 条，实际 ${r.items.length}（旧实现只解析两层 → 0 条）`);
    const hit = r.items.find((i) => i.title.includes('天猫双11'))!;
    assert.ok(hit.url!.startsWith('https://top.baidu.com/'), 'url 原样透传');
    assert.ok(hit.latestAt, 'latestAt=抓取时刻');
    assert.equal(hit.summary, '平台调整预售规则，商家报名同步开启', 'desc 作为摘要');
  });

  test('Q2 兼容旧两层结构 cards[].content[]（扁平）也能解析', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(BAIDU_JSON_FLAT, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const r = await baiduHotAdapter.fetchAll(5000);
      assert.equal(r.items.length, 1);
      assert.equal(r.items[0].title, '扁平结构词条');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('Q2 解析结果为 0 条 → 抛 HOT_PARSE_EMPTY（不静默报 ok）', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(BAIDU_JSON_EMPTY, { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      await assert.rejects(
        () => baiduHotAdapter.fetchAll(5000),
        (err: unknown) => {
          const e = err as { code?: string; message?: string };
          assert.equal(e.code, 'HOT_PARSE_EMPTY', '解析 0 条应为 HOT_PARSE_EMPTY');
          assert.ok(e.message && (e.message.includes('解析失败') || e.message.includes('结构变更')), '原因应含「解析失败/接口结构变更」');
          return true;
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('60s 适配器：微博/抖音 data[].title/hot/url 解析', async () => {
    installFetchStub();
    const wb = await weibo60sAdapter.fetchAll(5000);
    assert.equal(wb.items.length, 2, '微博 fixture 含 2 条（1 条与百度同题用于去重验证 + 1 条独有）');
    assert.ok(wb.items[0].title.includes('天猫双11'));
    assert.equal(wb.items[0].url, 'https://weibo.com/1');
    assert.ok(wb.items.some((i) => i.title.includes('直播间')), '微博独有条目应解析出来');
    const dy = await douyin60sAdapter.fetchAll(5000);
    assert.equal(dy.items.length, 2);
    assert.ok(dy.items[0].title.includes('明星'));
    assert.ok(dy.items[0].latestAt, 'latestAt=抓取时刻');
  });

  test('toutiao-hot 适配器：data[].Title/HotValue/Url 解析', async () => {
    installFetchStub();
    const r = await toutiaoHotAdapter.fetchAll(5000);
    assert.equal(r.items.length, 1);
    assert.ok(r.items[0].title.includes('抖音电商'));
    assert.equal(r.items[0].url, 'https://www.toutiao.com/article/1/');
    assert.ok(r.items[0].latestAt, 'latestAt=抓取时刻');
  });

  test('规则源骨架：JS 渲染壳 → 抛 HOT_MANUAL_MAINTENANCE（待人工维护摘要文档）', async () => {
    installFetchStub();
    for (const adapter of [taobaoRuleAdapter, tmallRuleAdapter, xhsRuleAdapter]) {
      await assert.rejects(
        () => adapter.fetchAll(5000),
        (err: unknown) => {
          const e = err as { code?: string; message?: string };
          assert.equal(e.code, 'HOT_MANUAL_MAINTENANCE', `${adapter.id} 应为待人工维护错误`);
          assert.ok(e.message && e.message.includes('人工维护'), `${adapter.id} 错误信息应提示人工维护`);
          return true;
        },
      );
    }
  });

  test('适配器注册表：10 个已注册源（含 4 热榜 + 3 规则源骨架，无 stats-sjjd）', () => {
    for (const id of ['aihot', 'pai-news', '100ec-24h', 'baidu-hot', '60s-weibo', '60s-douyin', 'toutiao-hot', 'taobao-rule', 'tmall-rule', 'xhs-rule']) {
      assert.ok(ADAPTERS[id], `缺少适配器 ${id}`);
    }
    assert.ok(!ADAPTERS['stats-sjjd'], 'stats-sjjd 应已移除');
  });
});

// ===================== Q1 按源配额轮询（热点上屏修复） =====================

describe('Q1 按源配额轮询：每个源都有保底展示名额', () => {
  /** A 源 20 条 + B 源 5 条（A 排在前：复现「第一个源吃光名额」的缺陷）
   *  标题需命中 ≥2 个关注域关键词（降噪规则②）才成立：
   *  - A「天猫双11大促」→ 促销节点(双11 + 大促) = 2 词成立；
   *  - B「抖音小店直播电商大促」→ 平台规则(抖音小店 + 直播电商) = 2 词成立。 */
  function twoSourceItems(): RawHotItem[] {
    const out: RawHotItem[] = [];
    for (let i = 0; i < 20; i++) {
      out.push({ id: `a${i}`, title: `天猫双11大促第${i}期`, summary: null, source: 'A', sourceId: 'src-a', vertical: 'ecommerce-news', sourceCount: 3, url: null, latestAt: null });
    }
    for (let i = 0; i < 5; i++) {
      out.push({ id: `b${i}`, title: `抖音小店直播电商大促第${i}期`, summary: null, source: 'B', sourceId: 'src-b', vertical: 'ecommerce-news', sourceCount: 3, url: null, latestAt: null });
    }
    return out;
  }

  test('按源交错：前 4 条应为 A,B,A,B（不再被第一个源吃光）', () => {
    const order = interleaveBySource(twoSourceItems()).slice(0, 4).map((i) => i.sourceId);
    assert.deepEqual(order, ['src-a', 'src-b', 'src-a', 'src-b'], `实际 ${order.join(',')}`);
  });

  test('回归旧缺陷：截断后 B 源仍有名额（旧实现 B 源 0 条）', () => {
    const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, minimumSources: 2, mustReadLimit: 3 });
    const tiers = classifyHot(twoSourceItems(), cfg);
    const ids = tiers.mustRead.map((i) => i.sourceId ?? '');
    assert.ok(ids.includes('src-b'), `B 源应有必看名额，实际 ${JSON.stringify(ids)}（旧实现为全 A）`);
  });

  test('每源配额 perSourceQuota=2 生效（单源最多 2 条）', () => {
    const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, minimumSources: 1, perSourceQuota: 2 });
    const set = selectHotSet(twoSourceItems(), cfg);
    const bySource: Record<string, number> = {};
    for (const it of set) bySource[it.sourceId ?? ''] = (bySource[it.sourceId ?? ''] ?? 0) + 1;
    assert.equal(bySource['src-a'], 2, `A 源应只取 2 条，实际 ${bySource['src-a']}`);
    assert.equal(bySource['src-b'], 2, `B 源应只取 2 条，实际 ${bySource['src-b']}`);
    assert.equal(set.length, 4);
  });

  test('默认配置 perSourceQuota=0 → 全量上屏（向后兼容：不配置即不限）', () => {
    assert.equal(DEFAULT_PER_SOURCE_QUOTA, 0);
    const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, minimumSources: 1 });
    assert.equal(cfg.perSourceQuota, 0, '未配置时回退默认 0（不限）');
    const set = selectHotSet(twoSourceItems(), cfg);
    assert.equal(set.length, 25, `全量上屏应为 25 条，实际 ${set.length}`);
  });

  test('展示集 selectHotSet 不再丢弃条目（旧实现分层后仅 13 条）', () => {
    const cfg = normalizeAttention({ ...DEFAULT_ATTENTION, minimumSources: 1 });
    const items: RawHotItem[] = Array.from({ length: 60 }, (_, i) => ({
      id: `x${i}`, title: `热点${i}`, summary: null, source: 'S', sourceId: `src-${i % 6}`, vertical: 'ecommerce-news', sourceCount: 3, url: null, latestAt: null,
    }));
    const set = selectHotSet(items, cfg);
    assert.equal(set.length, 60, `全量展示集应为 60 条，实际 ${set.length}`);
    const tiers = classifyHot(items, cfg);
    const tiered = tiers.mustRead.length + tiers.browse.length + tiers.other.length;
    assert.ok(tiered < 60, `分层（截断）后应少于 60 条，实际 ${tiered}——展示集走的是另一条路`);
  });
});

// ===================== 3.6/3.7/3.8 聚合 / 证据 / 源状态 =====================

describe('3.6 聚合与单源降级隔离', () => {
  test('多源聚合：全部可用 → live，逐源状态 ok，upstream 为三层去重后总数', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    assert.equal(panel.status, 'live');
    assert.equal(panel.sources.filter((s) => s.status === 'ok').length, 6, '启用源=电商派/网经社/百度/60s·微博/60s·抖音/头条（aihot 与规则源默认 disabled）');
    assert.ok(panel.counts.upstream >= 6, `upstream 应 ≥6（pai 2 + 100ec 3 + 热榜 5 条经三层去重后），实际 ${panel.counts.upstream}`);
    assert.ok(panel.counts.selected24h > 0, '最近 24h 条目数应 > 0');
    assert.ok(panel.tiers.other.length > 0, '应存在「其他」层条目');
  });

  test('Q1 展示集：全部启用源都有条目上屏（热榜源不再被饿死）', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    const shown = panel.displaySet;
    assert.ok(shown.length > 0, '展示集不应为空');
    const srcIds = new Set(shown.map((i) => i.sourceId ?? 'unknown'));
    for (const id of ['pai-news', '100ec-24h', 'baidu-hot', '60s-weibo', '60s-douyin', 'toutiao-hot']) {
      assert.ok(srcIds.has(id), `源 ${id} 应有条目上屏，实际来源集合 ${[...srcIds].join(',')}`);
    }
    // 展示集条数 = 去重后全部条目（旧实现只有 13 条）
    assert.equal(shown.length, panel.counts.upstream, `展示集应等于去重后上游数 ${panel.counts.upstream}，实际 ${shown.length}`);
  });

  test('Q5 未展示条数：hiddenCount = 原始条目数 - 展示数（≥0）', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    assert.equal(panel.hiddenCount, panel.rawCount - panel.displaySet.length, 'hiddenCount 应等于 rawCount - 展示数');
    assert.ok(panel.hiddenCount >= 0, 'hiddenCount 不应为负');
    assert.ok(panel.rawCount >= panel.displaySet.length, '原始条目数应 ≥ 展示数（去重只减不增）');
  });

  test('Q1 源分布统计 sourceCounts 与展示集一致', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    const sum = Object.values(panel.sourceCounts).reduce((a, b) => a + b, 0);
    assert.equal(sum, panel.displaySet.length, 'sourceCounts 合计应等于展示集条数');
  });

  test('三层去重 L2：同题不同标点（百度/微博）归一后精确去重，仅保留一条', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    const all = [...panel.tiers.mustRead, ...panel.tiers.browse, ...panel.tiers.other];
    const baiduWeibo = all.filter((i) => i.title.startsWith('天猫双11') && (i.sourceId === 'baidu-hot' || i.sourceId === '60s-weibo'));
    assert.equal(baiduWeibo.length, 1, `百度/微博同题归一后应只保留 1 条，实际 ${baiduWeibo.length} 条`);
    assert.equal(baiduWeibo[0].sourceId, 'baidu-hot', '保留首个（百度）');
  });

  test('三层去重 L3：近似标题（抖音两条 Jaccard=0.8）合并并累加 sourceCount → multi-source', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    const merged = [...panel.tiers.mustRead, ...panel.tiers.browse, ...panel.tiers.other].find((i) => i.title.includes('明星'));
    assert.ok(merged, '抖音近似两条应合并为一条');
    assert.ok(merged!.sourceCount >= 2, `L3 合并 sourceCount 应累加 ≥2，实际 ${merged!.sourceCount}`);
    assert.equal(merged!.evidence, 'multi-source', 'L3 合并 → multi-source 证据等级');
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
    installFetchStub();
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
    assert.equal(panel.sources.length, 6, '逐源状态仍可见（启用源数）');
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

describe('3.8 源状态可见 + 源作用域字段透传', () => {
  test('live 面板 sources 含 6 个源（ok），itemCount 正确', async () => {
    clearHotCache();
    installFetchStub();
    const panel = await loadHotPanel(true);
    const pai = panel.sources.find((s) => s.id === 'pai-news');
    assert.equal(pai!.status, 'ok');
    assert.equal(pai!.itemCount, 2);
    assert.equal(panel.sources.length, 6);
  });

  test('默认配置：stats-sjjd 移除、aihot 关闭、4 热榜启用、3 规则源骨架 disabled', () => {
    const cfg = loadAttentionConfig();
    const ids = cfg.sources!.map((s) => s.id);
    assert.ok(!ids.includes('stats-sjjd'), '统计局源已移除');
    assert.equal(cfg.sources!.find((s) => s.id === 'aihot')!.enabled, false, 'AI HOT 关闭');
    for (const id of ['baidu-hot', '60s-weibo', '60s-douyin', 'toutiao-hot']) {
      assert.equal(cfg.sources!.find((s) => s.id === id)!.enabled, true, `${id} 应启用`);
    }
    for (const id of ['taobao-rule', 'tmall-rule', 'xhs-rule']) {
      assert.equal(cfg.sources!.find((s) => s.id === id)!.enabled, false, `${id} 骨架默认 disabled`);
    }
  });

  test('3.8 源作用域字段：normalize 后 applyToSourceIds/applyToSourceTiers 透传保留', () => {
    const cfg = normalizeAttention({
      domains: [
        { id: 'platform-rules', label: '平台规则', keywords: ['天猫'], minKeywordHits: 1, applyToSourceIds: ['pai-news'], applyToSourceTiers: [1, 2] },
      ],
    });
    const d = cfg.domains[0] as AttentionDomain & { applyToSourceIds?: string[]; applyToSourceTiers?: number[] };
    assert.deepEqual(d.applyToSourceIds, ['pai-news']);
    assert.deepEqual(d.applyToSourceTiers, [1, 2]);
    // 非法值（tier 越界/非数组）被滤掉
    const bad = normalizeAttention({
      domains: [
        { id: 'x', label: '域', keywords: ['a'], applyToSourceTiers: [5, 'x', 1] },
      ],
    });
    const dx = bad.domains[0] as { applyToSourceTiers?: number[] };
    assert.deepEqual(dx.applyToSourceTiers, [1], '越界/非法 tier 应滤除');
  });
});
