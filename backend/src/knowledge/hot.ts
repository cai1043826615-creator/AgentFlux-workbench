/**
 * 每日热点（design.md D5，坑2）：
 * - 数据源：公共匿名热点 API（默认 aihot.virxact.com，零鉴权；实现期已确认可达）
 * - 缓存：knowledge_hot_cache 表，15 分钟 TTL，避免重复请求
 * - 降级：请求失败/超时 → 返回缓存并标注 stale；无缓存 → unavailable（板块 A 与知识库其他功能不受影响）
 * - 分层：按电商化关注域配置归入「必看 / 浏览 / 其他」
 */
import type { HotItem, HotPanel } from '@workbench/shared';
import { get, run } from '../db/client.ts';
import {
  HOT_CACHE_TTL_MS,
  HOT_REQUEST_TIMEOUT_MS,
  classifyHot,
  loadAttentionConfig,
  type RawHotItem,
} from './attention.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';

const CACHE_KEY = 'daily-hot';

interface CacheRow {
  payload: string;
  fetched_at: string;
  expires_at: string;
}

function compact(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 带超时的 JSON 请求（公共匿名 API，无鉴权） */
async function fetchJson(baseUrl: string, path: string, timeoutMs = HOT_REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`热点源 ${path} 返回 HTTP ${res.status}`) as Error & { code?: string };
      err.code = 'HOT_UPSTREAM_ERROR';
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function asItems(payload: unknown): Record<string, unknown>[] {
  const items = (payload as { items?: unknown })?.items;
  return Array.isArray(items) ? (items.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
}

/** 多源热点（含独立信源数）→ 统一形状 */
function normalizeHotTopics(items: Record<string, unknown>[], stories: Map<string, Record<string, unknown>>): RawHotItem[] {
  return items.map((raw) => {
    const links = (raw.links ?? {}) as Record<string, unknown>;
    const storyUrl = compact(links.story);
    const storyId = storyUrl.split('/').filter(Boolean).pop() ?? '';
    const story = stories.get(storyId);
    const source = (raw.source ?? {}) as Record<string, unknown>;
    return {
      id: compact(raw.id) || storyId || compact(raw.title) || `hot-${Math.random().toString(36).slice(2)}`,
      title: compact(raw.title) || compact(story?.title) || '未命名热点',
      summary: compact(story?.digest) || compact(story?.latest) || null,
      source: compact(source.name) || '未知来源',
      sourceCount: num(raw.sourceCount),
      url: compact(links.original) || compact(links.aihot) || null,
      latestAt: compact(raw.latestAt) || compact(story?.latestAt) || null,
    };
  });
}

/** 精选/日报条目 → 统一形状（单信源） */
function normalizeSelected(items: Record<string, unknown>[]): RawHotItem[] {
  return items.map((raw) => {
    const links = (raw.links ?? {}) as Record<string, unknown>;
    const source = (raw.source ?? {}) as Record<string, unknown>;
    return {
      id: compact(raw.id) || compact(links.aihot) || compact(raw.title) || `sel-${Math.random().toString(36).slice(2)}`,
      title: compact(raw.title) || '未命名动态',
      summary: compact(raw.summary) || null,
      source: compact(source.name) || '未知来源',
      sourceCount: 1,
      url: compact(links.original) || compact(links.aihot) || null,
      latestAt: compact(raw.publishedAt) || compact(raw.discoveredAt) || null,
    };
  });
}

/** 去重（按 id 与标题） */
function dedupe(items: RawHotItem[]): RawHotItem[] {
  const seenId = new Set<string>();
  const seenTitle = new Set<string>();
  return items.filter((it) => {
    if (seenId.has(it.id) || seenTitle.has(it.title)) return false;
    seenId.add(it.id);
    seenTitle.add(it.title);
    return true;
  });
}

/** 读取缓存行 */
function readCache(): CacheRow | undefined {
  ensureKnowledgeSchema();
  return get<CacheRow>(`SELECT payload, fetched_at, expires_at FROM ${KT.hotCache} WHERE cache_key = ?`, [CACHE_KEY]);
}

/** 写入缓存 */
function writeCache(panel: HotPanel, ttlMs: number): void {
  const now = Date.now();
  run(
    `INSERT INTO ${KT.hotCache} (cache_key,payload,fetched_at,expires_at) VALUES (?,?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [CACHE_KEY, JSON.stringify(panel), new Date(now).toISOString(), new Date(now + ttlMs).toISOString()],
  );
}

/** 无缓存且源不可用时的面板（板块 B 显示明确提示，不抛错） */
function unavailablePanel(baseUrl: string, code: string, message: string): HotPanel {
  return {
    status: 'unavailable',
    fetchedAt: null,
    expiresAt: null,
    sourceName: '公共热点 API',
    sourceUrl: baseUrl,
    error: { code, message },
    counts: { upstream: 0, mustRead: 0, browse: 0, other: 0 },
    tiers: { mustRead: [], browse: [], other: [] },
  };
}

/**
 * 拉取热点面板。
 * @param force 忽略 TTL 强制刷新（手动刷新按钮）
 */
export async function loadHotPanel(force = false): Promise<HotPanel> {
  ensureKnowledgeSchema();
  const cfg = loadAttentionConfig();
  const baseUrl = cfg.sourceBaseUrl ?? '';

  const cached = readCache();
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

  try {
    const [hotRaw, selectedRaw] = await Promise.all([
      fetchJson(baseUrl, '/api/v1/hot-topics'),
      fetchJson(baseUrl, '/api/v1/items?mode=selected&window=24h&limit=20'),
    ]);

    // 逐条补充分源摘要（story.digest）；单条失败不影响整体
    const hotItems = asItems(hotRaw).slice(0, 10);
    const storyIds = hotItems
      .map((raw) => compact(((raw.links ?? {}) as Record<string, unknown>).story).split('/').filter(Boolean).pop())
      .filter((x): x is string => Boolean(x));
    const storyResults = await Promise.allSettled(storyIds.map((id) => fetchJson(baseUrl, `/api/v1/stories/${encodeURIComponent(id)}`)));
    const stories = new Map<string, Record<string, unknown>>();
    storyResults.forEach((r, i) => {
      const storyId = storyIds[i];
      if (!storyId || r.status !== 'fulfilled' || !r.value || typeof r.value !== 'object') return;
      stories.set(storyId, ((r.value as { story?: unknown }).story ?? r.value) as Record<string, unknown>);
    });

    const raw = dedupe([...normalizeHotTopics(hotItems, stories), ...normalizeSelected(asItems(selectedRaw))]);
    const tiers = classifyHot(raw, cfg);
    const now = Date.now();
    const panel: HotPanel = {
      status: 'live',
      fetchedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + HOT_CACHE_TTL_MS).toISOString(),
      sourceName: '公共热点 API（AI HOT）',
      sourceUrl: baseUrl,
      error: null,
      counts: {
        upstream: raw.length,
        mustRead: tiers.mustRead.length,
        browse: tiers.browse.length,
        other: tiers.other.length,
      },
      tiers,
    };
    writeCache(panel, HOT_CACHE_TTL_MS);
    return panel;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code ?? 'HOT_UNAVAILABLE';
    // 降级：有缓存则用缓存并标注 stale
    if (cached) {
      try {
        const panel = JSON.parse(cached.payload) as HotPanel;
        return { ...panel, status: 'stale', error: { code, message } };
      } catch {
        /* 缓存损坏 */
      }
    }
    return unavailablePanel(baseUrl, code, `热点源不可用：${message}`);
  }
}

/** 仅供测试/调试：清空热点缓存 */
export function clearHotCache(): void {
  ensureKnowledgeSchema();
  run(`DELETE FROM ${KT.hotCache} WHERE cache_key = ?`, [CACHE_KEY]);
}

export type { HotItem };
