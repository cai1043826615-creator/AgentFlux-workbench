/**
 * 多源适配器注册表（hot-intel B10 / D3）：新增/替换源只需实现 HotSourceAdapter 并在此注册，
 * 聚合与分层代码无需改动（specs/daily-hot「新增源不需改动聚合逻辑」）。
 * 现状（report-driven-fixes 3.3/3.7）：国家统计局源已下线（stats-sjjd 删除）；AI HOT 源关闭
 * （配置层 disabled，见 attention.ts DEFAULT_SOURCES / attention.json）；新增 4 热榜源
 * （百度/60s·微博/60s·抖音/头条）与 3 官方规则源骨架（淘宝/天猫/小红书，默认 disabled）。
 */
import type { HotSourceConfig } from '@workbench/shared';
import type { HotSourceAdapter } from './types.ts';
import { aihotAdapter } from './aihot.ts';
import { paiNewsAdapter } from './pai-news.ts';
import { ec100Adapter } from './100ec.ts';
import { baiduHotAdapter } from './baidu.ts';
import { weibo60sAdapter, douyin60sAdapter } from './60s.ts';
import { toutiaoHotAdapter } from './toutiao.ts';
import { taobaoRuleAdapter, tmallRuleAdapter, xhsRuleAdapter } from './rule-sources.ts';

/** 全部已注册适配器（注册表） */
export const ADAPTERS: Record<string, HotSourceAdapter> = {
  aihot: aihotAdapter,
  'pai-news': paiNewsAdapter,
  '100ec-24h': ec100Adapter,
  'baidu-hot': baiduHotAdapter,
  '60s-weibo': weibo60sAdapter,
  '60s-douyin': douyin60sAdapter,
  'toutiao-hot': toutiaoHotAdapter,
  'taobao-rule': taobaoRuleAdapter,
  'tmall-rule': tmallRuleAdapter,
  'xhs-rule': xhsRuleAdapter,
};

/** 按配置实例化启用中的适配器；未知 adapter id 的配置被跳过（不报错，保证「新增源不需改动聚合逻辑」） */
export function instantiateAdapters(cfg: HotSourceConfig[]): HotSourceAdapter[] {
  const out: HotSourceAdapter[] = [];
  for (const s of cfg) {
    if (!s || s.enabled === false) continue;
    const adapter = ADAPTERS[s.adapter];
    if (!adapter) {
      console.warn(`[hot] 跳过未知适配器配置：${s.id} (adapter=${s.adapter})`);
      continue;
    }
    out.push(adapter);
  }
  return out;
}

/** 单源配置查询（聚合层按 sourceId 回填 vertical/tierCap 等） */
export function sourceConfigOf(cfg: HotSourceConfig[], sourceId: string): HotSourceConfig | undefined {
  return cfg.find((s) => s.id === sourceId);
}

export type { HotSourceAdapter, HotSourceFetchResult, RawSourceItem } from './types.ts';
