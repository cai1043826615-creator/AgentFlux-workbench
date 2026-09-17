/**
 * 电商化关注域配置（design.md D5，坑2；hot-intel D4 降噪三规则 + D3 多源配置）：
 * 默认关注域面向电商/品类/平台场景（品类趋势、平台规则、竞品动态、促销节点、内容营销），
 * 而非 person_dashboard 默认的 AI 行业关注域。
 *
 * 降噪三规则（hot-intel D4，全部可配置、缺省向后兼容）：
 * ① excludeKeywords：热点文本命中任一排除词 → 该关注域直接不成立（不是降一层，而是该域作废）；
 * ② minKeywordHits（默认 2）：同一关注域需命中 ≥ 阈值个不同关键词才成立（同一关键词重复只计 1 次）；
 * ③ sources[].tierCap：非电商垂直源条目最高只进「浏览」，电商垂直源条目才允许进「必看」。
 *
 * 多源配置（hot-intel D3）：sources[] 为可插拔适配器注册表配置；
 * 旧 sourceBaseUrl 视为「单源遗留配置」，映射为「仅启用 aihot 适配器」。
 *
 * 配置文件：backend/config/attention.json（本地保存，不入版本库）
 * 缺失时使用内置默认；写入后下次拉取即生效。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttentionConfig, AttentionDomain, HotItem, HotSourceConfig, HotTier } from '@workbench/shared';

/** 配置目录：backend/config（相对本文件定位，src 与 dist 均正确） */
const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'config');

/**
 * 关注域配置文件路径。
 * 可用环境变量 `WORKBENCH_ATTENTION_CONFIG` 覆盖（便于测试隔离或把配置放到别处）。
 */
export const ATTENTION_CONFIG_PATH = process.env.WORKBENCH_ATTENTION_CONFIG?.trim()
  ? process.env.WORKBENCH_ATTENTION_CONFIG.trim()
  : join(CONFIG_DIR, 'attention.json');

/** 默认数据源（公共匿名热点 API，零鉴权；实现期确认可用，见 design.md D5） */
export const DEFAULT_SOURCE_BASE_URL = 'https://aihot.virxact.com';

/** 缓存 TTL：15 分钟 */
export const HOT_CACHE_TTL_MS = 15 * 60 * 1000;

/** 请求超时：12 秒 */
export const HOT_REQUEST_TIMEOUT_MS = 12_000;

/** 内置默认多词命中阈值（降噪规则②） */
export const DEFAULT_MIN_KEYWORD_HITS = 2;

/**
 * 内置默认「每源展示配额」（Q1 热点上屏修复）：0 = 不限（全量上屏）。
 *
 * 背景：旧 classifyHot 按「上游收集顺序」截断（必看取前 3、浏览取前 8、其他取前 12），
 * 上游顺序 = 源注册顺序（电商派排第一）→ 第一个源吃光名额，本次新增的微博/抖音/头条热榜
 * 一条都上不了屏（报告 P1 缺陷 Q1）。改为按源配额轮询后，默认放开为「不限」，
 * 让每个源的条目都能上屏；需要限流时可配置 perSourceQuota > 0。
 */
export const DEFAULT_PER_SOURCE_QUOTA = 0;

/**
 * 内置默认源列表（report-driven-fixes 3.3/3.7 定案）：
 * - 保留电商垂直源：电商派 / 网经社（对工作台价值最高）；
 * - AI HOT 源关闭（disabled，保留条目便于恢复；适配器仍在注册表）；
 * - 新增 4 热榜源（百度/60s·微博/60s·抖音/头条，公开匿名 JSON，全部 enabled）；
 * - 官方规则源（淘宝/天猫/小红书）为「待人工维护摘要文档」骨架，默认 disabled（见 rule-sources.ts 实测结论）。
 * 覆盖 平台规则 / 促销节点 / 品类趋势 / 竞品动态 中的 ≥2 类。
 */
