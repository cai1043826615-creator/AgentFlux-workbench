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

/**
 * 「刚刚 / N 分钟前 / N 小时前 / 昨天 HH:mm / N 天前 / MM-DD」——相对时间
 * （原 TaskListView.fmtRelative 的「昨天 HH:mm」口径于 2026-09-17 并入，消除两套实现分叉）
 */
export function relTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  const p = (n: number) => String(n).padStart(2, '0');
  if (diff < min) return '刚刚';
  if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
  if (diff < 2 * day) return `昨天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return `${d.getMonth() + 1}-${d.getDate()}`;
}

/** 「MM-DD HH:mm」本地化格式（ObservabilityView timeFmt 原用 toLocaleString，统一为 fmtTime 等价输出） */
export const timeFmt = fmtTime;
