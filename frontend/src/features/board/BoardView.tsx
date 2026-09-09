import type { BoardColumn } from '@workbench/shared';
import { WORKFLOW_STAGE_KEYS, WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { useWorkbench, type TaskWithMeta } from '../../store/useWorkbench.tsx';
import { Avatar, Btn, Empty, Spinner } from '../../components/ui.tsx';

/** 看板列定义（对齐线框 columns） */
const COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: 'planned', label: '规划中' },
  { key: 'progress', label: '进行中' },
  { key: 'awaiting', label: '待确认' },
  { key: 'done', label: '已完成' },
];

function stageText(task: TaskWithMeta): string {
  return task.stageLabel || WORKFLOW_STAGE_LABELS[task.stage] || task.stage;
}

/** 阶段序号（0 基），供 flowbar 用 */
function stageIdxOf(task: TaskWithMeta): number {
  const i = WORKFLOW_STAGE_KEYS.indexOf(task.stage as (typeof WORKFLOW_STAGE_KEYS)[number]);
  return i < 0 ? 0 : i;
}

/** 状态 tag（对齐线框 tag：warn 待拍板 / ok 已归档 / work 进行中） */
function Tag({ task }: { task: TaskWithMeta }) {
  if (task.column === 'awaiting') {
    return <span className="qs-badge warn">{`待你拍板 · ${stageText(task)}`}</span>;
  }
  if (task.column === 'done') return <span className="qs-badge ok">✓ 已归档</span>;
  if (task.column === 'progress') return <span className="qs-badge">进行中 · {stageText(task)}</span>;
  return <span className="qs-badge">需求对齐</span>;
}

/** 看板卡片（对齐线框 tcard：#id 标题 / stageNote / tag / 负责人 / flowbar） */
function TaskCard({
  task,
  onOpen,
  onConfirm,
}: {
  task: TaskWithMeta;
  onOpen: (task: TaskWithMeta) => void;
  onConfirm: (id: number) => void;
}) {
  return (
    <article
      className="qs-card relative cursor-pointer p-3 transition-colors hover:border-[var(--color-line-strong)]"
      style={task.column === 'awaiting' ? { borderColor: 'var(--color-warn)' } : undefined}
      onClick={() => onOpen(task)}
      title="查看详情"
    >
      <div className="flex items-baseline gap-1.5 pr-1 mb-1.5">
        <span className="qs-meta tabular shrink-0">#{task.id}</span>
        <h4 className="truncate font-display text-[13px] font-semibold leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
          {task.title}
        </h4>
      </div>

      {task.stageNote ? (
        <p className="qs-meta mb-2 leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
          {task.stageNote}
        </p>
      ) : null}

      <Tag task={task} />

      {/* 6 段 flowbar（对齐线框 flowbar；意见5 视觉降级版，颜色语义与详情页一致：完成=绿 / 当前=黑 / 未到=灰） */}
      <div className="mt-2 flex gap-[3px]">
        {WORKFLOW_STAGE_KEYS.map((k, i) => (
          <span
            key={k}
            className="h-[3px] flex-1 rounded-full"
            style={{
              background:
                i < stageIdxOf(task) || task.column === 'done'
                  ? 'var(--color-ok)'
                  : i === stageIdxOf(task)
                    ? 'var(--color-ink)'
                    : 'var(--color-line)',
            }}
          />
        ))}
      </div>

      {/* 负责人 */}
      <span
        className="qs-meta mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5"
        style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid var(--color-line)' }}
      >
        <Avatar name={task.ownerName || '待'} size={14} /> {task.ownerName || '待分配'}
      </span>

      {/* 快捷操作 */}
      <div className="mt-2.5 flex gap-2" onClick={(e) => e.stopPropagation()}>
        {task.column === 'planned' ? (
          <Btn size="sm" variant="primary" onClick={() => onConfirm(task.id)}>
            确认开工
          </Btn>
        ) : null}
        {task.column === 'progress' ? (
          <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-ink-faint)' }}>
            <span className="qs-dot signal busy" />
            {stageText(task)} 推进中
          </span>
        ) : null}
        {task.column === 'awaiting' ? (
          <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-warn)' }}>
            <span className="qs-dot signal" />
            审批已并入「内容交付」页
          </span>
        ) : null}
        {task.column === 'done' ? (
          <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-ink-faint)' }}>
            <span className="qs-dot ok" />
            已交付 · 已归档
          </span>
        ) : null}
      </div>
    </article>
  );
}

/** 任务看板（对齐线框 renderBoard：标题行 + ＋新建任务 + 四列） */
export function BoardView({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const { tasks, loading, confirmTask, openTask } = useWorkbench();

  if (loading && tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="加载任务中…" />
      </div>
    );
  }

  const handleOpen = (task: TaskWithMeta) => {
    onOpen(task.id);
    openTask(task.id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题行（对齐线框 board-title-row） */}
      <div className="mb-3.5 flex items-center gap-3">
        <span className="font-display text-xl font-bold">任务看板</span>
        <span className="qs-meta hidden sm:inline" style={{ color: 'var(--color-ink-faint)' }}>
          {tasks.length}个任务
        </span>
        <div className="flex-1" />
        <Btn onClick={onNew}>＋ 新建任务</Btn>
      </div>

      {tasks.length === 0 ? (
        <Empty text="暂无任务，点击右上角「＋ 新建任务」" />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
          {COLUMNS.map((col) => {
            const list = tasks.filter((t) => t.column === col.key);
            return (
              <section key={col.key} className="qs-card flex min-w-[248px] flex-1 flex-col overflow-hidden">
                <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: 'var(--color-line)' }}>
                  <span className="text-[13px] font-medium">{col.label}</span>
                  <span className="qs-meta tabular">{list.length}</span>
                </header>
                <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
                  {list.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={handleOpen} onConfirm={(id) => void confirmTask(id)} />
                  ))}
                  {list.length === 0 ? (
                    <div className="qs-meta py-6 text-center" style={{ color: 'var(--color-ink-faint)' }}>
                      （空）
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
