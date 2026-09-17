/**
 * 头条热榜适配器（report-driven-fixes 3.3 / hot-trend-pivot 1.3）。
 * 端点：https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc（JSON）
 * 解析：data[].Title/HotValue/Url；latestAt=抓取时刻；无稳定 id，按标题哈希生成。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchJson, hashText } from './fetch.ts';

const ENDPOINT = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';

interface ToutiaoItem {
  Title?: string;
  HotValue?: number | string;
  Url?: string;
}

export const toutiaoHotAdapter: HotSourceAdapter = {
  id: 'toutiao-hot',
  label: '头条热榜',
  vertical: 'hot-trend',
  capabilities: ['品类趋势', '竞品动态', '内容营销'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const json = (await fetchJson(ENDPOINT, timeoutMs)) as { data?: ToutiaoItem[] };
    const now = new Date().toISOString();
    const items: RawSourceItem[] = [];
    for (const it of json?.data ?? []) {
      const title = compact(it?.Title);
      if (!title) continue;
      items.push({
        id: `toutiao-${hashText(title)}`,
        title,
        summary: null,
        latest: null,
        url: it?.Url ? String(it.Url) : null,
        sourceCount: 1,
        latestAt: now,
      });
    }
    return { items };
  },
};