export const DEFAULT_SOURCES: HotSourceConfig[] = [
  {
    id: 'pai-news',
    adapter: 'pai-news',
    label: '电商派快讯',
    endpoint: 'https://www.pai.com.cn/news/',
    vertical: 'ecommerce-news',
    enabled: true,
    tierCap: 'mustRead',
  },
  {
    id: '100ec-24h',
    adapter: '100ec-24h',
    label: '网经社 24h 播报',
    endpoint: 'https://www.100ec.cn/list.html',
    vertical: 'ecommerce-news',
    enabled: true,
    tierCap: 'mustRead',
  },
  {
    id: 'baidu-hot',
    adapter: 'baidu-hot',
    label: '百度实时热点',
    endpoint: 'https://top.baidu.com/api/board?platform=wise&tab=realtime',
    vertical: 'hot-trend',
    enabled: true,
  },
  {
    id: '60s-weibo',
    adapter: '60s-weibo',
    label: '微博热搜(60s)',
    endpoint: 'https://60s.viki.moe/v2/weibo',
    vertical: 'hot-trend',
    enabled: true,
  },
  {
    id: '60s-douyin',
    adapter: '60s-douyin',
    label: '抖音热榜(60s)',
    endpoint: 'https://60s.viki.moe/v2/douyin',
    vertical: 'hot-trend',
    enabled: true,
  },
  {
    id: 'toutiao-hot',
    adapter: 'toutiao-hot',
    label: '头条热榜',
    endpoint: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    vertical: 'hot-trend',
    enabled: true,
  },
  {
    id: 'aihot',
    adapter: 'aihot',
    label: 'AI HOT（行业聚合）',
    endpoint: DEFAULT_SOURCE_BASE_URL,
    vertical: 'AI 行业聚合',
    // 3.3 定案：AI HOT 源关闭（保留条目与适配器，便于后续恢复）
    enabled: false,
    tierCap: 'browse',
  },
  {
    id: 'taobao-rule',
    adapter: 'taobao-rule',
    label: '淘宝规则中心',
    endpoint: 'https://rule.taobao.com/',
    vertical: 'official-rules',
    // 待人工维护摘要文档（见 rule-sources.ts 实测结论），默认不启用
    enabled: false,
  },
  {
    id: 'tmall-rule',
    adapter: 'tmall-rule',
    label: '天猫规则中心',
    endpoint: 'https://rule.tmall.com/',
    vertical: 'official-rules',
    enabled: false,
  },
  {
    id: 'xhs-rule',
    adapter: 'xhs-rule',
    label: '小红书规则公告',
    endpoint: 'https://www.xiaohongshu.com/protocols/about/terms',
    vertical: 'official-rules',
    enabled: false,
  },
];

/** 内置默认配置（电商化关注域 + 降噪规则 + 默认多源列表） */
export const DEFAULT_ATTENTION: AttentionConfig = {
  sourceBaseUrl: DEFAULT_SOURCE_BASE_URL,
  sources: DEFAULT_SOURCES,
  mustReadLimit: 3,
  browseLimit: 8,
  otherLimit: 12,
  minimumSources: 2,
  domains: [
    {
      id: 'category-trend',
      label: '品类趋势',
      keywords: ['品类', '趋势', '增长', '销量', '销售额', '市场份额', '增速', '消费趋势', '需求变化', '行业报告', '白皮书'],
      excludeKeywords: [],
      minKeywordHits: DEFAULT_MIN_KEYWORD_HITS,
      enabled: true,
    },
    {
      id: 'platform-rules',
      label: '平台规则',
      keywords: ['平台规则', '新规', '合规', '处罚', '违规', '抽检', '资质', '保证金', '佣金', '费率', '天猫', '淘宝', '京东', '拼多多', '抖音小店', '快手', '小红书', '视频号', '直播电商'],
      excludeKeywords: [],
      minKeywordHits: DEFAULT_MIN_KEYWORD_HITS,
      enabled: true,
    },
    {
      id: 'competitor',
      label: '竞品动态',
      keywords: ['竞品', '对手', '上新', '发布', '定价', '降价', '调价', '联名', '融资', '品牌动作', '出海'],
      // 降噪（hot-intel 4.4）：AI/科技圈新闻常用词排除，避免 Apple 发布会、DeepSeek 模型发布被判成竞品动态
      excludeKeywords: ['Apple', 'iPhone', '大模型', '模型发布', '开源模型'],
      minKeywordHits: DEFAULT_MIN_KEYWORD_HITS,
      enabled: true,
    },
    {
      id: 'promo',
      label: '促销节点',
      keywords: ['大促', '双11', '双十一', '618', '年货节', '38节', '99大促', '促销', '补贴', '优惠券', '满减', '预售', '秒杀'],
      // 降噪（hot-intel 4.4）：科技发布会/开发者大会非电商促销节点
      excludeKeywords: ['发布会', '开发者大会', '技术发布会'],
      minKeywordHits: DEFAULT_MIN_KEYWORD_HITS,
      enabled: true,
    },
    {
      id: 'content-marketing',
      label: '内容营销',
      keywords: ['种草', '达人', 'KOL', 'KOC', '短视频', '笔记', '流量', '转化率', '投放', '直播间', '带货', '素材'],
      excludeKeywords: [],
      minKeywordHits: DEFAULT_MIN_KEYWORD_HITS,
      enabled: true,
    },
  ],
};

