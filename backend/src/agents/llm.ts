import { CHANNEL, hasLlmChannel } from '../config.ts';
import { getSetting } from './channel-settings.ts';

export interface LlmCallOptions {
  agentId: string;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

export class LlmChannelUnavailableError extends Error {
  constructor() {
    super('LLM 渠道未配置');
  }
}

/**
 * 真实 LLM 调用（OpenAI 兼容 chat/completions）。
 * 优先读 settings.llmChannels[agentId]（设置面板可配），回退 .env.local 默认渠道；
 * 均未配置时抛 LlmChannelUnavailableError，由调用方降级 mock（design.md D9）。
 */
export async function callLlm(options: LlmCallOptions): Promise<string> {
  const channel = getSetting<Record<string, { baseUrl: string; apiKey: string; model: string }>>('llmChannels') ?? {};
  const perAgent = channel[options.agentId];
  const baseUrl = perAgent?.baseUrl || CHANNEL.llm.baseUrl;
  const apiKey = perAgent?.apiKey || CHANNEL.llm.apiKey;
  const model = options.model || perAgent?.model || CHANNEL.llm.model;

  if (!apiKey) {
    if (!hasLlmChannel()) throw new LlmChannelUnavailableError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content: options.user },
        ],
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
