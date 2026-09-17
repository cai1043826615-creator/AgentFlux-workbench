/**
 * 每日热点聚合（hot-intel B10 / D3 / D7 / D8）：
 * - 多源：遍历适配器注册表（cfg.sources），每源独立 Promise.allSettled，单源失败只降级该源；
 * - 缓存：knowledge_hot_cache 表，key 带「启用源集合指纹」版本号（D8），15 分钟 TTL；
 * - 降级：全部源失败 → stale（有缓存）/ unavailable（无缓存）；面板逐源标注状态（3.8）；
 * - 证据等级：≥2 信源 multi-source / 1 信源有外链 traceable / 否则 single-source（3.7）；
 * - 分层：按电商化关注域配置归入「必看 / 浏览 / 其他」（attention.ts，含降噪三规则）。
 */
import type { HotEvidenceLevel, HotItem, HotPanel, HotSourceStatus } from '@workbench/shared';
import { get, run } from '../db/client.ts';
import {
  HOT_CACHE_TTL_MS,
  HOT_REQUEST_TIMEOUT_MS,
  classifyHot,
  loadAttentionConfig,
  selectHotSet,
  type AttentionConfigQuota,
  type RawHotItem,
} from './attention.ts';
import { instantiateAdapters, type HotSourceFetchResult, type RawSourceItem } from './hot-sources/index.ts';
import { tagHotItems, type AiTagResult } from './hot-tagging.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';

/** 缓存 key 版本（D8：源集合变化 → 指纹变化 → 旧缓存作废重取） */
const CACHE_VERSION = 'v2';

interface CacheRow {
  payload: string;
  fetched_at: string;
  expires_at: string;
}

/** 简单哈希（FNV-1a 32 位，零依赖；仅用于缓存指纹，非安全用途） */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** 启用源集合指纹（D8：新增/更换源 → 指纹变化 → 旧缓存作废） */
function cacheFingerprint(cfg: ReturnType<typeof loadAttentionConfig>): string {
  const parts = (cfg.sources ?? [])
    .filter((s) => s.enabled !== false)
    .map((s) => `${s.id}:${s.endpoint}`)
    .sort();
  return hash(parts.join('|'));
}

function cacheKey(cfg: ReturnType<typeof loadAttentionConfig>): string {
  return `daily-hot:${CACHE_VERSION}:${cacheFingerprint(cfg)}`;
}

/* ===== 三层去重（3.6，docs/设计/05 §5.3）===== */

/** L1 URL 规范化：去 #fragment、去跟踪参数（utm_ 系列 / from / spm / source）、小写 host、去末尾 / */
function normalizeUrl(url: string | null): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      const lk = k.toLowerCase();
      if (lk.startsWith('utm_') || lk === 'from' || lk === 'spm' || lk === 'source') u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    const p = u.pathname.replace(/\/+$/, '');
    u.pathname = p || '/';
    return u.href;
  } catch {
    return url.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

/** L2 标题归一：去空白、全角转半角、去中英文标点、去「独家｜重磅」等前缀 */
function normalizeTitle(title: string): string {
  let s = String(title ?? '').toLowerCase();
  s = s.replace(/[\u3000\s]+/g, '');
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.replace(/[，。！？；：、（）《》〈〉【】「」『』"'`.,!?;:()\[\]{}<>_\-—–·•|]/g, '');
  s = s.replace(/^(独家|重磅|突发|快讯|最新|官方|刚刚|热评|速报|首发|紧急|热搜)[|｜:：\s]*/, '');
  return s;
}

/** 3-gram 字符集合（短串退化为整串） */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length <= 3) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Jaccard 相似度 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 三层去重（3.6）：
 * 1) URL 规范化精确去重；2) 标题归一后精确去重；3) 归一标题 3-gram Jaccard ≥ 0.8 视为同一事件，
 * 合并为一条并累加 sourceCount（sources[] 结构为远期演进，暂以 sourceCount 近似多源证据）。
 */
function dedupe<T extends { id: string; title: string; url: string | null; sourceCount: number }>(items: T[]): T[] {
  const out: T[] = [];
  const norms: string[] = [];
  const seenUrl = new Set<string>();
  const seenNorm = new Set<string>();
  for (const it of items) {
    const nu = normalizeUrl(it.url);
    if (nu && seenUrl.has(nu)) continue;
    const nt = normalizeTitle(it.title);
    if (nt && seenNorm.has(nt)) continue;
    let merged = false;
    for (let i = 0; i < out.length; i++) {
      if (jaccard(trigrams(nt), trigrams(norms[i])) >= 0.8) {
        out[i] = { ...out[i], sourceCount: (out[i].sourceCount ?? 1) + (it.sourceCount ?? 1) };
        merged = true;
        break;
      }
    }
    if (merged) continue;
    out.push(it);
    if (nu) seenUrl.add(nu);
    if (nt) seenNorm.add(nt);
    norms.push(nt);
  }
  return out;
}

