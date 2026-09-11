/**
 * aihot.virxact.com 适配器（hot-intel B10：原 hot.ts 单源逻辑下沉为默认适配器）。
 * AI 行业聚合源，保留为可选源（vertical=AI 行业聚合，tierCap 默认 browse，最高只进「浏览」）。
 * 两路拉取：hot-topics（多信源热点）+ items?mode=selected（24h 精选），再按 story id 补摘要。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchJson } from './fetch.ts';

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function asItems(payload: unknown): Record<string, unknown>[] {
  const items = (payload as { items?: unknown })?.items;
  return Array.isArray(items) ? (items.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];
}

/** 多源热点（含独立信源数）→ 统一形状 */
function normalizeHotTopics(items: Record<string, unknown>[], stories: Map<string, Record<string, unknown>>): RawSourceItem[] {
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
      latest: compact(story?.latest) || null,
      sourceCount: num(raw.sourceCount),
      url: compact(links.original) || compact(links.aihot) || null,
      latestAt: compact(raw.latestAt) || compact(story?.latestAt) || null,
    };
  });
}

/** 精选/日报条目 → 统一形状（单信源） */
function normalizeSelected(items: Record<string, unknown>[]): RawSourceItem[] {
  return items.map((raw) => {
    const links = (raw.links ?? {}) as Record<string, unknown>;
    return {
      id: compact(raw.id) || compact(links.aihot) || compact(raw.title) || `sel-${Math.random().toString(36).slice(2)}`,
      title: compact(raw.title) || '未命名动态',
      summary: compact(raw.summary) || null,
      latest: null,
      sourceCount: 1,
      url: compact(links.original) || compact(links.aihot) || null,
      latestAt: compact(raw.publishedAt) || compact(raw.discoveredAt) || null,
    };
  });
}

export const aihotAdapter: HotSourceAdapter = {
  id: 'aihot',
  label: 'AI HOT（行业聚合）',
  vertical: 'AI 行业聚合',
  capabilities: ['竞品动态', '品类趋势'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const baseUrl = 'https://aihot.virxact.com';
    const [topics, selected] = await Promise.all([
      fetchJson(`${baseUrl}/api/v1/hot-topics`, timeoutMs),
      fetchJson(`${baseUrl}/api/v1/items?mode=selected&window=24h&limit=20`, timeoutMs),
    ]);
    const storyItems = asItems(selected);
    const stories = new Map<string, Record<string, unknown>>();
    for (const s of storyItems) {
      const url = compact(s.url ?? (s.links as Record<string, unknown> | undefined)?.story ?? '');
      const id = url.split('/').filter(Boolean).pop() ?? '';
      if (id) stories.set(id, s);
    }
    // 仅把「非 story 索引」条目作为精选条目输出（story 条目只用于补摘要，避免重复计入）
    const dailyItems = storyItems.filter((s) => {
      const u = compact(s.url ?? (s.links as Record<string, unknown> | undefined)?.story ?? '');
      return !/\/stor(?:y|ies)\//.test(u);
    });
    const items = [...normalizeHotTopics(asItems(topics), stories), ...normalizeSelected(dailyItems)];
    // 去重（按 id 与标题），避免 topics 与 selected 重复
    const seenId = new Set<string>();
    const seenTitle = new Set<string>();
    const out: RawSourceItem[] = [];
    for (const it of items) {
      const k = it.id || it.title;
      const t = it.title.toLocaleLowerCase('zh-CN');
      if (seenId.has(k) || seenTitle.has(t)) continue;
      seenId.add(k);
      seenTitle.add(t);
      out.push(it);
    }
    return { items: out };
  },
};
