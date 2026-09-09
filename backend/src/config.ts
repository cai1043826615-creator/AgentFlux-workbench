import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 加载本机渠道配置（backend/.env.local，含密钥，仅本机）
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '../.env.local');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile?.(envPath);
  } catch {
    /* .env.local 可选 */
  }
}

export const CHANNEL = {
  llm: {
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  },
  image: {
    baseUrl: process.env.IMAGE_BASE_URL ?? '',
    apiKey: process.env.IMAGE_API_KEY ?? '',
    model: process.env.IMAGE_MODEL ?? 'gpt-image-2',
  },
};

/** 是否已配置真实 LLM 渠道 */
export function hasLlmChannel(): boolean {
  return Boolean(CHANNEL.llm.apiKey);
}

/** 是否已配置真实生图渠道 */
export function hasImageChannel(): boolean {
  return Boolean(CHANNEL.image.baseUrl && CHANNEL.image.apiKey);
}
