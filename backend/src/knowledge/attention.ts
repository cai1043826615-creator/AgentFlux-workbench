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
 * 内置默认源列表（hot-intel B10，按 docs/相关设计文件/热点多信息源调研.md 的 P0/P1 公开源）：
 * 本期只接公开源（无需凭据、无需企业资质）；需资质/合规高风险源不接，仅预留 enterpriseCredentialRequired 配置项。
 * 覆盖 平台规则 / 促销节点 / 品类趋势 / 竞品动态 中的 ≥2 类（电商垂直源 ×2 + 政府数据源 ×1 + AI 行业聚合可选 ×1）。
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
    id: 'stats-sjjd',
    adapter: 'stats-sjjd',
    label: '国家统计局数据解读',
    endpoint: 'https://www.stats.gov.cn/sj/sjjd/',
    vertical: 'gov-stats',
    enabled: true,
    tierCap: 'browse',
  },
  {
    id: 'aihot',
    adapter: 'aihot',
    label: 'AI HOT（行业聚合）',
    endpoint: DEFAULT_SOURCE_BASE_URL,
    vertical: 'AI 行业聚合',
    enabled: true,
    tierCap: 'browse',
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

/** 归一化关注域：排除词/多词阈值缺省回退（排除词空、阈值默认 2）；非法阈值回退默认 */
function normalizeDomain(raw: unknown, i: number): AttentionDomain {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const keywords = (Array.isArray(d.keywords) ? d.keywords : []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const excludeKeywords = (Array.isArray(d.excludeKeywords) ? d.excludeKeywords : []).map((k) => String(k ?? '').trim()).filter(Boolean);
  const minRaw = Number(d.minKeywordHits);
  const minKeywordHits = Number.isInteger(minRaw) && minRaw >= 1 && minRaw <= 20 ? minRaw : DEFAULT_MIN_KEYWORD_HITS;
  return {
    id: String(d.id ?? `domain-${i + 1}`),
    label: String(d.label ?? d.id ?? `关注域${i + 1}`),
    keywords,
    excludeKeywords,
    minKeywordHits,
    enabled: d.enabled !== false,
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
export function normalizeAttention(input: unknown): AttentionConfig {
  const raw = input && typeof input === 'object' ? (input as Partial<AttentionConfig>) : {};
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
  };
}

/** 读取关注域配置（文件缺失或损坏时回退内置默认，不抛错） */
export function loadAttentionConfig(): AttentionConfig {
  try {
    if (!existsSync(ATTENTION_CONFIG_PATH)) return normalizeAttention(DEFAULT_ATTENTION);
    const parsed = JSON.parse(readFileSync(ATTENTION_CONFIG_PATH, 'utf8')) as unknown;
    return normalizeAttention(parsed);
  } catch {
    return normalizeAttention(DEFAULT_ATTENTION);
  }
}

/** 保存关注域配置（本地文件，不入版本库） */
export function saveAttentionConfig(input: unknown): AttentionConfig {
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

/**
 * 分层（坑2 + hot-intel D4）：
 * - mustRead：≥1 个域成立 + sourceCount ≥ minimumSources + 源 tierCap 允许 mustRead；
 * - browse：域成立 + 未被 mustRead 取走 + 源 tierCap 允许 browse；
 * - other：其余（含命中排除词、关键词数不足、tierCap 为 other 的条目）。
 * 每层按限制数截断。
 */
export function classifyHot(items: RawHotItem[], cfg: AttentionConfig): {
  mustRead: HotItem[];
  browse: HotItem[];
  other: HotItem[];
} {
  const decorated: (HotItem & { hit: boolean; strong: boolean; browseable: boolean })[] = items.map((it) => {
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

  const mustRead = decorated.filter((d) => d.strong).slice(0, cfg.mustReadLimit ?? 3);
  const usedIds = new Set(mustRead.map((d) => d.id));
  const browse = decorated.filter((d) => !usedIds.has(d.id) && d.browseable).slice(0, cfg.browseLimit ?? 8);
  browse.forEach((d) => usedIds.add(d.id));
  const other = decorated.filter((d) => !usedIds.has(d.id)).slice(0, cfg.otherLimit ?? 12);

  const strip = (list: (HotItem & { hit: boolean; strong: boolean; browseable: boolean })[]): HotItem[] =>
    list.map(({ hit: _hit, strong: _strong, browseable: _b, ...rest }) => rest);

  return { mustRead: strip(mustRead), browse: strip(browse), other: strip(other) };
}

/** 判断热点条目应属层级（供前端/测试直接查询） */
export function tierOf(item: HotItem, tiers: { mustRead: HotItem[]; browse: HotItem[]; other: HotItem[] }): HotTier | null {
  if (tiers.mustRead.some((x) => x.id === item.id)) return 'mustRead';
  if (tiers.browse.some((x) => x.id === item.id)) return 'browse';
  if (tiers.other.some((x) => x.id === item.id)) return 'other';
  return null;
}
