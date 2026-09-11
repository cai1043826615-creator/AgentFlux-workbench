/**
 * 国家统计局「数据解读」适配器（hot-intel B10；调研报告 P0，本机实测 200 / 833ms，官方权威，HTML 结构化列表）。
 * 端点：https://www.stats.gov.cn/sj/sjjd/（数据解读列表；宏观消费数据 CPI/PPI/社零/PMI 唯一可信来源）
 *
 * 解析（实测 2026-09-11）：<a href="./202609/t20260909_1965261.html">标题</a>，相对链接需按当前路径解析；
 * 同一链接在列表出现多次（标题/摘要截断/导航），按链接去重；
 * 日期从路径 tYYYYMMDD 提取（如 t20260909 → 2026-09-09）。
 * 注意：页面无 charset 头（实测 content-type 无 charset），内容为 UTF-8，直接按 UTF-8 处理。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchText } from './fetch.ts';

const BASE = 'https://www.stats.gov.cn';
const LIST_PATH = '/sj/sjjd/';
const LIST_URL = `${BASE}${LIST_PATH}`;

export const statsSjjdAdapter: HotSourceAdapter = {
  id: 'stats-sjjd',
  label: '国家统计局数据解读',
  vertical: 'gov-stats',
  capabilities: ['品类趋势', '市场数据'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const html = await fetchText(LIST_URL, timeoutMs);
    const items: RawSourceItem[] = [];
    const seen = new Set<string>();
    // 列表链接：相对路径 ./202609/t20260909_1965261.html（同一链接可能多次出现，按 href 去重）
    const linkRe = /<a[^>]+href=["']((?:\.\/|\.\.\/)?\d{6}\/t(\d{8})_\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(linkRe)) {
      const href = m[1];
      const dateStr = m[2]; // t20260909 → 20260909
      const title = compact(m[3]).replace(/<[^>]+>/g, '');
      if (!title || seen.has(href)) continue;
      seen.add(href);
      const abs = new URL(href, LIST_URL).href;
      const latestAt = /^(\d{4})(\d{2})(\d{2})$/.exec(dateStr);
      items.push({
        id: `stats-${dateStr}-${href.replace(/\D/g, '').slice(-6)}`,
        title: decodeEntities(title),
        summary: null,
        latest: null,
        sourceCount: 1,
        url: abs,
        latestAt: latestAt ? `${latestAt[1]}-${latestAt[2]}-${latestAt[3]}T00:00:00.000Z` : null,
      });
    }
    return { items };
  },
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
