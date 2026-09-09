import { CHANNEL, hasImageChannel } from '../config.ts';
import { getSetting } from './channel-settings.ts';

export interface ImageChannelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ImageChannelUnavailableError extends Error {
  constructor() {
    super('生图渠道未配置');
  }
}

/**
 * 真实生图调用（OpenAI 兼容 /images/generations，文生图）。
 * 渠道：settings.imageChannel（设置面板可配）→ .env.local 默认（dsh-imagegen 默认渠道）。
 * 返回 dataURL（b64_json）或原始 url。
 */
export async function generateImage(prompt: string, size = '1024x1024'): Promise<string> {
  const channel = getSetting<ImageChannelConfig | null>('imageChannel') ?? null;
  const baseUrl = channel?.baseUrl || CHANNEL.image.baseUrl;
  const apiKey = channel?.apiKey || CHANNEL.image.apiKey;
  const model = channel?.model || CHANNEL.image.model;

  if (!baseUrl || !apiKey) {
    if (!hasImageChannel()) throw new ImageChannelUnavailableError();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, n: 1, size }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`生图 HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (!item) throw new Error('生图响应无数据');
    if (item.b64_json) {
      return `data:image/png;base64,${item.b64_json}`;
    }
    if (item.url) return item.url;
    throw new Error('生图响应缺少图片数据');
  } finally {
    clearTimeout(timer);
  }
}