/** 归一化限制值 */
function limitOf(v: unknown, fallback: number, max = 50): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

/**
 * 关注域扩展类型（report-driven-fixes 3.8「源管理」降级的兜底闸门）：
 * `applyToSourceIds` / `applyToSourceTiers` 为可选「源作用域」字段——关键词仅对指定源生效。
 * shared 类型不改（前端该区块已隐藏），后端在此透传并随配置持久化，数据不删。
 */
export interface AttentionDomainScoped extends AttentionDomain {
  /** 本域关键词仅对指定源 id 生效（缺省=全部源） */
  applyToSourceIds?: string[];
  /** 本域关键词仅对指定源层级（1/2/3）生效（缺省=全部层级） */
  applyToSourceTiers?: number[];
}

/**
 * 配置扩展（Q1 热点上屏修复）：展示配额字段。
 * shared 的 AttentionConfig 不改（避免与其他会话冲突），沿用 AttentionDomainScoped 同款本地扩展策略。
 */
export interface AttentionConfigQuota extends AttentionConfig {
  /**
   * 每个源的展示名额上限（Q1 配额策略）：
   * - >0：按源轮询取，每个源最多上屏 N 条——保证排在后面的源（如微博/抖音/头条热榜）也有保底名额；
   * - 0 / 缺省（向后兼容现有配置）：不限，全量上屏。
   */
  perSourceQuota?: number;
}

/** 归一化关注域：排除词/多词阈值缺省回退（排除词空、阈值默认 2）；非法阈值回退默认；源作用域字段透传 */
function normalizeDomain(raw: unknown, i: number): AttentionDomainScoped {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const keywords = (Array.isArray(d.keywords) ? d.keywords : []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const excludeKeywords = (Array.isArray(d.excludeKeywords) ? d.excludeKeywords : []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const minRaw = Number(d.minKeywordHits);
  const minKeywordHits = Number.isInteger(minRaw) && minRaw >= 1 && minRaw <= 20 ? minRaw : DEFAULT_MIN_KEYWORD_HITS;
  const strArray = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : undefined);
  const numArray = (v: unknown): number[] | undefined =>
    Array.isArray(v)
      ? v.map((x) => Number(x)).filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 3)
      : undefined;
  return {
    id: String(d.id ?? `domain-${i + 1}`),
    label: String(d.label ?? d.id ?? `关注域${i + 1}`),
    keywords,
    excludeKeywords,
    minKeywordHits,
    enabled: d.enabled !== false,
    applyToSourceIds: strArray(d.applyToSourceIds),
    applyToSourceTiers: numArray(d.applyToSourceTiers),
  };
}

/** 归一化源配置：tierCap 非法回退 undefined（由 vertical 判定兜底）；enabled 缺省 true */
function normalizeSource(raw: unknown): HotSourceConfig {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const tierCap: HotTier | undefined = s.tierCap === 'mustRead' || s.tierCap === 'browse' || s.tierCap === 'other' ? s.tierCap : undefined;
  return {
    id: String(s.id ?? '').trim(),
    adapter: String(s.adapter ?? s.id ?? '').trim(),
    label: String(s.label ?? s.id ?? '未命名源').trim(),
    endpoint: String(s.endpoint ?? '').trim(),
    vertical: String(s.vertical ?? '').trim(),
    enabled: s.enabled !== false,
    enterpriseCredentialRequired: s.enterpriseCredentialRequired === true,
    tierCap,
  };
}

