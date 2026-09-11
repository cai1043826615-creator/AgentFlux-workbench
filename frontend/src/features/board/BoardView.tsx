import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardColumn } from '@workbench/shared';
import { APPROVAL_POINT_STAGES, WORKFLOW_STAGE_KEYS, WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { useWorkbench, type TaskWithMeta } from '../../store/useWorkbench.tsx';
import { applyTaskFilters } from '../../lib/taskFilters.ts';
import { Avatar, Btn, Empty, Spinner } from '../../components/ui.tsx';
import { ArchivedTasksModal } from './ArchivedTasksModal.tsx';
import { DeliverableSearch, KbInvalidBadge, TaskFilterBar, TaskListTable } from './TaskListView.tsx';
import { useDownloadPackage } from '../../lib/useDownloadPackage.ts';

/** 看板列定义（对齐线框 columns） */
const COLUMNS: { key: BoardColumn; label: string }[] = [
  { key: 'planned', label: '规划中' },
  { key: 'progress', label: '进行中' },
  { key: 'awaiting', label: '待确认' },
  { key: 'done', label: '已完成' },
];

function stageText(task: TaskWithMeta): string {
  // 中文映射优先：WS 推送路径可能把 stageLabel 覆盖为英文 stage key（如 detail-image），
  // 故仅当 WORKFLOW_STAGE_LABELS 无映射时才兜底 stageLabel / stage
  return WORKFLOW_STAGE_LABELS[task.stage] || task.stageLabel || task.stage;
}

/** 阶段序号（0 基），供 flowbar 用 */
function stageIdxOf(task: TaskWithMeta): number {
  const i = WORKFLOW_STAGE_KEYS.indexOf(task.stage as (typeof WORKFLOW_STAGE_KEYS)[number]);
  return i < 0 ? 0 : i;
}

/** 状态 tag（对齐线框 tag：warn 待确认 / ok 已归档 / work 进行中） */
function Tag({ task }: { task: TaskWithMeta }) {
  if (task.column === 'awaiting') {
    return <span className="qs-badge warn">{`待你确认 · ${stageText(task)}`}</span>;
  }
  if (task.column === 'done') return <span className="qs-badge ok">✓ 已完成</span>;
  if (task.column === 'progress') return <span className="qs-badge">进行中 · {stageText(task)}</span>;
  return <span className="qs-badge">需求对齐</span>;
}

/** 看板卡片（对齐线框 tcard：#id 标题 / stageNote / tag / 负责人 / flowbar；B6·9.1 失效角标 / B4·4.10 下载入口） */
function TaskCard({
  task,
  onOpen,
  onConfirm,
  onArchive,
}: {
  task: TaskWithMeta;
  onOpen: (task: TaskWithMeta) => void;
  onConfirm: (id: number) => void;
  onArchive: (id: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { download, busy: packing, error: packError } = useDownloadPackage(task.id);

  // 点击卡片外部关闭溢出菜单（菜单本身在卡片内，需排除自身）
  useEffect(() => {
    if (!menuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [menuOpen]);

  return (
    <article
      className="qs-card qs-interactive relative p-3"
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

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Tag task={task} />
        {/* B6 · 9.1 看板卡片失效角标（kbRefsInvalid > 0 才显示） */}
        <KbInvalidBadge task={task} />
      </div>

      {/* 6 段 flowbar（对齐线框 flowbar；意见5 视觉降级版，颜色语义与详情页一致：完成=绿 / 当前=黑 / 未到=灰；
          确认点（APPROVAL_POINT_STAGES，含 detail-image）仅在 hover title 标注「确认点」，不再渲染微标 */}
      <div className="mt-2 flex gap-[3px]">
        {WORKFLOW_STAGE_KEYS.map((k, i) => {
          const isApproval = (APPROVAL_POINT_STAGES as string[]).includes(k);
          return (
            <div
              key={k}
              className="flex min-w-0 flex-1 flex-col items-center"
              title={isApproval ? `${WORKFLOW_STAGE_LABELS[k]} · 确认点` : WORKFLOW_STAGE_LABELS[k]}
            >
              <span
                className="block h-[3px] w-full rounded-full"
                style={{
                  background:
                    i < stageIdxOf(task) || task.column === 'done'
                      ? 'var(--color-ok)'
                      : i === stageIdxOf(task)
                        ? 'var(--color-ink)'
                        : 'var(--color-line)',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* 负责人 */}
      <span
        className="qs-meta mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5"
        style={{ background: 'var(--color-sunken)', border: '1px solid var(--color-line)' }}
      >
        <Avatar name={task.ownerName || '待'} size={14} /> {task.ownerName || '待分配'}
      </span>

      {/* 主操作独占一行（次要操作已收进下方 ⋯ 溢出菜单，避免三按钮挤在一行导致中文折行） */}
      {task.column === 'planned' ? (
        <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
          <Btn size="sm" variant="primary" className="w-full" onClick={() => onConfirm(task.id)}>
            确认开工
          </Btn>
        </div>
      ) : null}

      {/* 次要操作：交付包下载 / 归档 收进 ⋯ 溢出菜单 */}
      <div className="mt-2.5 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {task.column === 'progress' ? (
          <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-ink-faint)' }}>
            <span className="qs-dot signal busy" />
            {stageText(task)} 推进中
          </span>
        ) : null}
        {task.column === 'done' ? (
          <>
            <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-ink-faint)' }}>
              <span className="qs-dot ok" />
              已交付 · 已完成
            </span>
            {/* 28：终态卡片补「查看交付物 →」入口（指向任务详情的内容交付 Tab） */}
            <button type="button" className="qs-clickable qs-meta inline-flex items-center gap-1" style={{ color: 'var(--color-signal)' }} onClick={() => onOpen(task)}>
              查看交付物 →
            </button>
          </>
        ) : null}
        <div className="flex-1" />
        {/* B4 · 4.10 下载失败原因（409 中文）现在卡片层级展示，避免藏在菜单里被忽略 */}
        {packError ? (
          <span className="qs-meta max-w-[130px] truncate text-[10px]" style={{ color: 'var(--color-danger)' }} title={packError}>
            {packError}
          </span>
        ) : null}
        <div className="relative" ref={menuRef}>
          <Btn size="sm" variant="ghost" title="更多操作" onClick={() => setMenuOpen((v) => !v)}>
            ⋯
          </Btn>
          {menuOpen ? (
            <div
              className="qs-card absolute bottom-full right-0 z-20 mb-1 w-[124px] p-1"
              style={{ boxShadow: '0 4px 12px rgba(10,10,10,0.08)' }}
            >
              <button
                type="button"
                className="qs-nav-item"
                disabled={packing}
                title="下载交付包 ZIP（文案 + 已采纳图片）"
                onClick={() => {
                  void download();
                  setMenuOpen(false);
                }}
              >
                {packing ? '打包中…' : '下载交付包'}
              </button>
              <button
                type="button"
                className="qs-nav-item"
                title="归档（归档≠删除，可在「已归档任务」中恢复）"
                onClick={() => {
                  onArchive(task.id);
                  setMenuOpen(false);
                }}
              >
                归档
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/** 任务看板（对齐线框 renderBoard：标题行 + 看板/列表切换 + 筛选 + 搜索 + ＋新建任务 + 四列） */
export function BoardView({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const { tasks, loading, confirmTask, openTask, archiveTask, restoreTask, pushToast, boardMode, setBoardMode, filters } = useWorkbench();
  const [archiveOpen, setArchiveOpen] = useState(false);

  // 两视图共用同一数据源：未归档 + 筛选/排序（B5 · 5.2/5.4）
  const visible = useMemo(() => applyTaskFilters(tasks, filters), [tasks, filters]);
  const archivedCount = useMemo(() => tasks.filter((t) => t.archived).length, [tasks]);

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

  /** 归档 + 轻量反馈（撤销 = 立即恢复，避免看板跳变无提示） */
  const handleArchive = (id: number) => {
    void archiveTask(id);
    pushToast({
      message: `已归档任务 #${id}`,
      tone: 'default',
      duration: 6000,
      actionLabel: '撤销',
      onAction: () => void restoreTask(id),
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 标题行（对齐线框 board-title-row；B5：看板/列表切换 + 交付物搜索） */}
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <span className="font-display text-xl font-bold">任务看板</span>
        <span className="qs-meta hidden sm:inline" style={{ color: 'var(--color-ink-faint)' }}>
          {visible.length}个任务{archivedCount > 0 ? ` · ${archivedCount} 个已归档` : ''}
        </span>
        <div className="flex items-center gap-1 rounded-[4px] border p-0.5" style={{ borderColor: 'var(--color-line)' }}>
          <button
            type="button"
            className={`cursor-pointer rounded-[3px] px-3 py-1 text-[12px] transition-colors ${boardMode === 'board' ? 'font-semibold' : 'qs-meta'}`}
            style={boardMode === 'board' ? { background: 'var(--color-signal-soft)', color: 'var(--color-signal-strong)' } : undefined}
            onClick={() => setBoardMode('board')}
          >
            看板
          </button>
          <button
            type="button"
            className={`cursor-pointer rounded-[3px] px-3 py-1 text-[12px] transition-colors ${boardMode === 'list' ? 'font-semibold' : 'qs-meta'}`}
            style={boardMode === 'list' ? { background: 'var(--color-signal-soft)', color: 'var(--color-signal-strong)' } : undefined}
            onClick={() => setBoardMode('list')}
          >
            列表
          </button>
        </div>
        <DeliverableSearch />
        <div className="flex-1" />
        {/* 已归档任务入口（新建任务左边）→ 弹窗查看 + 恢复 */}
        <Btn variant="ghost" onClick={() => setArchiveOpen(true)} title="查看与恢复已归档任务">
          {archivedCount > 0 ? `已归档任务（${archivedCount}）` : '已归档任务'}
        </Btn>
        <Btn onClick={onNew}>＋ 新建任务</Btn>
      </div>

      {/* 筛选栏（B5 · 6.7；列表/看板共用，返回后保留 —— 状态存 store） */}
      <TaskFilterBar />

      {visible.length === 0 ? (
        <Empty
          text={
            archivedCount > 0
              ? '当前筛选无匹配任务 · 已归档任务可在「已归档任务」中查看'
              : '暂无任务，点击右上角「＋ 新建任务」'
          }
        />
      ) : boardMode === 'list' ? (
        <TaskListTable tasks={visible} onOpen={onOpen} />
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto">
          {COLUMNS.map((col) => {
            const list = visible.filter((t) => t.column === col.key);
            return (
              <section key={col.key} className={`qs-card flex flex-col overflow-hidden ${list.length === 0 ? 'w-[96px] flex-none' : 'min-w-[200px] flex-1'}`}>
                <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: 'var(--color-line)' }}>
                  <span className="text-[13px] font-medium">{col.label}</span>
                  <span className="qs-meta tabular">{list.length}</span>
                </header>
                <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
                  {list.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={handleOpen} onConfirm={(id) => void confirmTask(id)} onArchive={handleArchive} />
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

      <ArchivedTasksModal open={archiveOpen} onClose={() => setArchiveOpen(false)} />
    </div>
  );
}
