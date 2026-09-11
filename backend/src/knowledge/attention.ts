/**
 * 电商化关注域配置（design.md D5，坑2）：
 * 默认关注域面向电商/品类/平台场景（品类趋势、平台规则、竞品动态、促销节点、内容营销），
 * 而非 person_dashboard 默认的 AI 行业关注域。
 *
 * 配置文件：backend/config/attention.json（本地保存，不入版本库）
 * 缺失时使用内置默认；写入后下次拉取即生效。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttentionConfig, AttentionDomain, HotItem, HotTier } from '@workbench/shared';

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

/** 内置默认配置（电商化关注域） */
export const DEFAULT_ATTENTION: AttentionConfig = {
  sourceBaseUrl: DEFAULT_SOURCE_BASE_URL,
  mustReadLimit: 3,
  browseLimit: 8,
  otherLimit: 12,
  minimumSources: 2,
  domains: [
    {
      id: 'category-trend',
      label: '品类趋势',
      keywords: ['品类', '趋势', '增长', '销量', '销售额', '市场份额', '增速', '消费趋势', '需求变化', '行业报告', '白皮书'],
      enabled: true,
    },
    {
      id: 'platform-rules',
      label: '平台规则',
      keywords: ['平台规则', '新规', '合规', '处罚', '违规', '抽检', '资质', '保证金', '佣金', '费率', '天猫', '淘宝', '京东', '拼多多', '抖音小店', '快手', '小红书', '视频号', '直播电商'],
      enabled: true,
    },
    {
      id: 'competitor',
      label: '竞品动态',
      keywords: ['竞品', '对手', '上新', '发布', '定价', '降价', '调价', '联名', '融资', '品牌动作', '出海'],
      enabled: true,
    },
    {
      id: 'promo',
      label: '促销节点',
      keywords: ['大促', '双11', '双十一', '618', '年货节', '38节', '99大促', '促销', '补贴', '优惠券', '满减', '预售', '秒杀'],
      enabled: true,
    },
    {
      id: 'content-marketing',
      label: '内容营销',
      keywords: ['种草', '达人', 'KOL', 'KOC', '短视频', '笔记', '流量', '转化率', '投放', '直播间', '带货', '素材'],
      enabled: true,
    },
  ],
};

/** 归一化限制值 */
function limitOf(v: unknown, fallback: number, max = 50): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
}

/** 合并用户配置与默认配置（缺项回退默认） */
export function normalizeAttention(input: unknown): AttentionConfig {
  const raw = input && typeof input === 'object' ? (input as Partial<AttentionConfig>) : {};
  const domains: AttentionDomain[] = Array.isArray(raw.domains) && raw.domains.length > 0
    ? raw.domains
        .filter((d): d is AttentionDomain => Boolean(d) && typeof d === 'object')
        .map((d, i) => ({
          id: String(d.id ?? `domain-${i + 1}`),
          label: String(d.label ?? d.id ?? `关注域${i + 1}`),
          keywords: (Array.isArray(d.keywords) ? d.keywords : []).map((k) => String(k ?? '').trim()).filter(Boolean),
          enabled: d.enabled !== false,
        }))
        .filter((d) => d.keywords.length > 0)
    : DEFAULT_ATTENTION.domains;

  return {
    sourceBaseUrl: typeof raw.sourceBaseUrl === 'string' && raw.sourceBaseUrl.trim() ? raw.sourceBaseUrl.trim() : DEFAULT_SOURCE_BASE_URL,
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

/** 命中该条热点的关注域（关键词不区分大小写的子串匹配） */
export function matchDomains(haystack: string, cfg: AttentionConfig): { id: string; label: string }[] {
  const text = haystack.toLocaleLowerCase('zh-CN');
  return cfg.domains
    .filter((d) => d.enabled !== false)
    .filter((d) => d.keywords.some((k) => text.includes(k.toLocaleLowerCase('zh-CN'))))
    .map((d) => ({ id: d.id, label: d.label }));
}

/** 待分层热点（数据源归一化后的形状） */
export interface RawHotItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  sourceCount: number;
  url: string | null;
  latestAt: string | null;
}

/**
 * 分层（坑2）：命中关注域且信源数达标 → 必看；未命中必看但命中关注域 → 浏览；其余 → 其他。
 * 每层按限制数截断。
 */
export function classifyHot(items: RawHotItem[], cfg: AttentionConfig): {
  mustRead: HotItem[];
  browse: HotItem[];
  other: HotItem[];
} {
  const decorated: (HotItem & { hit: boolean; strong: boolean })[] = items.map((it) => {
    const domains = matchDomains([it.title, it.summary ?? '', it.source].filter(Boolean).join(' '), cfg);
    const hit = domains.length > 0;
    const strong = hit && it.sourceCount >= (cfg.minimumSources ?? 2);
    const reason = strong
      ? `${it.sourceCount} 个独立信源跟进，命中关注域「${domains[0].label}」`
      : hit
        ? `命中关注域「${domains[0].label}」，信源较少，供浏览`
        : '未命中关注域，归入其他';
    return { ...it, domains, reason, hit, strong };
  });

  const mustRead = decorated.filter((d) => d.strong).slice(0, cfg.mustReadLimit ?? 3);
  const usedIds = new Set(mustRead.map((d) => d.id));
  const browse = decorated.filter((d) => !usedIds.has(d.id) && d.hit).slice(0, cfg.browseLimit ?? 8);
  browse.forEach((d) => usedIds.add(d.id));
  const other = decorated.filter((d) => !usedIds.has(d.id)).slice(0, cfg.otherLimit ?? 12);

  const strip = (list: (HotItem & { hit: boolean; strong: boolean })[]): HotItem[] =>
    list.map(({ hit: _hit, strong: _strong, ...rest }) => rest);

  return { mustRead: strip(mustRead), browse: strip(browse), other: strip(other) };
}

/** 判断热点条目应属层级（供前端/测试直接查询） */
export function tierOf(item: HotItem, tiers: { mustRead: HotItem[]; browse: HotItem[]; other: HotItem[] }): HotTier | null {
  if (tiers.mustRead.some((x) => x.id === item.id)) return 'mustRead';
  if (tiers.browse.some((x) => x.id === item.id)) return 'browse';
  if (tiers.other.some((x) => x.id === item.id)) return 'other';
  return null;
}