/** 归一化 sources[]：缺省回退默认源列表；旧 sourceBaseUrl 映射为「仅启用 aihot」 */
function normalizeSources(raw: Partial<AttentionConfig>): HotSourceConfig[] {
  if (Array.isArray(raw.sources) && raw.sources.length > 0) {
    return raw.sources
      .filter((s): s is HotSourceConfig => Boolean(s) && typeof s === 'object')
      .map((s) => normalizeSource(s))
      .filter((s) => s.id && s.adapter);
  }
  // 旧单源配置：sourceBaseUrl 非空 → 仅启用 aihot（向后兼容，不报错）
  if (typeof raw.sourceBaseUrl === 'string' && raw.sourceBaseUrl.trim()) {
    return [{ ...normalizeSource({ id: 'aihot', adapter: 'aihot', label: 'AI HOT（行业聚合）', endpoint: raw.sourceBaseUrl.trim(), vertical: 'AI 行业聚合', tierCap: 'browse' }), enabled: true }];
  }
  return DEFAULT_SOURCES.map((s) => ({ ...s }));
}

/** 合并用户配置与默认配置（缺项回退默认） */
export function normalizeAttention(input: unknown): AttentionConfigQuota {
  const raw = input && typeof input === 'object' ? (input as Partial<AttentionConfig> & { perSourceQuota?: unknown }) : {};
  const domains: AttentionDomain[] = Array.isArray(raw.domains) && raw.domains.length > 0
    ? raw.domains
        .filter((d) => Boolean(d) && typeof d === 'object')
        .map((d, i) => normalizeDomain(d, i))
        .filter((d) => d.keywords.length > 0)
    : DEFAULT_ATTENTION.domains.map((d) => ({ ...d }));

  return {
    sourceBaseUrl: typeof raw.sourceBaseUrl === 'string' && raw.sourceBaseUrl.trim() ? raw.sourceBaseUrl.trim() : DEFAULT_SOURCE_BASE_URL,
    sources: normalizeSources(raw),
    domains,
    mustReadLimit: limitOf(raw.mustReadLimit, DEFAULT_ATTENTION.mustReadLimit!),
    browseLimit: limitOf(raw.browseLimit, DEFAULT_ATTENTION.browseLimit!),
    otherLimit: limitOf(raw.otherLimit, DEFAULT_ATTENTION.otherLimit!),
    minimumSources: limitOf(raw.minimumSources, DEFAULT_ATTENTION.minimumSources!, 20),
    // Q1：每源展示配额（0/缺省 = 不限，全量上屏；向后兼容现有配置）
    perSourceQuota: limitOf(raw.perSourceQuota, DEFAULT_PER_SOURCE_QUOTA, 100),
  };
}

/** 读取关注域配置（文件缺失或损坏时回退内置默认，不抛错） */
export function loadAttentionConfig(): AttentionConfigQuota {
  try {
    if (!existsSync(ATTENTION_CONFIG_PATH)) return normalizeAttention(DEFAULT_ATTENTION);
    const parsed = JSON.parse(readFileSync(ATTENTION_CONFIG_PATH, 'utf8')) as unknown;
    return normalizeAttention(parsed);
  } catch {
    return normalizeAttention(DEFAULT_ATTENTION);
  }
}

