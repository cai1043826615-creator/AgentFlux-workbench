import { useEffect, useMemo, useRef } from 'react';
import { WORKFLOW_STAGE_KEYS, WORKFLOW_STAGE_LABELS, type Deliverable, type TaskEvent, type TaskEventType } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Badge, Empty, Spinner } from '../../components/ui.tsx';
import { parseCopy, parseImages } from '../../lib/api.ts';
import { ContentDeliveryView } from '../content/ContentDeliveryView.tsx';

const EVENT_LABELS: Record<TaskEventType, string> = {
  TASK_CREATED: '创建任务',
  TASK_CONFIRMED: '确认开工',
  STAGE_STARTED: '进入阶段',
  STAGE_COMPLETED: '阶段完成',
  APPROVED: '采纳',
  REJECTED: '打回',
  REVIEW_PASSED: '校对放行',
  REVIEW_ROLLBACK: '校对回退',
  SUB_TASK_COMPLETE: '子任务完成',
  DELIVERABLE_DECIDED: '交付物定案',
};

const IMG_STAGE_LABELS: Record<string, string> = {
  'main-image': '主图设计',
  'detail-image': '详情图设计',
};

function statusBadge(d: Deliverable) {
  if (d.status === 'approved') return <Badge tone="ok">已采纳</Badge>;
  if (d.status === 'rejected') return <Badge tone="no">已打回</Badge>;
  return <Badge tone="warn">待定</Badge>;
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtFull(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function eventStage(ev: TaskEvent): string {
  const s = ev.payload?.stage;
  return typeof s === 'string' ? WORKFLOW_STAGE_LABELS[s] ?? s : '';
}

function eventNote(ev: TaskEvent): string {
  const n = ev.payload?.note;
  return typeof n === 'string' && n ? n : '';
}

/** 活动日志（对齐线框 .log） */
function EventTimeline({ events }: { events: TaskEvent[] }) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [events],
  );
  if (sorted.length === 0) {
    return (
      <div className="qs-meta py-6 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无活动记录</div>
    );
  }
  return (
    <div className="relative space-y-3 border-l pl-4" style={{ borderColor: 'var(--color-line)' }}>
      {sorted.map((ev) => {
        const stage = eventStage(ev);
        const note = eventNote(ev);
        return (
          <div key={ev.id} className="relative">
            <span className="absolute -left-[21.5px] top-1 h-[9px] w-[9px] rounded-full" style={{ background: 'var(--color-signal)' }} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium">{EVENT_LABELS[ev.type]}</span>
              <span className="qs-meta shrink-0">{fmtTime(ev.createdAt)}</span>
            </div>
            {stage || note ? (
              <div className="qs-meta mt-0.5 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
                {[stage, note].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** 交付物概览（文案包 + 图片按阶段） */
function DeliverablesOverview({ deliverables }: { deliverables: Deliverable[] }) {
  if (deliverables.length === 0) {
    return (
      <div className="qs-meta py-6 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无交付物</div>
    );
  }
  const copyDel = deliverables.find((d) => d.kind === 'copy');
  const imgDels = deliverables.filter((d) => d.kind === 'image');
  return (
    <div className="space-y-2.5">
      {copyDel ? (
        <div className="flex items-start justify-between gap-3 border-b pb-2.5" style={{ borderColor: 'var(--color-line)' }}>
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-2">
              <span className="text-[12px] font-medium">卖点文案</span>
              {statusBadge(copyDel)}
            </div>
            <p className="text-[13px] leading-snug">
              {(() => {
                const copy = parseCopy(copyDel);
                if (!copy) return '文案包（内容待解析）';
                return `${copy.title} · 卖点 ${copy.points.length} 条`;
              })()}
            </p>
          </div>
          <span className="qs-meta shrink-0">v{copyDel.version}</span>
        </div>
      ) : null}
      {imgDels.map((d) => {
        const imgs = parseImages(d);
        const total = imgs?.length ?? 0;
        const ok = imgs?.filter((i) => i.status === 'approved').length ?? 0;
        const rej = imgs?.filter((i) => i.status === 'rejected').length ?? 0;
        const pend = imgs?.filter((i) => i.status === 'pending').length ?? 0;
        return (
          <div key={d.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[12px] font-medium">{IMG_STAGE_LABELS[d.stage] ?? d.stage}</span>
                {statusBadge(d)}
              </div>
              <p className="text-[13px] leading-snug" style={{ color: 'var(--color-ink-soft)' }}>
                {imgs ? `共 ${total} 张 · 已采纳 ${ok} · 待定 ${pend} · 打回 ${rej}` : '图片（内容待解析）'}
              </p>
            </div>
            <span className="qs-meta shrink-0">v{d.version}</span>
          </div>
        );
      })}
    </div>
  );
}

/** 任务详情（对齐线框 renderTask：back + task-head + stages + tabs + 属性面板 / 内容交付） */
export function TaskDetailView({
  taskId,
  onBack,
  onNotFound,
}: {
  taskId: number;
  onBack: () => void;
  onNotFound: () => void;
}) {
  const { tasks, eventsByTask, deliverablesByTask, openTask, taskTab, setTaskTab } = useWorkbench();

  // 新打开任务时默认落在「任务详情」tab（key=taskId 重挂载时执行一次）
  const firstTabRef = useRef(true);
  useEffect(() => {
    if (firstTabRef.current) {
      setTaskTab('detail');
      firstTabRef.current = false;
    }
    openTask(taskId);
  }, [taskId, openTask, setTaskTab]);

  const task = tasks.find((t) => t.id === taskId);

  useEffect(() => {
    if (tasks.length > 0 && !task) onNotFound();
  }, [task, tasks.length, onNotFound]);

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="加载任务…" />
      </div>
    );
  }

  const awaiting = task.column === 'awaiting';
  const done = task.column === 'done';
  const stageIdx = WORKFLOW_STAGE_KEYS.indexOf(task.stage as (typeof WORKFLOW_STAGE_KEYS)[number]);

  return (
    <div className="space-y-4">
      {/* back */}
      <button type="button" className="qs-meta" style={{ color: 'var(--color-ink-soft)' }} onClick={onBack}>
        ← 返回任务列表
      </button>

      {/* task-head（对齐线框 th-1/2/3，QS 编辑性大标题） */}
      <div>
        <div className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>
          #{task.id} {task.title} · 电商新品上架 · 由你创建
        </div>
        <h2 className="font-display w-full text-[24px] font-bold leading-[1.15] md:text-[28px]" style={{ fontFamily: 'var(--font-display)' }}>
          {task.title}
        </h2>
        <div className="qs-meta mt-1.5" style={{ color: 'var(--color-ink-soft)' }}>
          {task.description || '新品上架全套物料'} · 目标平台：{task.platform || '—'}
        </div>
      </div>

      {/* stages（对齐线框 6 阶段条 + 拍板标记 + 箭头） */}
      <div className="flex items-center gap-1">
        {WORKFLOW_STAGE_KEYS.map((k, i) => (
          <div key={k} className="flex items-center gap-1">
            <span
              className="qs-meta rounded px-2 py-1 text-[12px]"
              style={{
                background: done || i < stageIdx ? 'rgba(0,0,0,0.05)' : i === stageIdx ? 'var(--color-ink)' : 'transparent',
                color: i === stageIdx ? '#fff' : i < stageIdx || done ? 'var(--color-ok)' : 'var(--color-ink-faint)',
                border: `1px solid ${i === stageIdx ? 'var(--color-ink)' : 'var(--color-line)'}`,
                position: 'relative',
              }}
            >
              {WORKFLOW_STAGE_LABELS[k]}
              {(k === 'copy' || k === 'main-image') && <span className="qs-meta ml-1" style={{ color: 'var(--color-warn)' }}>拍板</span>}
            </span>
            {i < WORKFLOW_STAGE_KEYS.length - 1 ? <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>›</span> : null}
          </div>
        ))}
      </div>

      {/* tabs（对齐线框 tabs；QS 焦点信号） */}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--color-line)' }}>
        <button
          type="button"
          className={`px-3 py-2 text-[13px] transition-colors ${taskTab === 'detail' ? 'font-semibold' : 'opacity-55 hover:opacity-100'}`}
          style={{ borderBottom: taskTab === 'detail' ? '2px solid var(--color-signal)' : '2px solid transparent', color: taskTab === 'detail' ? 'var(--color-ink)' : 'var(--color-ink-soft)' }}
          onClick={() => setTaskTab('detail')}
        >
          任务详情
        </button>
        <button
          type="button"
          className={`px-3 py-2 text-[13px] transition-colors ${taskTab === 'deliver' ? 'font-semibold' : 'opacity-55 hover:opacity-100'}`}
          style={{ borderBottom: taskTab === 'deliver' ? '2px solid var(--color-signal)' : '2px solid transparent', color: taskTab === 'deliver' ? 'var(--color-ink)' : 'var(--color-ink-soft)' }}
          onClick={() => setTaskTab('deliver')}
        >
          内容交付{awaiting ? ' · 审批' : ''}
        </button>
      </div>

      {taskTab === 'deliver' ? (
        <ContentDeliveryView taskId={taskId} />
      ) : (
        /* status-grid：内容区 + 280 属性面板 */
        <div className="flex gap-4">
          <div className="min-w-0 flex-1 space-y-4">
            {/* 待拍板横幅 / 当前阶段卡（对齐线框；QS 焦点信号） */}
            {awaiting ? (
              <div className="rounded-[4px] border px-3 py-2.5" style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-soft)' }}>
                <div className="mb-1 text-[12px] font-bold" style={{ color: 'var(--color-signal-strong)' }}>
                  待你拍板 · {task.stageLabel || WORKFLOW_STAGE_LABELS[task.stage]} #{task.id}
                </div>
                <div className="mb-2 text-[13px]" style={{ color: 'var(--color-ink-soft)' }}>
                  {task.ownerName || 'Agent'} 已完成输出，请到「内容交付」页看着成品直接处理（审批已并入该页）。
                </div>
                <button type="button" className="qs-btn sm primary" onClick={() => setTaskTab('deliver')}>
                  去内容交付页审批
                </button>
              </div>
            ) : (
              <div className="rounded border px-3 py-2.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-canvas)' }}>
                <div className="mb-1 text-[12px] font-bold">当前阶段：{task.stageLabel || WORKFLOW_STAGE_LABELS[task.stage]}</div>
                <div className="text-[13px]" style={{ color: 'var(--color-ink-soft)' }}>
                  {task.stageNote || (done ? '已交付 · 已归档' : '引擎推进中…')}
                </div>
              </div>
            )}

            {/* 活动日志 */}
            <div className="qs-card p-4">
              <h3 className="font-display mb-3 text-[15px] font-semibold">活动日志</h3>
              <EventTimeline events={eventsByTask[task.id] ?? []} />
            </div>

            {/* 交付物概览 */}
            <div className="qs-card p-4">
              <h3 className="font-display mb-3 text-[15px] font-semibold">交付物概览</h3>
              <DeliverablesOverview deliverables={deliverablesByTask[task.id] ?? []} />
            </div>
          </div>

          {/* 属性面板（280px，对齐线框 side-panel） */}
          <aside className="qs-card h-fit w-[280px] shrink-0 p-4">
            <h3 className="font-display mb-3 text-[15px] font-semibold">属性</h3>
            <div className="space-y-2.5">
              {[
                ['类型', '电商新品上架'],
                ['当前阶段', WORKFLOW_STAGE_LABELS[task.stage] ?? task.stage],
                ['进度', `${task.progress}%`],
                ['负责人', task.ownerName || '—'],
                ['创建人', task.createdBy || '—'],
                ['状态', task.column === 'planned' ? '规划中' : task.column === 'progress' ? '进行中' : task.column === 'awaiting' ? '待确认' : '已完成'],
                ['创建时间', fmtFull(task.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-b-0" style={{ borderColor: 'var(--color-line)' }}>
                  <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{k}</span>
                  <span className="text-right text-[13px] font-medium">{v}</span>
                </div>
              ))}
            </div>
            {task.description ? (
              <div className="qs-meta mt-3 border-t pt-2.5 leading-relaxed" style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-faint)' }}>
                {task.description}
              </div>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
