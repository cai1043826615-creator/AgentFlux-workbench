/**
 * 任务筛选与排序（B5 · 6.x UI 口径，客户端在 store 全量数据上执行）：
 * 与后端 GET /api/tasks 查询语义一致 —— 维度间「与」、平台多值「或」、
 * from/to 创建时间闭区间、q 匹配标题或描述、sort/order。
 */
import type { TaskSortKey, TaskSortOrder } from '@workbench/shared';
import type { TaskWithMeta } from './taskMerge.ts';

export interface TaskFilters {
  platforms: string[];
  owner: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  q: string;
  sort: TaskSortKey;
  order: TaskSortOrder;
}

export const DEFAULT_FILTERS: TaskFilters = { platforms: [], owner: '', from: '', to: '', q: '', sort: 'createdAt', order: 'desc' };

export function isFilterActive(f: TaskFilters): boolean {
  return f.platforms.length > 0 || Boolean(f.owner) || Boolean(f.from) || Boolean(f.to) || Boolean(f.q.trim());
}

/** 归档任务不参与主视图（「已归档任务」弹窗单独查看）；返回排序后的未归档任务 */
export function applyTaskFilters(all: TaskWithMeta[], f: TaskFilters): TaskWithMeta[] {
  let list = all.filter((t) => !t.archived);
  if (f.platforms.length > 0) {
    list = list.filter((t) => f.platforms.some((p) => (t.platforms ?? []).includes(p) || t.platform === p));
  }
  if (f.owner) list = list.filter((t) => t.ownerName === f.owner);
  const fromMs = f.from ? new Date(`${f.from}T00:00:00`).getTime() : NaN;
  const toMs = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : NaN;
  if (!Number.isNaN(fromMs)) list = list.filter((t) => new Date(t.createdAt).getTime() >= fromMs);
  if (!Number.isNaN(toMs)) list = list.filter((t) => new Date(t.createdAt).getTime() <= toMs);
  const q = f.q.trim().toLowerCase();
  if (q) list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));

  const dir = f.order === 'asc' ? 1 : -1;
  const ts = (t: TaskWithMeta) => (t.updatedAt ? new Date(t.updatedAt).getTime() : new Date(t.createdAt).getTime());
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (f.sort === 'updatedAt') cmp = ts(a) - ts(b);
    else if (f.sort === 'progress') cmp = a.progress - b.progress;
    else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return cmp * dir || b.id - a.id;
  });
}
