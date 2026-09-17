/**
 * 百度实时热点适配器（report-driven-fixes 3.3 / hot-trend-pivot 1.1）。
 * 端点：https://top.baidu.com/api/board?platform=wise&tab=realtime（JSON）
 * 解析：data.cards[].content[].word/desc/url；无稳定 id，按标题哈希生成；上限 30 条。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchJson, hashText } from './fetch.ts';

const ENDPOINT = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
const MAX_ITEMS = 30;

interface BaiduCard {
  content?: { word?: string; desc?: string; url?: string }[];
}

export const baiduHotAdapter: HotSourceAdapter = {
  id: 'baidu-hot',
  label: '百度实时热点',
  vertical: 'hot-trend',
  capabilities: ['品类趋势', '竞品动态', '内容营销'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const json = (await fetchJson(ENDPOINT, timeoutMs)) as { data?: { cards?: BaiduCard[] } };
    const now = new Date().toISOString();
    const items: RawSourceItem[] = [];
    for (const card of json?.data?.cards ?? []) {
      for (const c of card?.content ?? []) {
        const word = compact(c?.word);
        if (!word) continue;
        items.push({
          id: `baidu-${hashText(word)}`,
          title: word,
          summary: c?.desc ? compact(c.desc) : null,
          latest: null,
          url: c?.url ? String(c.url) : null,
          sourceCount: 1,
          latestAt: now,
        });
        if (items.length >= MAX_ITEMS) break;
      }
      if (items.length >= MAX_ITEMS) break;
    }
    return { items };
  },
};
