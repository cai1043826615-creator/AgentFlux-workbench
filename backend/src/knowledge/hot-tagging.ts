/**
 * 热点 AI 批量打标（report-driven-fixes 3.4 / hot-trend-pivot 2.1-2.2）。
 *
 * 单次 LLM 批量调用（复用 assistant 的 callLlm 链路与 agent-assistant 身份）：
 * 把去重后的热点条目一次性判为三类——产出方向（dir）/ 可参考（ref）/ 无关（none），
 * 并给出方向标签（tag）与一句话用法建议（use）。
 *
 * 降级约定：LLM 调用失败或输出非法 → 返回 null，聚合层全批降级「可参考」并标注 aiDegraded；
 * 结果随热点缓存 TTL 复用（hot.ts 把结果写进缓存 payload，命中缓存不再触发 LLM）。
 */
import { callLlm } from '../agents/llm.ts';

/** 与 assistant.ts 的「依依」同一实体（agent-assistant） */
const ASSISTANT_ID = 'agent-assistant';

export interface AiTagResult {
  /** 产出方向 / 可参考 / 无关 */
  cls: 'dir' | 'ref' | 'none';
  /** 方向标签（如「主图卖点」「选品方向」；无关条目可为空） */
  tag: string;
  /** 一句话用法建议（无关条目可为空） */
  use: string;
}

const SYSTEM = [
  '你是电商热点情报分析助手。对给定热点条目做三类判定：',
  '- dir（产出方向）：与电商经营直接相关，可快速转化为 主图/详情页卖点、选品方向、内容选题、活动话术 等产出；',
  '- ref（可参考）：有一定背景价值（行业趋势、竞品动态、平台动态），可作参考但不宜直接产出；',
  '- none（无关）：纯社会娱乐、体育、国际时政等与电商经营无关。',
  '严格基于标题/摘要判断，不臆测。',
  '只输出一个 JSON 对象（不要 markdown 围栏、不要额外文字）：{"items":[{"t":"<条目 id>","c":"dir|ref|none","tag":"<方向标签，5 字内>","use":"<一句话用法建议，30 字内>"}]}',
  '每一条都要覆盖，t 必须与输入的 id 完全一致。',
].join('\n');

/** 从 LLM 输出宽松提取 JSON（与 smart-producer extractJson 同策略） */
function extractJson(text: string): { items?: unknown[] } | null {
  try {
    return JSON.parse(text) as { items?: unknown[] };
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as { items?: unknown[] };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 批量打标：一次 LLM 调用为全部条目打标。
 * 成功 → Map<条目 id, {cls, tag, use}>；失败/解析失败 → null（全批降级「可参考」）。
 * 空输入 → 空 Map（不触发 LLM）。
 */
export async function tagHotItems(items: { id: string; title: string }[]): Promise<Map<string, AiTagResult> | null> {
  if (items.length === 0) return new Map();
  const user = [
    `请对以下 ${items.length} 条热点做三类判定：`,
    JSON.stringify({ items: items.map((i) => ({ t: i.id, title: i.title })) }),
  ].join('\n');
  try {
    const result = await callLlm({ agentId: ASSISTANT_ID, system: SYSTEM, user, temperature: 0.2, maxTokens: 4000 });
    const parsed = extractJson(result.content);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    const map = new Map<string, AiTagResult>();
    for (const raw of parsed.items) {
      if (!raw || typeof raw !== 'object') continue;
      const it = raw as Record<string, unknown>;
      const t = String(it.t ?? '').trim();
      if (!t) continue;
      const cls = it.c === 'dir' ? 'dir' : it.c === 'none' ? 'none' : 'ref';
      map.set(t, {
        cls,
        tag: String(it.tag ?? '').trim().slice(0, 20),
        use: String(it.use ?? '').trim().slice(0, 60),
      });
    }
    return map;
  } catch (err) {
    console.warn(`[hot-tagging] LLM 批量打标失败，全批降级「可参考」：${err instanceof Error ? err.message : err}`);
    return null;
  }
}
