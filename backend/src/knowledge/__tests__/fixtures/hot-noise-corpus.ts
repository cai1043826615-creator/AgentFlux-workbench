/**
 * 固定噪音样本语料（hot-intel 4.5，用户明确要求）。
 *
 * 用途：固定语料 + 写死期望，跑 classifyHot 逐条断言层级；供后续回归复用。
 * 期望按 hot-intel 降噪规则（D4）推导并写死，**不许按当前输出反向填**：
 * - 排除词命中 → 该关注域直接不成立（competitor 排除 Apple/iPhone/大模型/模型发布；promo 排除 发布会/开发者大会）
 * - 同一关注域需命中 ≥2 个不同关键词才成立（minKeywordHits=2，同一词重复只计 1 次）
 * - 非电商垂直源（AI 行业聚合 / gov-stats）条目最高只进「浏览」（tierCap）
 * - mustRead 需「域成立 + sourceCount ≥ minimumSources(2) + tierCap 允许 mustRead」
 *
 * 样本覆盖：实证反例（Apple 发布会 / DeepSeek 新模型）、真·平台规则 / 真·促销节点 / 真·品类趋势 /
 * 噪音泛词单命中（发布/预售/平台/趋势）、AI 源降层、阈值防误报等。
 */
import type { HotTier } from '@workbench/shared';

export interface HotNoiseCorpusItem {
  id: string;
  title: string;
  summary?: string | null;
  /** 无 sourceId = 旧格式（不受 tierCap 限制） */
  sourceId?: string;
  vertical?: string;
  sourceCount: number;
  /** 期望层级（写死） */
  expected: HotTier;
  /** 是否与电商无关的噪音样本（4.6 噪音量化用） */
  noise?: boolean;
}

export const HOT_NOISE_CORPUS: HotNoiseCorpusItem[] = [
  // ===== 实证反例（4.5 必含） =====
  {
    id: 'noise-apple',
    title: 'Apple 发布首款折叠屏 iPhone Duo，$1,999',
    summary: '起售价 $1,999，国内上市时间待定。',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 3,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-deepseek',
    title: 'DeepSeek 发布新模型，大模型能力再升级',
    summary: '开源模型推理性能超越。',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 3,
    expected: 'other',
    noise: true,
  },
  // ===== 真·电商样本（应进必看） =====
  {
    id: 'real-platform-rule',
    title: '天猫发布新规，平台规则再收紧',
    summary: '保证金与佣金费率调整，商家需重新报备资质。',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 3,
    expected: 'mustRead',
  },
  {
    id: 'real-promo',
    title: '双11 预售开启，大促补贴力度空前',
    summary: '满减优惠券发放，直播间同步放量。',
    sourceId: '100ec-24h',
    vertical: 'ecommerce-news',
    sourceCount: 2,
    expected: 'mustRead',
  },
  {
    id: 'real-trend',
    title: '某品类销量同比增长，市场份额持续扩大',
    summary: '行业报告显示消费需求增长。',
    sourceId: 'stats-sjjd',
    vertical: 'gov-stats',
    sourceCount: 1,
    expected: 'browse',
  },
  {
    id: 'real-jd618',
    title: '京东 618 大促开启，满减优惠券发放',
    summary: '补贴力度空前。',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 3,
    expected: 'mustRead',
  },
  {
    id: 'real-content',
    title: '小红书达人种草笔记流量暴涨，直播间转化率提升',
    summary: '带货素材需求旺盛。',
    sourceId: '100ec-24h',
    vertical: 'ecommerce-news',
    sourceCount: 2,
    expected: 'mustRead',
  },
  {
    id: 'real-competitor',
    title: '竞品品牌上新，降价促销抢占市场',
    summary: '联名款同步开售。',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 2,
    expected: 'mustRead',
  },
  {
    id: 'real-platform-multi',
    title: '天猫 淘宝 京东 发布双11 招商规则',
    summary: '各平台商家报名开启。',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 2,
    expected: 'mustRead',
  },
  // ===== AI 行业源降层（即使命中关注域，最高只进浏览） =====
  {
    id: 'ai-hot-tiercap',
    title: '天猫双11新规：预售期延长',
    summary: '平台调整预售规则。',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 5,
    expected: 'browse',
  },
  // ===== 泛词单命中 / 关注域外（应归 other） =====
  {
    id: 'noise-weather',
    title: '某地天气预报，今日多云转晴',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 1,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-earnings',
    title: '科技公司发布年度财报，营收增长 20%',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 2,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-phone',
    title: '某手机品牌发布新款旗舰机，售价 3999 元',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 2,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-single-presale',
    title: '某商品预售开启',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 1,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-platform-feature',
    title: '平台上线新功能，优化用户体验',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 2,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-ai-chip',
    title: '全球 AI 芯片厂商发布新品，性能大幅提升',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 3,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-summit',
    title: '某地举行行业峰会，探讨电商发展趋势',
    sourceId: 'aihot',
    vertical: 'AI 行业聚合',
    sourceCount: 2,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-double11-weak',
    title: '双11 备战中',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 1,
    expected: 'other',
    noise: true,
  },
  {
    id: 'noise-daren',
    title: '达人直播进行时',
    sourceId: 'pai-news',
    vertical: 'ecommerce-news',
    sourceCount: 1,
    expected: 'other',
    noise: true,
  },
  {
    id: 'real-market-cpi',
    title: '国家统计局发布 CPI 数据，消费价格温和上涨',
    sourceId: 'stats-sjjd',
    vertical: 'gov-stats',
    sourceCount: 1,
    expected: 'other',
  },
];
