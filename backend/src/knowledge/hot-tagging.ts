/**
 * 热点 AI 批量打标（report-driven-fixes 3.4 / hot-trend-pivot 2.1-2.2；Q1 分批改造）。
 *
 * 单次 LLM 批量调用（复用 assistant 的 callLlm 链路与 agent-assistant 身份）：
 * 把去重后的热点条目一次性判为三类——产出方向（dir）/ 可参考（ref）/ 无关（none），
 * 并给出方向标签（tag）与一句话用法建议（use）。
 *
 * Q1 分批改造（关键）：展示集改为全量上屏后条目可达 200+ 条，
 * 一次喂给 LLM 会因输出超长被截断 → extractJson 失败 → 静默全批降级（历史教训）。
 * 故改为**按批循环调用**（TAG_BATCH_SIZE 条/批）再合并结果：
 * - 单批失败只影响该批，打日志继续，其余批正常返回；
 * - 全部批均失败 → 返回 null（聚合层标注 aiDegraded，前端显示「AI 识别暂不可用」）；
 * - 任一批成功 → aiTagged=true，失败批的条目在前端兜底进「可参考」。
 *
 * 降级约定：LLM 调用失败或输出非法 → null，聚合层全批降级「可参考」并标注 aiDegraded；
 * 结果随热点缓存 TTL 复用（hot.ts 把结果写进缓存 payload，命中缓存不再触发 LLM）。
 */
import { callLlm } from '../agents/llm.ts';

/** 与 assistant.ts 的「依依」同一实体（agent-assistant） */
const ASSISTANT_ID = 'agent-assistant';

/** LLM 调用入口（默认 callLlm；单测可注入假实现，见 __setTagLlmForTest） */
let llmCall: typeof callLlm = callLlm;

/** 仅供测试注入假 LLM（生产不调用） */
export function __setTagLlmForTest(fn: typeof callLlm | null): void {
  llmCall = fn ?? callLlm;
}

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
 * 每批打标条数（Q1）：25 条/批。
 * 经验值历史教训：一次喂 200+ 条会因输出超长被截断导致整批解析失败；25 条的输出约 1.5k tokens，安全。
 */
export const TAG_BATCH_SIZE = 25;

/** 解析单批输出为 Map（失败返回 null，不抛错） */
function parseBatch(items: unknown[], into: Map<string, AiTagResult>): void {
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const t = String(it.t ?? '').trim();
    if (!t) continue;
    const cls = it.c === 'dir' ? 'dir' : it.c === 'none' ? 'none' : 'ref';
    into.set(t, {
      cls,
      tag: String(it.tag ?? '').trim().slice(0, 20),
      use: String(it.use ?? '').trim().slice(0, 60),
    });
  }
}

/** 单批打标（内部用）：成功 → 写入 into 并返回 true；失败 → false 并打日志 */
async function tagBatch(batch: { id: string; title: string }[], into: Map<string, AiTagResult>): Promise<boolean> {
  const user = [
    `请对以下 ${batch.length} 条热点做三类判定：`,
    JSON.stringify({ items: batch.map((i) => ({ t: i.id, title: i.title })) }),
  ].join('\n');
  try {
    const result = await llmCall({ agentId: ASSISTANT_ID, system: SYSTEM, user, temperature: 0.2, maxTokens: 4000 });
    const parsed = extractJson(result.content);
    if (!parsed || !Array.isArray(parsed.items)) {
      console.warn(`[hot-tagging] 单批 ${batch.length} 条打标输出无法解析（可能输出超长被截断），该批降级「可参考」`);
      return false;
    }
    parseBatch(parsed.items, into);
    return true;
  } catch (err) {
    console.warn(`[hot-tagging] 单批（${batch.length} 条）LLM 打标失败，该批降级「可参考」：${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * 批量打标：**分批**调用 LLM（每批 TAG_BATCH_SIZE 条）并合并结果。
 * - 任一批成功 → 返回合并后的 Map（调用方据此 aiTagged=true）；
 * - 全部批失败 → 返回 null（调用方标注 aiDegraded）；
 * - 空输入 → 空 Map（不触发 LLM）。
 */
export async function tagHotItems(items: { id: string; title: string }[]): Promise<Map<string, AiTagResult> | null> {
  if (items.length === 0) return new Map();
  const merged = new Map<string, AiTagResult>();
  let okBatches = 0;
  let failBatches = 0;
  for (let i = 0; i < items.length; i += TAG_BATCH_SIZE) {
    const batch = items.slice(i, i + TAG_BATCH_SIZE);
    // 顺序调用：避免瞬间并发打爆渠道限流（200 条约 8 批，可接受）
    const ok = await tagBatch(batch, merged);
    if (ok) okBatches++;
    else failBatches++;
  }
  if (okBatches === 0) {
    console.warn(`[hot-tagging] 全部 ${failBatches} 批打标失败（共 ${items.length} 条），全批降级「可参考」`);
    return null;
  }
  if (failBatches > 0) {
    console.warn(`[hot-tagging] 分批打标部分失败：${failBatches} 批失败 / ${okBatches} 批成功（共 ${items.length} 条，已打标 ${merged.size} 条）`);
  }
  return merged;
}
