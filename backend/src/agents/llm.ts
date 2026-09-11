import { CHANNEL } from '../config.ts';
import { getSetting } from './channel-settings.ts';

export interface LlmCallOptions {
  agentId: string;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** 多模态图片（dataURL 或 http URL 数组）；传入后消息以「文本 + 图片」多模态内容发送（视觉模型审阅用） */
  images?: string[];
  /** 请求超时（默认 120s；渠道健康检查用 15s） */
  timeoutMs?: number;
}

/** 渠道返回的 token usage（delivery-ops B12） */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/** callLlm 返回结构：内容 + 可选的渠道 usage（未回传时为 undefined） */
export interface LlmResult {
  content: string;
  usage?: LlmUsage;
}

/** 渠道信息（健康检查复用同一选择顺序） */
export interface LlmChannelInfo {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class LlmChannelUnavailableError extends Error {
  constructor() {
    super('LLM 渠道未配置');
  }
}

type UsageSink = (u: LlmUsage) => void;

/**
 * usage 采集器（delivery-ops B12）：engine/service.ts 在阶段执行前注册、执行后读取。
 * 当前架构内阶段执行中的 LLM 调用均为顺序（生图阶段不调用 callLlm），单写者下安全。
 */
let usageSink: UsageSink | null = null;

export function setLlmUsageSink(fn: UsageSink | null): void {
  usageSink = fn;
}

/**
 * 渠道解析（与 callLlm 相同的选择顺序，供渠道健康检查复用）：
 * 1. 设置面板 llmChannels[agentId] 配置了专属 apiKey → 整套使用该渠道；
 * 2. 主管波波（agent-supervisor）→ 视觉审阅渠道（SUPERVISOR_* env，可识图）整套；
 * 3. 回退 .env.local 默认 LLM 渠道整套。
 * override 中非空字段优先（健康检查「保存前先测」用）。
 * 无可用 apiKey 时返回 null。
 */
export function resolveLlmChannel(agentId: string, override?: Partial<LlmChannelInfo>): LlmChannelInfo | null {
  const channel = getSetting<Record<string, LlmChannelInfo>>('llmChannels') ?? {};
  const perAgent = channel[agentId];
  const isSupervisor = agentId === 'agent-supervisor';

  // 整渠道一致选择：perAgent 专属 → supervisor 视觉渠道 → 默认 LLM
  const own = perAgent?.apiKey ? perAgent : undefined;
  const sup = isSupervisor && CHANNEL.supervisor.apiKey ? CHANNEL.supervisor : undefined;
  const baseUrl = override?.baseUrl || own?.baseUrl || sup?.baseUrl || CHANNEL.llm.baseUrl;
  const apiKey = override?.apiKey || own?.apiKey || sup?.apiKey || CHANNEL.llm.apiKey;
  const model = override?.model || own?.model || sup?.model || CHANNEL.llm.model;

  if (!apiKey) return null;
  return { baseUrl, apiKey, model };
}

/**
 * 真实 LLM 调用（OpenAI 兼容 chat/completions，支持多模态图片输入）。
 * 返回 { content, usage? }：渠道响应含 usage.prompt_tokens/completion_tokens 时回传真实值；
 * 未回传时 usage 为 undefined（由执行日志层按字符数估算并标记 estimated）。
 * 渠道不可用时抛 LlmChannelUnavailableError，由调用方降级 mock（design.md D9）。
 */
export async function callLlm(options: LlmCallOptions): Promise<LlmResult> {
  const channel = resolveLlmChannel(options.agentId);
  // resolveLlmChannel 为 null ⟺ 面板专属/主管视觉/.env 默认均无可用 apiKey → 渠道未配置
  if (!channel) throw new LlmChannelUnavailableError();

  const model = options.model || channel.model;

  const hasImages = Array.isArray(options.images) && options.images.length > 0;
  const messages = hasImages
    ? [
        { role: 'system', content: options.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: options.user },
            ...(options.images ?? []).map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ]
    : [
        { role: 'system', content: options.system },
        { role: 'user', content: options.user },
      ];

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 120_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${channel.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${channel.apiKey}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 响应无内容');
    const usage: LlmUsage | undefined =
      data.usage && typeof data.usage.prompt_tokens === 'number'
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens ?? 0 }
        : undefined;
    if (usage && usageSink) usageSink(usage);
    return { content, usage };
  } finally {
    clearTimeout(timer);
  }
}
