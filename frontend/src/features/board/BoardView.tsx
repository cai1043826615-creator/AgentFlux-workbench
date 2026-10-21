import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardColumn } from '@workbench/shared';
import { WORKFLOW_STAGE_LABELS, approvalPointsOf, isXhsWorkflow, stageIndexOf, stageKeysOf } from '@workbench/shared';import { useWorkbench, type TaskWithMeta } from '../../store/useWorkbench.tsx';
import { applyTaskFilters } from '../../lib/taskFilters.ts';
import { isSandboxMode } from '../../lib/sandbox-mode.ts';
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

/** 阶段序号（0 基），供 flowbar 用；按任务所属工作流取值 */
function stageIdxOf(task: TaskWithMeta): number {
  const i = stageIndexOf(task.workflowId, task.stage);
  return i < 0 ? 0 : i;
}

/** 状态 tag（对齐线框 tag：warn 待确认 / ok 已归档 / work 进行中） */
function Tag({ task }: { task: TaskWithMeta }) {
  if (task.column === 'awaiting') {
    return <span className="qs-badge warn">{`待确认 · ${stageText(task)}`}</span>;
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
  onConfirm: (id: number) => Promise<void> | void;
  onArchive: (id: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { download, busy: packing, error: packError } = useDownloadPackage(task.id);
  /** 头像 tooltip 需要「名字（岗位）」：岗位由 agents 按 ownerName 反查（TaskWithMeta 不带 ownerRole） */
  const { agents, requestFocusPackage, pushToast } = useWorkbench();
  const ownerRole = agents.find((a) => a.name === task.ownerName)?.role;

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
      className="qs-card qs-interactive relative flex flex-col overflow-hidden p-3"
      style={{
        borderColor: task.column === 'awaiting' ? 'var(--color-warn)' : undefined,
        // 新7·修订：固定 165px（更紧凑的看板节奏），内部间距同步收紧避免挤压/溢出。
        // 溢出裁剪：overflow-hidden；点卡片打开详情可见完整信息，卡面只承担概览。
        height: 165,
      }}
      onClick={() => onOpen(task)}
      title="查看详情"
    >
      <div className="mb-1.5 flex items-start gap-1.5">
        <span className="qs-meta tabular pt-0.5 shrink-0">#{task.id}</span>
        <h4 className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
          {task.title}
        </h4>
        {/* 负责人头像置于右上角（P1·1.5）：不再单独占一行，释放卡片高度。
            头像 tooltip 直接传给 Avatar（外包一层设 title 不生效），文案为「名字（岗位）」 */}
        <span className="shrink-0">
          <Avatar
            name={task.ownerName || '待'}
            size={20}
            title={task.ownerName ? `${task.ownerName}${ownerRole ? `（${ownerRole}）` : ''}` : '待分配'}
          />
        </span>
      </div>

      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Tag task={task} />
        {/* B6 · 9.1 看板卡片失效角标（kbRefsInvalid > 0 才显示） */}
        <KbInvalidBadge task={task} />
      </div>

      {/* flowbar：段数与确认点均按任务所属工作流取（电商 6 段 / XHS 6 段各自独立）
          颜色语义与详情页一致：完成=绿 / 当前=黑 / 未到=灰；确认点仅在 hover title 标注
          新7·修订：不再 flex-1 justify-end —— 那会把剩余高度全吸到 badge 与进度条之间，
          卡片中部出现大片空洞（截图实测 90px）；改为自然流，进度条紧跟 badge 行。
          165px 版：mt-1.5，与徽标行保持紧凑 */}
      <div className="mt-1.5 flex flex-col gap-[3px]">
        <div className="flex gap-[3px]">
        {stageKeysOf(task.workflowId).map((k, i) => {
          const isApproval = approvalPointsOf(task.workflowId).includes(k);
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
      </div>

      {/* 主操作独占一行 */}
      {task.column === 'planned' ? (
        <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
          <Btn
            size="sm"
            variant="primary"
            className="w-full"
            disabled={confirming || isSandboxMode()}
            onClick={() => {
              // 失败要可见：不再用 void 吞掉 rejection（生图失败时用户只会看到"一直转"）
              setConfirming(true);
              void (async () => {
                try {
                  await onConfirm(task.id);
                } catch (err) {
                  pushToast({ message: err instanceof Error ? err.message : '开工失败，请重试', tone: 'no', duration: 8000 });
                } finally {
                  setConfirming(false);
                }
              })();
            }}
          >
            {confirming ? '开工中…' : '确认开工'}
          </Btn>
        </div>
      ) : null}

      {/* 底部操作行（新7：固定 165px 内贴底；stageNote 单行截断，完整内容看详情） */}
      <div className="mt-auto flex shrink-0 items-center gap-2 pt-1.5" onClick={(e) => e.stopPropagation()}>
        {task.column === 'progress' ? (
          <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-ink-faint)' }}>
            <span className="qs-dot signal busy" />
            {stageText(task)} 推进中
          </span>
        ) : null}
        {task.column === 'done' ? (
          // XHS 交付后纵向序列里定位发布包（不再切 Tab 跳空）；电商保持原样切「内容交付」
          <button
            type="button"
            className="qs-clickable qs-meta inline-flex items-center gap-1"
            style={{ color: 'var(--color-signal)' }}
            onClick={() => {
              onOpen(task);
              if (isXhsWorkflow(task.workflowId)) requestFocusPackage();
            }}
          >
            查看交付物 →
          </button>
        ) : null}
        {task.column === 'awaiting' && task.stageNote ? (
          <span className="qs-meta truncate" style={{ color: 'var(--color-ink-faint)' }} title={task.stageNote}>
            {task.stageNote}
          </span>
        ) : null}
        <div className="flex-1" />
        {/* B4 · 4.10 下载失败原因（409 中文）现在卡片层级展示，避免藏在菜单里被忽略 */}
        {packError ? (
          <span className="qs-meta max-w-[130px] truncate text-[10px]" style={{ color: 'var(--color-danger)' }} title={packError}>
            {packError}
          </span>
        ) : null}
        <div className="relative" ref={menuRef}>
          <Btn size="sm" variant="ghost" className="outline" title="更多操作" aria-label="更多操作" onClick={() => setMenuOpen((v) => !v)}>
            ⋯
          </Btn>
          {menuOpen ? (
            <div
              className="qs-card absolute bottom-full right-0 z-20 mb-1 w-[124px] p-1"
              /* ui-rules-ignore 浮层阴影：下拉菜单真实抬升，规范允许（AGENTS.md 二.5 例外） */
              style={{ boxShadow: '0 4px 12px rgba(10,10,10,0.08)' }}
            >
              <button
                type="button"
                className="qs-nav-item"
                disabled={packing || isSandboxMode()}
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
  const { tasks, loading, confirmTask, openTask, archiveTask, restoreTask, pushToast, boardMode, setBoardMode, filters, currentWorkflowId, workflows } = useWorkbench();
  const [archiveOpen, setArchiveOpen] = useState(false);

  // 两视图共用同一数据源：当前工作流 → 未归档 → 筛选/排序（B5 · 5.2/5.4）
  const inWorkflow = useMemo(() => tasks.filter((t) => (t.workflowId ?? '') === currentWorkflowId), [tasks, currentWorkflowId]);
  const visible = useMemo(() => applyTaskFilters(inWorkflow, filters), [inWorkflow, filters]);
  const archivedCount = useMemo(() => inWorkflow.filter((t) => t.archived).length, [inWorkflow]);

  if (loading && tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="任务加载中…" />
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
        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          {workflows.find((w) => w.id === currentWorkflowId)?.name ?? ''}
        </span>
        <span className="qs-meta hidden sm:inline" style={{ color: 'var(--color-ink-faint)' }}>
          {visible.length} 个任务{archivedCount > 0 ? ` · ${archivedCount} 个已归档` : ''}
        </span>
        <div className="flex items-center gap-1 rounded-[4px] border p-0.5" style={{ borderColor: 'var(--color-line)' }}>
          <button
            type="button"
            className={`cursor-pointer rounded-[4px] px-3 py-1 text-[12px] transition-colors ${boardMode === 'board' ? 'font-semibold' : 'qs-meta'}`}
            style={boardMode === 'board' ? { background: 'var(--color-signal-soft)', color: 'var(--color-signal-strong)' } : undefined}
            onClick={() => setBoardMode('board')}
          >
            看板
          </button>
          <button
            type="button"
            className={`cursor-pointer rounded-[4px] px-3 py-1 text-[12px] transition-colors ${boardMode === 'list' ? 'font-semibold' : 'qs-meta'}`}
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
        <Btn onClick={onNew}>
          ＋ 新建任务
        </Btn>
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
        <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto">
          {COLUMNS.map((col) => {
            const list = visible.filter((t) => t.column === col.key);
            return (
              <section key={col.key} className="qs-card flex min-w-[240px] flex-1 flex-col overflow-hidden">
                <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: 'var(--color-line)' }}>
                  <span className="text-[13px] font-medium">{col.label}</span>
                  <span className="qs-meta tabular">{list.length}</span>
                </header>
                <div className="flex-1 space-y-2.5 overflow-y-auto p-2.5">
                  {list.map((t) => (
                    <TaskCard key={t.id} task={t} onOpen={handleOpen} onConfirm={(id) => confirmTask(id)} onArchive={handleArchive} />
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
