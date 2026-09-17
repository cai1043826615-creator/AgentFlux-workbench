/**
 * 官方规则源骨架适配器（report-driven-fixes 3.7）：淘宝/天猫规则中心、小红书规则公告页。
 *
 * 实测结论（2026-09）：三个端点均可连通（HTTP 200），但均为 **JS 渲染 SPA 壳**：
 * - rule.taobao.com / rule.tmall.com：首页与 rule-ajax-api 全部返回 ~1980B 的 Next.js 兜底页
 *   （带 cookie 会话重试仍为壳；无公开的静态规则列表 HTML/JSON）；
 * - xiaohongshu.com：社区规范/协议页是静态正文（无「规则公告」列表 API）。
 * 无浏览器环境下无法自动解析出「规则更新条目」。
 *
 * 因此按任务指示输出**待人工维护摘要文档**骨架：适配器已注册（接入），
 * fetchAll 快速失败并给出可读原因（源状态 degraded + 维护提示），不阻塞其它源；
 * 默认配置 disabled（见 attention.ts DEFAULT_SOURCES / attention.json），
 * 后续有人工维护的摘要文档（可解析的静态页/JSON）时替换本骨架即可。
 */
import type { HotSourceAdapter, HotSourceFetchResult } from './types.ts';
import { HotFetchError, fetchText } from './fetch.ts';

const MANUAL_HINT = '需人工维护摘要文档：该规则站点为 JS 渲染页，无静态规则列表可自动解析';

/** 骨架：尝试抓取首页，仅当能解析出结构化规则条目时返回；否则抛「待人工维护」错误（快速失败，不等到超时） */
function makeRuleSkeleton(id: string, label: string, url: string, extract: (html: string) => HotSourceFetchResult | null): HotSourceAdapter {
  return {
    id,
    label,
    vertical: 'official-rules',
    capabilities: ['平台规则'],
    async fetchAll(timeoutMs: number): Promise<HotSourceFetchResult> {
      const html = await fetchText(url, timeoutMs);
      const parsed = extract(html);
      if (parsed) return parsed;
      throw new HotFetchError(`${label}：${MANUAL_HINT}（${url}）`, 'HOT_MANUAL_MAINTENANCE');
    },
  };
}

export const taobaoRuleAdapter = makeRuleSkeleton('taobao-rule', '淘宝规则中心', 'https://rule.taobao.com/', (html) => {
  // SPA 壳判定：标题被兜底页接管（如「淘宝网 - 淘！我喜欢」）或无规则列表锚点 → 返回 null 走维护提示
  if (/淘宝网\s*-\s*淘！我喜欢|<!DOCTYPE html>[\s\S]{0,400}window\.__NEXT_DATA__/i.test(html) && !/<a[^>]+href=["'][^"']*(rule|规则)/i.test(html)) return null;
  return null; // 骨架：即使有壳外内容也未定义解析规则，一律维护提示
});

export const tmallRuleAdapter = makeRuleSkeleton('tmall-rule', '天猫规则中心', 'https://rule.tmall.com/', (html) => {
  return null; // 骨架：待人工维护摘要文档
});

export const xhsRuleAdapter = makeRuleSkeleton('xhs-rule', '小红书规则公告', 'https://www.xiaohongshu.com/protocols/about/terms', (html) => {
  return null; // 骨架：协议正文非「规则公告」列表，待人工维护摘要文档
});
