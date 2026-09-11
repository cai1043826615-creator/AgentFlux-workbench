import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { useWorkbench, type ActionToast, type TaskWithMeta } from '../store/useWorkbench.tsx';

/**
 * 右下角 Toast 通知（意见12 + 意见1 重构 + 堆叠版 v3）：
 * - 触发：任务进入待确认（approvalQueue 新增）/ 任务完成归档（tasks 中 column 变为 done）
 * - 不自动关闭（移除 45s 淡出）；手动 × 关闭，或点击主卡 / action 按钮跳转对应任务并关闭
 * - Aceternity 风卡片：宽 500；底部右侧 action 按钮
 *   （待确认「去处理」紫 primary / 任务完成「查看」绿）
 * - 前后堆叠 v3（用户 2026-09-10 三点修订）：
 *   ① 点击才展开（鼠标悬停不再展开）；
 *   ② 展开后固定保持不回弹（再点空白收起）；
 *   ③ 顺序修正：最新一条在下面（底部右下角最完整），旧卡向上重叠只露顶边；
 *   超出上限只保留最新 5 条（FIFO，最早自动消除）
 */

export interface ToastItem {
  id: string;
  kind: 'approval' | 'done';
  taskId: number;
  title: string;
  stage: string;
}

const FADE_MS = 220; // 手动关闭淡出时长
const TOAST_W = 500; // 单卡宽度（用户指定 500px）
const TOAST_H = 136; // 单卡固定高度（与 index.css .qs-toast-stack .qs-toast 的 height 同步），堆叠重叠量以此计算
const TOAST_EDGE = 26; // 被遮挡的旧卡露出的顶部边缘高度（px）
const MAX_VISIBLE = 5; // 常驻上限（超出保留最新 5 条）

function stageText(stage: string): string {
  return WORKFLOW_STAGE_LABELS[stage] ?? stage;
}

/**
 * 单条 Toast 卡片：进入动画 + 手动 × 淡出关闭。
 * 点击行为：收起态（collapsed）点击 = 展开整叠；展开态点击 = 跳转任务并关闭该条。
 * depth=0 为最新（渲染在容器底部 = 视觉最下面）。
 */
function ToastCard({
  item,
  onDismiss,
  onOpen,
  onExpand,
  depth,
  collapsed,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  onOpen: (item: ToastItem) => void;
  onExpand: () => void;
  depth: number;
  collapsed: boolean;
}) {
  const [leaving, setLeaving] = useState(false);

  // 手动关闭：淡出动画结束后真正移除（不自动关闭，无定时器）
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onDismiss(item.id), FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, item.id, onDismiss]);

  const isApproval = item.kind === 'approval';
  const accent = isApproval ? 'var(--color-signal)' : 'var(--color-ok)';
  const behind = depth > 0;

  return (
    <div
      role="status"
      className={`qs-toast qs-clickable shrink-0 ${leaving ? 'leaving' : ''}`}
      style={
        {
          width: TOAST_W,
          zIndex: 100 - depth,
          // 堆叠间距：最新一张在底部全展开；旧卡向上重叠只露顶边（收起态由 .collapsed 消费）
          '--stack-mb': behind ? `${-(TOAST_H - TOAST_EDGE)}px` : '8px',
          '--stack-opacity': behind ? Math.max(0.55, 1 - depth * 0.13) : 1,
        } as React.CSSProperties
      }
      title={collapsed ? '点击展开通知列表' : `点击跳转任务 #${item.taskId}`}
      onClick={(e) => {
        e.stopPropagation();
        if (collapsed) onExpand();
        else onOpen(item);
      }}
    >
      {/* 主体：图标 + 标题 / 正文 / 阶段 */}
      <div className="flex items-start gap-2.5 px-5 pt-4 pb-2.5">
        <span aria-hidden="true" className="mt-1 shrink-0 text-[14px] leading-none" style={{ color: accent }}>
          {isApproval ? '●' : '✓'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold leading-tight" style={{ color: isApproval ? 'var(--color-signal-strong)' : 'var(--color-ok)' }}>
            {isApproval ? '待你确认' : '任务完成'}
          </div>
          <div className="qs-meta mt-1.5 truncate text-[13px] leading-snug" style={{ color: 'var(--color-ink-soft)' }}>
            #{item.taskId} {item.title}
          </div>
          <div className="qs-meta mt-0.5 text-[13px] leading-snug" style={{ color: 'var(--color-ink-faint)' }}>
            {stageText(item.stage)}
          </div>
        </div>
        <button
          type="button"
          className="qs-clickable shrink-0 px-1 py-0 text-[16px] leading-none opacity-50 transition-opacity hover:opacity-100"
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
      {/* Aceternity 风 action 按钮行：底部分隔线 + 右侧按钮（点击 = 跳转 + 关闭该条） */}
      <div className="flex justify-end border-t px-5 py-3" style={{ borderColor: 'var(--color-line)' }}>
        <button
          type="button"
          className="qs-clickable shrink-0 rounded-[4px] px-5 py-2 text-[13px] font-semibold leading-none transition hover:brightness-95 active:translate-y-px"
          style={{ background: accent, color: '#fff' }}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(item);
          }}
        >
          {isApproval ? '去处理' : '查看'}
        </button>
      </div>
    </div>
  );
}

