/**
 * 电商派 7×24h 快讯适配器（hot-intel B10；调研报告 P0，本机实测 200 / 458ms / 3-3 稳定，无需鉴权）。
 * 端点：https://www.pai.com.cn/news/（纯静态 HTML，robots 宽松，sitemap 可用）
 *
 * 解析策略（实测 2026-09-11）：
 * - 页面为 Next.js SSR：HTML 内嵌 ApolloSSRDataTransport JSON，含 posts.edges[].node
 *   （id/title/slug/summary/source_url/url/publishedAt），优先用内嵌 JSON（字段最全）；
 * - 兜底：正则提取 `/news/<26位slug>` 链接 + 标题文本。
 * - 防呆：解析出的条目数骤降（< 上界的一半且 < 3）视为异常，仍返回（由聚合层按 0 条/降级处理由上层判断）。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchText } from './fetch.ts';

const BASE = 'https://www.pai.com.cn';
const LIST_URL = `${BASE}/news/`;

/** 从内嵌 Apollo JSON 提取 posts（字段含 summary/publishedAt/source_url） */
function extractFromSsrData(html: string): RawSourceItem[] {
  const out: RawSourceItem[] = [];
  // ApolloSSRDataTransport JSON 里找 Post 节点；宽松扫描 "title" / "slug" / "summary" 组合
  const slugRe = /"slug":"([0-9a-z]{20,30})"/g;
  const slugs = [...html.matchAll(slugRe)].map((m) => m[1]);
  for (const slug of slugs) {
    const i = html.indexOf(`"slug":"${slug}"`);
    if (i < 0) continue;
    const seg = html.slice(Math.max(0, i - 400), i + 1200);
    const title = /"title":"([\s\S]*?)"/.exec(seg)?.[1];
    const summary = /"summary":"([\s\S]*?)"/.exec(seg)?.[1];
    const publishedAt = /"published_at":"([^"]+)"/.exec(seg)?.[1] ?? /"publishedAt":"([^"]+)"/.exec(seg)?.[1];
    if (!title) continue;
    out.push({
      id: `pai-${slug}`,
      title: decodeEntities(compact(title)),
      summary: summary ? decodeEntities(compact(summary)) : null,
      latest: null,
      sourceCount: 1,
      url: `${BASE}/news/${slug}`,
      latestAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    });
  }
  return out;
}

/** 兜底：HTML 链接正则（/news/<slug> + 标题文本） */
function extractFromHtmlLinks(html: string): RawSourceItem[] {
  const out: RawSourceItem[] = [];
  const re = /<a[^>]+href=["'](\/news\/[0-9a-z]{20,30})["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const href = m[1];
    const title = decodeEntities(compact(m[2])).replace(/<[^>]+>/g, '');
    if (!title) continue;
    const slug = href.split('/').pop() ?? '';
    out.push({
      id: `pai-${slug}`,
      title,
      summary: null,
      latest: null,
      sourceCount: 1,
      url: `${BASE}${href}`,
      latestAt: null,
    });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export const paiNewsAdapter: HotSourceAdapter = {
  id: 'pai-news',
  label: '电商派快讯',
  vertical: 'ecommerce-news',
  capabilities: ['平台规则', '竞品动态', '促销节点', '内容营销'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const html = await fetchText(LIST_URL, timeoutMs);
    let items = extractFromSsrData(html);
    if (items.length === 0) items = extractFromHtmlLinks(html);
    // 防呆：内容合法但条目数异常少（<3）→ 仍返回（聚合层按 0 条/降级由上层判断）
    return { items };
  },
};
