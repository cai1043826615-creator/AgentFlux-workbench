import type { FastifyInstance } from 'fastify';
import { all, get, run } from '../db/client.ts';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // 读取设置（编排开关 / LLM / 生图渠道 —— 渠道密钥仅存本机）
  app.get('/api/settings', async () => {
    const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  });

  // 更新设置
  app.put<{ Body: Record<string, unknown> }>('/api/settings', async (req) => {
    for (const [key, value] of Object.entries(req.body ?? {})) {
      const exists = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', [key]);
      const json = JSON.stringify(value);
      if (exists) {
        run('UPDATE settings SET value = ? WHERE key = ?', [json, key]);
      } else {
        run('INSERT INTO settings (key,value) VALUES (?,?)', [key, json]);
      }
    }
    const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value);
      } catch {
        out[r.key] = r.value;
      }
    }
    return out;
  });
}