/** Toast 宿主：挂在 App 根，订阅 useWorkbench 数据源 */
export function ToastHost() {
  const { tasks, approvalQueue, openTask } = useWorkbench();
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const seenApproval = useRef<Set<string>>(new Set());
  const seenDone = useRef<Set<number>>(new Set());
  const tasksRef = useRef<TaskWithMeta[] | null>(null);

  const dismiss = useCallback((id: string) => {
    setQueue((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const enqueue = useCallback((item: Omit<ToastItem, 'id'>) => {
    const id = `${item.kind}-${item.taskId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // 常驻上限 MAX_VISIBLE：超出时最先出现的自动消除（FIFO 淘汰，旧卡不复活）
    setQueue((prev) => [...prev, { ...item, id }].slice(-MAX_VISIBLE));
  }, []);

  // 触发1：任务进入待确认（approvalQueue 出现新条目）
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

  // 点击 Toast / action 按钮：跳转任务详情并关闭该条
  const open = useCallback(
    (item: ToastItem) => {
      openTask(item.taskId);
      dismiss(item.id);
    },
    [openTask, dismiss],
  );

  if (queue.length === 0) return null;

  return (
    <div
      className={`qs-toast-stack fixed bottom-4 right-4 z-[70]${expanded ? '' : ' collapsed'}`}
      aria-live="polite"
      onClick={() => setExpanded((v) => !v)}
    >
      {queue.map((it, idx) => {
        // depth：0 = 最新（渲染在容器底部 = 视觉最下面），越大越旧越靠上
        const depth = queue.length - 1 - idx;
        return (
          <ToastCard
            key={it.id}
            item={it}
            onDismiss={dismiss}
            onOpen={open}
            onExpand={() => setExpanded(true)}
            depth={depth}
            collapsed={!expanded}
          />
        );
      })}
    </div>
  );
}

/**
 * 通用动作反馈 Toast 栈（Step 9）：归档 / 恢复 / 采纳 / 打回 / 重试 / 保存设置 等轻量确认。
 * 与右下角任务 Toast（ToastHost）分区——本栈固定在底部居中，不抢占其位置。
 */
function ActionToastCard({ toast, onDismiss }: { toast: ActionToast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (!toast.duration) return;
    const tm = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(tm);
  }, [toast.duration, toast.id, onDismiss]);

  const accent =
    toast.tone === 'ok'
      ? 'var(--color-ok)'
      : toast.tone === 'signal'
        ? 'var(--color-signal)'
        : toast.tone === 'no'
          ? 'var(--color-danger)'
          : 'var(--color-ink-soft)';

  return (
    <div
      className="qs-card flex items-center gap-3 rounded-[4px] px-3 py-2 text-[13px] shadow-sm"
      style={{ borderLeft: `3px solid ${accent}`, minWidth: 240, maxWidth: 380 }}
      role="status"
    >
      <span className="flex-1 leading-snug" style={{ color: 'var(--color-ink)' }}>
        {toast.message}
      </span>
      {toast.actionLabel ? (
        <button
          type="button"
          className="qs-clickable shrink-0 font-semibold"
          style={{ color: accent }}
          onClick={() => {
            toast.onAction?.();
            onDismiss(toast.id);
          }}
        >
          {toast.actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="qs-clickable shrink-0 px-1 text-[15px] leading-none opacity-50 transition-opacity hover:opacity-100"
        style={{ color: 'var(--color-ink-soft)' }}
        aria-label="关闭"
        onClick={() => onDismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

export function ActionToastStack() {
  const { actionToasts, dismissToast } = useWorkbench();
  if (actionToasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
      {actionToasts.map((t) => (
        <ActionToastCard key={t.id} toast={t} onDismiss={dismissToast} />
      ))}
    </div>
  );
}
