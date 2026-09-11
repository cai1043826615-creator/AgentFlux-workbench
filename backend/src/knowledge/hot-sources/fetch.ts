/**
 * 多源拉取公共工具（hot-intel B10）：
 * - 带超时的 HTTP 文本获取（AbortController，零新增依赖）
 * - 空响应防御（调研报告 5.3：实测存在「HTTP 200 + body 长度 0」的端，解析前校验，按源失败处理）
 */

/** HTTP 错误（聚合层据此降级该源并给出可读原因） */
export class HotFetchError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HOT_UPSTREAM_ERROR') {
    super(message);
    this.name = 'HotFetchError';
    this.code = code;
  }
}

/** 提取原始 HTML（重定向跟随；超时/非 2xx/空 body → 抛 HotFetchError） */
export async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new HotFetchError(`热点源 ${url} 返回 HTTP ${res.status}`, 'HOT_UPSTREAM_ERROR');
    }
    const text = await res.text();
    if (!text || text.trim().length === 0) {
      // 空响应防御：状态码正常但 body 为空 → 按源失败处理
      throw new HotFetchError(`热点源 ${url} 返回空响应`, 'HOT_EMPTY_RESPONSE');
    }
    return text;
  } catch (err) {
    if (err instanceof HotFetchError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new HotFetchError(`热点源 ${url} 拉取失败：${reason}`, 'HOT_UPSTREAM_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

/** 提取 JSON（空响应/非法 JSON → 抛 HotFetchError，避免 res.json() 抛未归一化的 SyntaxError） */
export async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const text = await fetchText(url, timeoutMs);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HotFetchError(`热点源 ${url} 返回非法 JSON`, 'HOT_BAD_JSON');
  }
}

/** 清洗字符串（压空白） */
export function compact(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}
