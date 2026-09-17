/**
 * 时间格式化统一工具（原散落 5 处实现，2026-09-16 收敛）
 *
 * 抽取来源：
 *   - features/knowledge/HotView.tsx          fmtTime
 *   - features/status/TaskDetailView.tsx      fmtTime / fmtFull
 *   - features/observability/ObservabilityView.tsx  relTime / timeFmt
 *
 * 约定：入参为 ISO 字符串（或 null/undefined），无效值统一返回 '—'。
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** 「MM-DD HH:mm」——列表/卡片等紧凑场景（HotView、TaskDetailView 原实现一致） */
export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 「YYYY-MM-DD HH:mm」——需要年份的详细场景（TaskDetailView 事件流） */
export function fmtFull(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 「刚刚 / N 分钟前 / N 小时前 / N 天前」——最近活跃等相对时间（ObservabilityView） */
export function relTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 「MM-DD HH:mm」本地化格式（ObservabilityView timeFmt 原用 toLocaleString，统一为 fmtTime 等价输出） */
export const timeFmt = fmtTime;
