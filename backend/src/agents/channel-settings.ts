import { get, run } from '../db/client.ts';

/** 读设置表（JSON 值） */
export function getSetting<T>(key: string): T | undefined {
  const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function setSetting(key: string, value: unknown): void {
  const exists = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', [key]);
  if (exists) {
    run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify(value), key]);
  } else {
    run('INSERT INTO settings (key,value) VALUES (?,?)', [key, JSON.stringify(value)]);
  }
}
