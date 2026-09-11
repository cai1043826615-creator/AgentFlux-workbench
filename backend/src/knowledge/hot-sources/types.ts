/**
 * 可插拔多源适配器契约（hot-intel B10 / D3）。
 *
 * 每个源是一个独立适配器（拉取 + 归一化为统一形状）；注册表在 index.ts。
 * 新增/替换源无需修改聚合与分层逻辑——只实现本契约并在 index.ts 注册。
 */
import type { HotDailyInfo } from '@workbench/shared';

/** 适配器归一化后的原始条目（纯内容字段；来源元数据 sourceId/sourceName/vertical 由聚合层收集时注入） */
export interface RawSourceItem {
  id: string;
  title: string;
  summary: string | null;
  /** 最新进展（无则前端隐藏该层） */
  latest: string | null;
  /** 原文链接 */
  url: string | null;
  /** 数据时间（ISO；无则 null） */
  latestAt: string | null;
  /** 独立信源数（源自身报告的跟进数，默认 1） */
  sourceCount: number;
}

/** 适配器一次拉取的产物：条目 + 可选的日报信息 */
export interface HotSourceFetchResult {
  items: RawSourceItem[];
  /** 上游日报信息（信息条外链；无则 null） */
  daily?: HotDailyInfo | null;
}

/** 源适配器接口 */
export interface HotSourceAdapter {
  /** 源唯一标识（与配置 sources[].adapter 对应） */
  id: string;
  /** 展示名 */
  label: string;
  /** 垂直类别 */
  vertical: string;
  /** 覆盖的关注类别（平台规则/促销节点/品类趋势/竞品动态/内容营销），用于能力标注 */
  capabilities: string[];
  /**
   * 拉取并归一化。
   * - 网络错误 / HTTP 非 2xx / 响应体为空或不可解析 → 抛错（由聚合层 allSettled 降级该源）；
   * - 内容合法但条目数为 0 → 返回空 items（正常，聚合层按 0 条处理并标注）。
   */
  fetchAll(timeoutMs: number): Promise<HotSourceFetchResult>;
}
