/**
 * 网经社 24h 播报适配器（hot-intel B10；调研报告 P1，本机实测 200 / 873ms，服务端可直取，静态列表）。
 * 端点：https://www.100ec.cn/list.html（电子商务研究中心 24h 播报页）
 *
 * 解析（实测 2026-09-11）：<dl> 块内 <dt><a href="detail--<id>.html">标题</a><span>时间</span></dt>
 * 无摘要字段；链接相对路径需拼全 https://www.100ec.cn/ 前缀。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchText } from './fetch.ts';

const BASE = 'https://www.100ec.cn';
const LIST_URL = `${BASE}/list.html`;

export const ec100Adapter: HotSourceAdapter = {
  id: '100ec-24h',
  label: '网经社 24h 播报',
  vertical: 'ecommerce-news',
  capabilities: ['平台规则', '竞品动态', '行业动态'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const html = await fetchText(LIST_URL, timeoutMs);
    const items: RawSourceItem[] = [];
    const seen = new Set<string>();
    // <dl> 块：<dt><a href="detail--<id>.html">标题</a><span>时间</span></dt>
    const blockRe = /<dl>([\s\S]*?)<\/dl>/gi;
    for (const m of html.matchAll(blockRe)) {
      const block = m[1];
      const link = /<a[^>]+href=["'](detail--(\d+)\.html)["'][^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (!link) continue;
      const id = link[2];
      const title = compact(link[3]).replace(/<[^>]+>/g, '');
      if (!title || seen.has(id)) continue;
      seen.add(id);
      const time = /<span>([\s\S]*?)<\/span>/i.exec(block)?.[1] ?? null;
      const latestAt = time && /\d{4}-\d{2}-\d{2}/.test(time) ? new Date(compact(time).replace(' ', 'T')).toISOString() : null;
      items.push({
        id: `100ec-${id}`,
        title: decodeEntities(title),
        summary: null,
        latest: null,
        sourceCount: 1,
        url: `${BASE}/detail--${id}.html`,
        latestAt,
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
