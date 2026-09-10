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

/** 解析 data URL → { mime, bytes, ext }；非 data URL 返回 null */
function parseDataUrl(dataUrl: string): { mime: string; bytes: Buffer; ext: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const extMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const ext = extMap[mime] ?? 'png';
  return { mime, bytes: Buffer.from(m[3], m[2] ? 'base64' : 'utf8'), ext };
}

/**
 * 真实生图调用（OpenAI 兼容）。
 * - 有参考图 refImage → POST /images/edits（multipart 图生图，产品外观与参考图保持一致）
 * - 无参考图 → POST /images/generations（文生图）
 * 渠道：settings.imageChannel（设置面板可配）→ .env.local 默认（dsh-imagegen 默认渠道）。
 * 返回 dataURL（b64_json）或原始 url。
 */
export async function generateImage(prompt: string, size = '1024x1024', refImage?: string): Promise<string> {
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
    const base = baseUrl.replace(/\/$/, '');
    const ref = refImage ? parseDataUrl(refImage) : null;

    let res: Response;
    if (ref) {
      // 图生图：multipart /images/edits（gpt-image 官方协议；参考图作为 image 上传）
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', prompt);
      fd.append('image', new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }), `ref.${ref.ext}`);
      fd.append('n', '1');
      fd.append('size', size);
      res = await fetch(`${base}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
        signal: controller.signal,
      });
    } else {
      res = await fetch(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt, n: 1, size }),
        signal: controller.signal,
      });
    }

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
