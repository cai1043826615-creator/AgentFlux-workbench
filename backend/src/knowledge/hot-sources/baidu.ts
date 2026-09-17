/**
 * 百度实时热点适配器（report-driven-fixes 3.3 / hot-trend-pivot 1.1；Q2 解析修复）。
 * 端点：https://top.baidu.com/api/board?platform=wise&tab=realtime（JSON）
 *
 * Q2 修复：真实返回是**三层嵌套** data.cards[].content[].content[]（cards[].content[] 只是分组壳，
 * 真正的词条在最内层的 content[] 里，字段 word/url/desc 可选/hotTag/index 等），
 * 旧实现只解析了两层 → 永远 0 条却报 ok。现按三层解析，并兼容旧两层结构。
 * 解析结果为 0 条 → 抛 HOT_PARSE_EMPTY（聚合层标注 degraded + 原因「解析失败/接口结构变更」），
 * 不再静默报 ok。上限 30 条。
 */
import type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
import { compact, fetchJson, hashText, HotFetchError } from './fetch.ts';

const ENDPOINT = 'https://top.baidu.com/api/board?platform=wise&tab=realtime';
const MAX_ITEMS = 30;

/** 最内层词条（真实结构：word/url/可选 desc、hotTag、index、newHotName 等） */
interface BaiduEntry {
  word?: string;
  desc?: string;
  url?: string;
}

/** 分组壳：content 在真实结构里是「词条数组」，在旧两层结构里是「词条对象数组」 */
interface BaiduGroup {
  content?: (BaiduEntry & { content?: BaiduEntry[] })[];
}

interface BaiduCard {
  content?: BaiduGroup[];
}

/**
 * 三层嵌套提取（Q2）。
 * 遍历时 group 有两种形态，都要兼容：
 * ① 真实结构：cards[].content[] 元素是「分组壳」{ content: [词条...] }，词条在其 content 里；
 * ② 旧两层/扁平结构：cards[].content[] 元素本身就是词条 { word, url, ... }。
 */
function collectEntries(json: { data?: { cards?: BaiduCard[] } } | null): BaiduEntry[] {
  const out: BaiduEntry[] = [];
  for (const card of json?.data?.cards ?? []) {
    for (const group of card?.content ?? []) {
      if (!group || typeof group !== 'object') continue;
      if (Array.isArray(group.content)) {
        // ① 分组壳：词条在 group.content[]（真实结构，可能再嵌一层 content）
        for (const entry of group.content) {
          if (!entry || typeof entry !== 'object') continue;
          const nested = (entry as { content?: BaiduEntry[] }).content;
          if (Array.isArray(nested)) {
            for (const inner of nested) if (inner && typeof inner === 'object') out.push(inner);
          } else {
            out.push(entry);
          }
        }
        continue;
      }
      // ② 扁平结构：group 本身即词条
      out.push(group as BaiduEntry);
    }
  }
  return out;
}

export const baiduHotAdapter: HotSourceAdapter = {
  id: 'baidu-hot',
  label: '百度实时热点',
  vertical: 'hot-trend',
  capabilities: ['品类趋势', '竞品动态', '内容营销'],
  async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
    const json = (await fetchJson(ENDPOINT, timeoutMs)) as { data?: { cards?: BaiduCard[] } } | null;
    const now = new Date().toISOString();
    const entries = collectEntries(json);
    // Q2：解析结果为 0 条 → 显式降级（旧实现此时会静默返回 ok，掩盖接口结构变更）
    if (entries.length === 0) {
      throw new HotFetchError('百度热点解析失败/接口结构变更（未从返回中解析出任何词条）', 'HOT_PARSE_EMPTY');
    }
    const items: RawSourceItem[] = [];
    for (const e of entries) {
      const word = compact(e?.word);
      if (!word) continue;
      items.push({
        id: `baidu-${hashText(word)}`,
        title: word,
        summary: e?.desc ? compact(e.desc) : null,
        latest: null,
        url: e?.url ? String(e.url) : null,
        sourceCount: 1,
        latestAt: now,
      });
      if (items.length >= MAX_ITEMS) break;
    }
    if (items.length === 0) {
      // 拿到了词条但全部无标题 → 同样是解析异常
      throw new HotFetchError('百度热点解析失败/接口结构变更（词条缺少标题字段）', 'HOT_PARSE_EMPTY');
    }
    return { items };
  },
};