/** 保存关注域配置（本地文件，不入版本库） */
export function saveAttentionConfig(input: unknown): AttentionConfigQuota {
  const cfg = normalizeAttention(input);
  const configDir = dirname(ATTENTION_CONFIG_PATH);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(ATTENTION_CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return cfg;
}

/**
 * 命中该条热点的关注域（hot-intel D4 降噪）：
 * ① 任一排除词命中 → 该域直接不成立；
 * ② 否则数出命中的**不同**关键词数（同一关键词重复只计 1 次），≥ minKeywordHits（默认 2）才成立。
 * 关键词不区分大小写的子串匹配。
 */
export function matchDomains(haystack: string, cfg: AttentionConfig): { id: string; label: string }[] {
  const text = haystack.toLocaleLowerCase('zh-CN');
  return cfg.domains
    .filter((d) => d.enabled !== false)
    .filter((d) => {
      const excludes = (d.excludeKeywords ?? []).map((k) => k.toLocaleLowerCase('zh-CN'));
      if (excludes.some((k) => text.includes(k))) return false;
      const hitKeywords = new Set(d.keywords.filter((k) => text.includes(k.toLocaleLowerCase('zh-CN'))));
      const minHits = Number.isInteger(Number(d.minKeywordHits)) && Number(d.minKeywordHits) >= 1 ? Number(d.minKeywordHits) : DEFAULT_MIN_KEYWORD_HITS;
      return hitKeywords.size >= minHits;
    })
    .map((d) => ({ id: d.id, label: d.label }));
}

/** 待分层热点（数据源归一化后的形状；sourceId/vertical 由适配器归一化阶段填写） */
export interface RawHotItem {
  id: string;
  title: string;
  summary: string | null;
  /** 最新进展（无则前端隐藏该层） */
  latest?: string | null;
  /** 来源名称 */
  source: string;
  /** 产出该条目的源标识（无源信息 = 旧格式，不限制分层） */
  sourceId?: string;
  /** 源垂直类别 */
  vertical?: string;
  /** 独立信源数 */
  sourceCount: number;
  /** 原文链接 */
  url: string | null;
  /** 数据时间（ISO） */
  latestAt: string | null;
}

/** 垂直类别是否电商垂直（电商垂直源才允许进「必看」，hot-intel D4 规则③） */
export function isEcommerceVertical(vertical: string | undefined): boolean {
  return Boolean(vertical && /^ecommerce/i.test(vertical));
}

/**
 * 条目所属源的层级上限（tierCap）：
 * - 无 sourceId（旧格式/未标注源）→ null（不限制，等价旧逻辑）；
 * - 配置了 tierCap → 取配置值；
 * - 未配置 tierCap → 非电商垂直源默认 browse，电商垂直源不限制。
 */
export function sourceTierCapOf(item: RawHotItem, cfg: AttentionConfig): HotTier | null {
  if (!item.sourceId) return null;
  const s = cfg.sources?.find((x) => x.id === item.sourceId);
  if (s?.tierCap) return s.tierCap;
  const vertical = s?.vertical ?? item.vertical ?? '';
  return isEcommerceVertical(vertical) ? null : 'browse';
}

/** 分层装饰结果（含判定中间态；strip 后对外只暴露 HotItem） */
type DecoratedHot = HotItem & { hit: boolean; strong: boolean; browseable: boolean };

/** 去掉判定中间态（对外只暴露 HotItem） */
function stripDecorated(list: DecoratedHot[]): HotItem[] {
  return list.map(({ hit: _hit, strong: _strong, browseable: _b, ...rest }) => rest);
}

/**
 * 按源交错（round-robin）重排：第 1 轮每源取第 1 条，第 2 轮每源取第 2 条……
 *
 * Q1 根因修复：上游收集顺序 = 源注册顺序，若直接按原顺序截断，排在前面的源（电商派）
 * 会吃光全部名额，后面新增的热榜源（微博/抖音/头条）一条都上不了屏。
 * 交错后每个源在列表前部都有代表，截断也不会饿死任何源。
 *
 * @param perSource 每源最多取几条（Infinity = 不限）
 */
export function interleaveBySource<T extends { sourceId?: string }>(list: T[], perSource = Number.POSITIVE_INFINITY): T[] {
  if (list.length === 0) return [];
  const bySource = new Map<string, T[]>();
  for (const it of list) {
    const k = it.sourceId ?? '';
    const arr = bySource.get(k);
    if (arr) arr.push(it);
    else bySource.set(k, [it]);
  }
  const out: T[] = [];
  const taken = new Map<string, number>();
  let round = 0;
  // 每源上限有限时，总产出上限 = 源数 × 每源上限（提前终止的兜底，正常由 added=false 退出）
  while (out.length < list.length) {
    let added = false;
    for (const [k, arr] of bySource) {
      if (round >= arr.length) continue;
      const n = taken.get(k) ?? 0;
      if (n >= perSource) continue;
      out.push(arr[round]);
      taken.set(k, n + 1);
      added = true;
    }
    if (!added) break;
    round++;
  }
  return out;
}

/**
 * 从候选列表中按「源轮询」取至 limit 条（Q1：每个源都有保底名额）。
 * 候选数 ≤ limit 时原样返回（不打乱既有顺序，保持分层结果的稳定预期）。
 */
function takeBySourceRoundRobin(list: DecoratedHot[], limit: number): DecoratedHot[] {
  if (limit <= 0) return [];
  if (list.length <= limit) return list.slice();
  // 先按源交错（每源依次拿第 1 条、第 2 条…），再取前 limit 条 → 截断不会饿死任何源
  return interleaveBySource(list).slice(0, limit);
}

/** 分层判定（不含截断）：给每条打出 hit/strong/browseable 与面向用户的 reason */
function decorateHot(items: RawHotItem[], cfg: AttentionConfig): DecoratedHot[] {
  return items.map((it) => {
    const domains = matchDomains([it.title, it.summary ?? '', it.latest ?? '', it.source].filter(Boolean).join(' '), cfg);
    const hit = domains.length > 0;
    const cap = sourceTierCapOf(it, cfg);
    const strong = hit && it.sourceCount >= (cfg.minimumSources ?? 2) && (cap === null || cap === 'mustRead');
    const browseable = hit && (cap === null || cap === 'mustRead' || cap === 'browse');
    const reason = strong
      ? `${it.sourceCount} 个独立信源跟进，命中关注域「${domains[0].label}」`
      : browseable
        ? `命中关注域「${domains[0].label}」${cap === 'browse' ? '（源分层上限为浏览）' : ''}，信源较少，供浏览`
        : hit
          ? `命中关注域「${domains[0].label}」，源分层上限为「其他」`
          : '未命中关注域，归入其他';
    return { ...it, domains, reason, hit, strong, browseable };
  });
}

/**
 * 分层（坑2 + hot-intel D4 + Q1 配额修复）：
 * - mustRead：≥1 个域成立 + sourceCount ≥ minimumSources + 源 tierCap 允许 mustRead；
 * - browse：域成立 + 未被 mustRead 取走 + 源 tierCap 允许 browse；
 * - other：其余（含命中排除词、关键词数不足、tierCap 为 other 的条目）。
 *
 * Q1 修复：每层**按源轮询（round-robin）**取而非按上游收集顺序截断——
 * 旧实现里上游顺序 = 源注册顺序，电商派排第一就吃光 mustRead 3 / browse 8 / other 12 全部名额，
 * 后面的微博/抖音/头条热榜一条都上不了屏。现在先按源交错再截断，每个源都有保底名额。
 */
export function classifyHot(items: RawHotItem[], cfg: AttentionConfig): {
  mustRead: HotItem[];
  browse: HotItem[];
  other: HotItem[];
} {
  const decorated = decorateHot(items, cfg);

  const mustRead = takeBySourceRoundRobin(decorated.filter((d) => d.strong), cfg.mustReadLimit ?? 3);
  const usedIds = new Set(mustRead.map((d) => d.id));
  const browse = takeBySourceRoundRobin(
    decorated.filter((d) => !usedIds.has(d.id) && d.browseable),
    cfg.browseLimit ?? 8,
  );
  browse.forEach((d) => usedIds.add(d.id));
  const other = takeBySourceRoundRobin(
    decorated.filter((d) => !usedIds.has(d.id)),
    cfg.otherLimit ?? 12,
  );

  return { mustRead: stripDecorated(mustRead), browse: stripDecorated(browse), other: stripDecorated(other) };
}

/**
 * 展示集（Q1：报告建议展示集改为全量，不再用分层截断后的 13 条）。
 *
 * - perSourceQuota ≤ 0（默认，向后兼容现有配置）→ 全量上屏，仅按源交错重排（每源在前部都有代表）；
 * - perSourceQuota > 0 → 每源最多上屏 N 条（限流用）。
 *
 * 三分组（产出方向/可参考/无关）由前端按 AI 打标结果筛选，本身就是筛选，故此处不再丢弃条目。
 */
export function selectHotSet(items: RawHotItem[], cfg: AttentionConfigQuota): HotItem[] {
  const quota = Number((cfg as AttentionConfigQuota).perSourceQuota ?? DEFAULT_PER_SOURCE_QUOTA);
  const picked = interleaveBySource(decorateHot(items, cfg), quota > 0 ? quota : Number.POSITIVE_INFINITY);
  return stripDecorated(picked);
}

/** 判断热点条目应属层级（供前端/测试直接查询） */
export function tierOf(item: HotItem, tiers: { mustRead: HotItem[]; browse: HotItem[]; other: HotItem[] }): HotTier | null {
  if (tiers.mustRead.some((x) => x.id === item.id)) return 'mustRead';
  if (tiers.browse.some((x) => x.id === item.id)) return 'browse';
  if (tiers.other.some((x) => x.id === item.id)) return 'other';
  return null;
}
