/**
 * 60s API 微博 / 抖音热榜适配器（report-driven-fixes 3.3 / hot-trend-pivot 1.2）。
 * 端点：https://60s.viki.moe/v2/weibo、/v2/douyin（JSON）
 * 解析：data[].title/hot/url；latestAt=抓取时刻；无稳定 id，按标题哈希生成。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchJson, hashText } from './fetch.ts';

const BASE = 'https://60s.viki.moe/v2';

interface SixtySecondItem {
  title?: string;
  hot?: number | string;
  url?: string;
}

function make60sAdapter(channel: 'weibo' | 'douyin', id: string, label: string): HotSourceAdapter {
  return {
    id,
    label,
    vertical: 'hot-trend',
    capabilities: ['品类趋势', '内容营销'],
    async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
      const json = (await fetchJson(`${BASE}/${channel}`, timeoutMs)) as { data?: SixtySecondItem[] };
      const now = new Date().toISOString();
      const items: RawSourceItem[] = [];
      for (const it of json?.data ?? []) {
        const title = compact(it?.title);
        if (!title) continue;
        items.push({
          id: `${channel}-${hashText(title)}`,
          title,
          summary: null,
          latest: null,
          url: it?.url ? String(it.url) : null,
          sourceCount: 1,
          latestAt: now,
        });
      }
      return { items };
    },
  };
}

export const weibo60sAdapter = make60sAdapter('weibo', '60s-weibo', '微博热搜(60s)');
export const douyin60sAdapter = make60sAdapter('douyin', '60s-douyin', '抖音热榜(60s)');
