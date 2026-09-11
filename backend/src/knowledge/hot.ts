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
import { HOT_CACHE_TTL_MS, HOT_REQUEST_TIMEOUT_MS, classifyHot, loadAttentionConfig, type RawHotItem } from './attention.ts';
import { instantiateAdapters, type HotSourceFetchResult, type RawSourceItem } from './hot-sources/index.ts';
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

/** 去重（按 id 与标题，保留首个） */
function dedupe<T extends { id: string; title: string }>(items: T[]): T[] {
  const seenId = new Set<string>();
  const seenTitle = new Set<string>();
  return items.filter((it) => {
    const k = it.id || it.title;
    const t = it.title.toLocaleLowerCase('zh-CN');
    if (seenId.has(k) || seenTitle.has(t)) return false;
    seenId.add(k);
    seenTitle.add(t);
    return true;
  });
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
function unavailablePanel(sourceNames: string[], code: string, message: string): HotPanel {
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
  };
}

/**
 * 拉取热点面板（多源聚合 + 单源降级）。
 * @param force 忽略 TTL 强制刷新（手动刷新按钮）
 */
export async function loadHotPanel(force = false): Promise<HotPanel> {
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
        const panel = JSON.parse(cached.payload) as HotPanel;
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
        const panel = JSON.parse(cached.payload) as HotPanel;
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

  // 证据等级回填（classifyHot 输出 HotItem，附 evidence）
  const applyEvidence = (list: HotItem[]): HotItem[] =>
    list.map((it) => ({ ...it, evidence: evidenceOf({ sourceCount: it.sourceCount, url: it.url }), sourceName: it.source, latest: it.latest ?? null }));

  const mustRead = applyEvidence(tiers.mustRead);
  const browse = applyEvidence(tiers.browse);
  const other = applyEvidence(tiers.other);
  const allTiered = [...mustRead, ...browse, ...other];

  const panel: HotPanel = {
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
      selected24h: allTiered.filter((it) => isWithin24h(it.latestAt, now)).length,
    },
    tiers: { mustRead, browse, other },
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