/** 证据等级判定（3.7）：≥2 独立信源 multi-source；1 信源且有原文外链 traceable；否则 single-source */
export function evidenceOf(item: Pick<RawSourceItem, 'sourceCount' | 'url'>): HotEvidenceLevel {
  if (item.sourceCount >= 2) return 'multi-source';
  if (item.url) return 'traceable';
  return 'single-source';
}

/** 该源条目数是否在最近 24 小时内（无时间字段不计入） */
function isWithin24h(latestAt: string | null, now: number): boolean {
  if (!latestAt) return false;
  const t = Date.parse(latestAt);
  if (!Number.isFinite(t)) return false;
  return now - t <= 24 * 60 * 60 * 1000;
}

/** 读取缓存行 */
function readCache(key: string): CacheRow | undefined {
  ensureKnowledgeSchema();
  return get<CacheRow>(`SELECT payload, fetched_at, expires_at FROM ${KT.hotCache} WHERE cache_key = ?`, [key]);
}

/** 写入缓存 */
function writeCache(key: string, panel: HotPanel, ttlMs: number): void {
  const now = Date.now();
  run(
    `INSERT INTO ${KT.hotCache} (cache_key,payload,fetched_at,expires_at) VALUES (?,?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, JSON.stringify(panel), new Date(now).toISOString(), new Date(now + ttlMs).toISOString()],
  );
}

/** 无缓存且源全部不可用时的面板（板块 B 显示明确提示，不抛错） */
function unavailablePanel(sourceNames: string[], code: string, message: string): HotPanelWithTags {
  return {
    status: 'unavailable',
    fetchedAt: null,
    expiresAt: null,
    sourceName: '多源热点',
    sourceUrl: '',
    sources: sourceNames.map((label) => ({ id: label, label, status: 'degraded' as const, error: '拉取失败' })),
    daily: null,
    error: { code, message },
    counts: { upstream: 0, mustRead: 0, browse: 0, other: 0, selected24h: 0 },
    tiers: { mustRead: [], browse: [], other: [] },
    aiTags: {},
    aiTagged: false,
    aiDegraded: true,
    displaySet: [],
    hiddenCount: 0,
    rawCount: 0,
    sourceCounts: {},
  };
}

/**
 * AI 批量打标结果随面板一起返回/缓存（3.4）：
 * - aiTags：条目 id → {cls, tag, use}；LLM 失败为空对象；
 * - aiTagged：本次是否成功打标（false = 全批降级「可参考」）；
 * - aiDegraded：LLM 通道降级标记（前端据此显示「AI 识别暂不可用」）。
 *
 * Q1 扩展：
 * - displaySet：全量展示集（报告 P1 缺陷 Q1：旧实现展示的是分层截断后的 13 条，
 *   热榜源一条都上不了屏）。前端三分组（产出方向/可参考/无关）以本集合为数据源；
 * - hiddenCount：未展示条数（上游原始条目数 - 展示数，主要来自三层去重合并），用于 Q5 提示；
 * - sourceCounts：各源贡献的展示条数（实测核对「热榜源是否上屏」用）。
 */
export interface HotPanelWithTags extends HotPanel {
  aiTags: Record<string, AiTagResult>;
  aiTagged: boolean;
  aiDegraded: boolean;
  /** 展示集（全量上屏；前端三分组以此为数据源） */
  displaySet: HotItem[];
  /** 未展示条数（上游原始条目数 - 展示数，主要来自去重合并） */
  hiddenCount: number;
  /** 上游原始条目数（去重前） */
  rawCount: number;
  /** 各源贡献的展示条数（sourceId → 条数） */
  sourceCounts: Record<string, number>;
}

/**
 * 拉取热点面板（多源聚合 + 单源降级 + 三层去重 + AI 批量打标）。
 * @param force 忽略 TTL 强制刷新（手动刷新按钮）
 */
export async function loadHotPanel(force = false): Promise<HotPanelWithTags> {
  ensureKnowledgeSchema();
  const cfg = loadAttentionConfig();
  const key = cacheKey(cfg);
  const adapters = instantiateAdapters(cfg.sources ?? []);
  const adapterLabels = adapters.map((a) => a.label);

  const cached = readCache(key);
  if (!force && cached) {
    const expiresAt = Date.parse(cached.expires_at);
    if (Number.isFinite(expiresAt) && Date.now() < expiresAt) {
      try {
        // 命中缓存：AI 打标结果随 payload 复用（第二次 GET /api/hot 不触发 LLM）
        const panel = JSON.parse(cached.payload) as HotPanelWithTags;
        return { ...panel, status: 'live' };
      } catch {
        /* 缓存损坏 → 继续走实时拉取 */
      }
    }
  }

  // 每源独立拉取（allSettled 隔离：单源失败不影响其他源）
  const results = await Promise.allSettled(adapters.map((a) => a.fetchAll(HOT_REQUEST_TIMEOUT_MS)));

  const sourceStatus: HotSourceStatus[] = [];
  /** 收集的条目（已注入来源元数据） */
  const rawItems: (RawSourceItem & { sourceId: string; sourceName: string; vertical: string })[] = [];
  let daily = null as HotPanel['daily'];
  let anyOk = false;

  adapters.forEach((adapter, i) => {
    const r = results[i];
    if (r.status === 'rejected') {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      sourceStatus.push({ id: adapter.id, label: adapter.label, status: 'degraded', error: message });
      return;
    }
    const result = r.value as HotSourceFetchResult;
    anyOk = true;
    sourceStatus.push({ id: adapter.id, label: adapter.label, status: 'ok', itemCount: result.items.length });
    // 保留首个提供的日报信息（信息条外链）
    if (!daily && result.daily) daily = result.daily;
    // 收集时注入来源元数据（dedupe 后无法再溯源，故在此补齐）
    for (const it of result.items) {
      rawItems.push({ ...it, sourceId: adapter.id, sourceName: adapter.label, vertical: adapter.vertical });
    }
  });

  // 全部源失败 → 面板级降级
  if (!anyOk) {
    const messages = sourceStatus.map((s) => `${s.label}: ${s.error}`).join('；') || '全部热点源拉取失败';
    if (cached) {
      try {
        const panel = JSON.parse(cached.payload) as HotPanelWithTags;
        return { ...panel, status: 'stale', error: { code: 'HOT_UNAVAILABLE', message: messages } };
      } catch {
        /* 缓存损坏 */
      }
    }
    return unavailablePanel(adapterLabels, 'HOT_UNAVAILABLE', `热点源不可用：${messages}`);
  }

  // 全局去重 + 补来源/证据等级 → 统一 RawHotItem（来源元数据已在收集时注入）
  const deduped = dedupe(rawItems);
  const unified: RawHotItem[] = deduped.map((it) => ({
    id: it.id,
    title: it.title,
    summary: it.summary,
    latest: it.latest ?? null,
    source: it.sourceName ?? it.sourceId ?? '未知来源',
    sourceId: it.sourceId,
    vertical: it.vertical ?? '',
    sourceCount: it.sourceCount,
    url: it.url,
    latestAt: it.latestAt,
  }));

  const tiers = classifyHot(unified, cfg);
  const now = Date.now();
  // Q1：展示集 = 全量去重条目（按源交错重排，每源在前部都有代表），不再是分层截断后的 13 条。
  // 三分组（产出方向/可参考/无关）本身就是筛选，不需要在后端先丢弃条目。
  const displaySet = selectHotSet(unified, cfg as AttentionConfigQuota);

  // 3.4：去重后 LLM 批量打标（失败 → null → 全批降级「可参考」；结果随缓存 TTL 复用）。
  // Q1：展示集可达 200 条，tagHotItems 内部按批（每批 25 条）循环调用并合并结果——
  // 一次喂 208 条会因输出超长被截断导致全批静默降级（历史教训），故必须分批。
  const tagMap = await tagHotItems(displaySet.map((i) => ({ id: i.id, title: i.title })));
  const aiTags: Record<string, AiTagResult> = tagMap ? Object.fromEntries(tagMap) : {};

  // 证据等级回填（classifyHot 输出 HotItem，附 evidence）
  const applyEvidence = <T extends HotItem>(list: T[]): HotItem[] =>
    list.map((it) => ({ ...it, evidence: evidenceOf({ sourceCount: it.sourceCount, url: it.url }), sourceName: it.sourceName ?? it.source, latest: it.latest ?? null }));

  const mustRead = applyEvidence(tiers.mustRead);
  const browse = applyEvidence(tiers.browse);
  const other = applyEvidence(tiers.other);
  const shown = applyEvidence(displaySet);

  // Q5：未展示条数 = 上游原始条目（去重前）- 展示数（避免「看不到=没有」的误判）
  const rawCount = rawItems.length;
  const hiddenCount = Math.max(0, rawCount - shown.length);
  // 各源展示条数分布（实测核对热榜源是否上屏）
  const sourceCounts: Record<string, number> = {};
  for (const it of shown) {
    const k = it.sourceId || 'unknown';
    sourceCounts[k] = (sourceCounts[k] ?? 0) + 1;
  }

  const panel: HotPanelWithTags = {
    status: 'live',
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + HOT_CACHE_TTL_MS).toISOString(),
    sourceName: `多源热点（${sourceStatus.filter((s) => s.status === 'ok').length}/${sourceStatus.length} 源可用）`,
    sourceUrl: '',
    sources: sourceStatus,
    daily,
    error: null,
    counts: {
      upstream: unified.length,
      mustRead: mustRead.length,
      browse: browse.length,
      other: other.length,
      selected24h: shown.filter((it) => isWithin24h(it.latestAt, now)).length,
    },
    tiers: { mustRead, browse, other },
    aiTags,
    aiTagged: tagMap !== null,
    aiDegraded: tagMap === null,
    displaySet: shown,
    hiddenCount,
    rawCount,
    sourceCounts,
  };
  writeCache(key, panel, HOT_CACHE_TTL_MS);
  return panel;
}

/** 仅供测试/调试：清空本 change 版本号下的全部热点缓存 */
export function clearHotCache(): void {
  ensureKnowledgeSchema();
  run(`DELETE FROM ${KT.hotCache} WHERE cache_key LIKE ?`, [`daily-hot:${CACHE_VERSION}:%`]);
}

export type { HotItem };
