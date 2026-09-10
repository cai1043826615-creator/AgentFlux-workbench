import { CHANNEL, hasLlmChannel, hasSupervisorChannel } from '../config.ts';
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
}

export class LlmChannelUnavailableError extends Error {
  constructor() {
    super('LLM 渠道未配置');
  }
}

/**
 * 真实 LLM 调用（OpenAI 兼容 chat/completions，支持多模态图片输入）。
 * 渠道选择按「整渠道一致」（避免 baseUrl 与 apiKey 错配）：
 * 1. 设置面板 llmChannels[agentId] 配置了专属 apiKey → 整套使用该渠道；
 * 2. 主管波波（agent-supervisor）→ 视觉审阅渠道（SUPERVISOR_* env，可识图）整套；
 * 3. 回退 .env.local 默认 LLM 渠道整套；
 * 均未配置时抛 LlmChannelUnavailableError，由调用方降级 mock（design.md D9）。
 */
export async function callLlm(options: LlmCallOptions): Promise<string> {
  const channel = getSetting<Record<string, { baseUrl: string; apiKey: string; model: string }>>('llmChannels') ?? {};
  const perAgent = channel[options.agentId];
  const isSupervisor = options.agentId === 'agent-supervisor';

  // 整渠道一致选择：perAgent 专属 → supervisor 视觉渠道 → 默认 LLM
  const own = perAgent?.apiKey ? perAgent : undefined;
  const sup = isSupervisor && CHANNEL.supervisor.apiKey ? CHANNEL.supervisor : undefined;
  const baseUrl = own?.baseUrl || sup?.baseUrl || CHANNEL.llm.baseUrl;
  const apiKey = own?.apiKey || sup?.apiKey || CHANNEL.llm.apiKey;
  const model = options.model || own?.model || sup?.model || CHANNEL.llm.model;

  if (!apiKey) {
    if (isSupervisor ? !hasSupervisorChannel() && !hasLlmChannel() : !hasLlmChannel()) throw new LlmChannelUnavailableError();
  }

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
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM 响应无内容');
    return content;
  } finally {
    clearTimeout(timer);
  }
}
