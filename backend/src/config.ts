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
  // 主管波波视觉审阅渠道（能识图的 API，默认独立于普通 LLM 渠道）
  supervisor: {
    baseUrl: process.env.SUPERVISOR_BASE_URL ?? '',
    apiKey: process.env.SUPERVISOR_API_KEY ?? '',
    model: process.env.SUPERVISOR_MODEL ?? 'gpt-5.5',
  },
};

/** 是否已配置真实 LLM 渠道 */
export function hasLlmChannel(): boolean {
  return Boolean(CHANNEL.llm.apiKey);
}

/** 是否已配置生图渠道 */
export function hasImageChannel(): boolean {
  return Boolean(CHANNEL.image.baseUrl && CHANNEL.image.apiKey);
}

/** 是否已配置主管视觉审阅渠道（波波识图） */
export function hasSupervisorChannel(): boolean {
  return Boolean(CHANNEL.supervisor.baseUrl && CHANNEL.supervisor.apiKey);
}
