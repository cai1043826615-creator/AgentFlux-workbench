import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { useWorkbench, type TaskWithMeta } from '../store/useWorkbench.tsx';

/**
 * 右下角 Toast 通知（意见12）：
 * - 触发：任务进入待拍板（approvalQueue 新增）/ 任务完成归档（tasks 中 column 变为 done）
 * - 队列依次显示，最多同时 3 条；45s 自动淡出，可手动 × 关闭
 * - 点击 Toast 跳转对应任务详情（openTask）
 */

export interface ToastItem {
  id: string;
  kind: 'approval' | 'done';
  taskId: number;
  title: string;
  stage: string;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 45_000;
const FADE_MS = 220;

function stageText(stage: string): string {
  return WORKFLOW_STAGE_LABELS[stage] ?? stage;
}

/** 单条 Toast 卡片：进入动画 + 45s 自动淡出 + 手动关闭 + 点击跳转 */
function ToastCard({
  item,
  onDismiss,
  onOpen,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  onOpen: (item: ToastItem) => void;
}) {
  const [leaving, setLeaving] = useState(false);

  // 45s 后进入淡出
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, []);

  // 淡出动画结束后真正移除
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onDismiss(item.id), FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, item.id, onDismiss]);

  const isApproval = item.kind === 'approval';

  return (
    <div
      role="status"
      className={`qs-toast qs-clickable ${leaving ? 'leaving' : ''}`}
      style={{ width: 300 }}
      title={`点击跳转任务 #${item.taskId}`}
      onClick={() => onOpen(item)}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span
          aria-hidden="true"
          className="mt-[3px] shrink-0 text-[12px] leading-none"
          style={{ color: isApproval ? 'var(--color-signal)' : 'var(--color-ok)' }}
        >
          {isApproval ? '●' : '✓'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold leading-tight" style={{ color: isApproval ? 'var(--color-signal-strong)' : 'var(--color-ok)' }}>
            {isApproval ? '待你拍板' : '任务完成'}
          </div>
          <div className="qs-meta mt-1 truncate leading-snug" style={{ color: 'var(--color-ink-soft)' }}>
            #{item.taskId} {item.title}
          </div>
          <div className="qs-meta mt-0.5 leading-snug" style={{ color: 'var(--color-ink-faint)' }}>
            {stageText(item.stage)}
          </div>
        </div>
        <button
          type="button"
          className="qs-clickable shrink-0 px-0.5 py-0 text-[13px] leading-none opacity-50 transition-opacity hover:opacity-100"
          style={{ color: 'var(--color-ink-soft)' }}
          title="关闭"
          aria-label="关闭通知"
          onClick={(e) => {
            e.stopPropagation();
            setLeaving(true);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Toast 宿主：挂在 App 根，订阅 useWorkbench 数据源 */
export function ToastHost() {
  const { tasks, approvalQueue, openTask } = useWorkbench();
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const seenApproval = useRef<Set<string>>(new Set());
  const seenDone = useRef<Set<number>>(new Set());
  const tasksRef = useRef<TaskWithMeta[] | null>(null);

  const dismiss = useCallback((id: string) => {
    setQueue((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const enqueue = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `${item.kind}-${item.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setQueue((prev) => [...prev, { ...item, id }]);
  }, []);

  // 触发1：任务进入待拍板（approvalQueue 出现新条目）
  useEffect(() => {
    const titleById = new Map(tasks.map((t) => [t.id, t.title] as const));
    for (const a of approvalQueue) {
      const key = `${a.taskId}:${a.stage}`;
      if (seenApproval.current.has(key)) continue;
      seenApproval.current.add(key);
      enqueue({ kind: 'approval', taskId: a.taskId, stage: a.stage, title: titleById.get(a.taskId) ?? a.title });
    }
  }, [approvalQueue, tasks, enqueue]);

  // 触发2：任务完成归档（column 变为 done；首快照仅作基线，不弹历史归档）
  useEffect(() => {
    const prev = tasksRef.current;
    tasksRef.current = tasks;
    if (!prev) return;
    const prevColumnById = new Map(prev.map((t) => [t.id, t.column] as const));
    for (const t of tasks) {
      if (t.column !== 'done' || seenDone.current.has(t.id)) continue;
      if (prevColumnById.has(t.id) && prevColumnById.get(t.id) !== 'done') {
        seenDone.current.add(t.id);
        enqueue({ kind: 'done', taskId: t.id, stage: t.stage, title: t.title });
      }
    }
  }, [tasks, enqueue]);

  // 点击 Toast：跳转任务详情并关闭该条
  const open = useCallback(
    (item: ToastItem) => {
      openTask(item.taskId);
      dismiss(item.id);
    },
    [openTask, dismiss],
  );

  if (queue.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2" aria-live="polite">
      {queue.slice(0, MAX_VISIBLE).map((it) => (
        <ToastCard key={it.id} item={it} onDismiss={dismiss} onOpen={open} />
      ))}
    </div>
  );
}
