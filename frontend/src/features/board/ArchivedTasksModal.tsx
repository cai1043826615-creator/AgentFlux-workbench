import { useMemo } from 'react';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Btn, Empty, Modal } from '../../components/ui.tsx';

/** 看板列 → 中文（归档任务原列展示） */
const COL_LABEL: Record<string, string> = {
  planned: '规划中',
  progress: '进行中',
  awaiting: '待确认',
  done: '已完成',
};

/**
 * 已归档任务弹窗（参考 AgentSettingsModal 形式：卡片化列表行）。
 * 归档≠删除：任务数据保留，恢复后回到看板原列。
 */
export function ArchivedTasksModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tasks, restoreTask, openTask, pushToast } = useWorkbench();

  const archived = useMemo(() => tasks.filter((t) => t.archived).sort((a, b) => b.id - a.id), [tasks]);

  const stageText = (task: (typeof tasks)[number]) => WORKFLOW_STAGE_LABELS[task.stage as keyof typeof WORKFLOW_STAGE_LABELS] || task.stageLabel || task.stage;

  return (
    <Modal open={open} title="已归档任务" onClose={onClose} width={500}>
      <div className="qs-meta mb-3" style={{ color: 'var(--color-ink-faint)' }}>
        归档≠删除：任务数据全部保留，仅从看板隐藏；恢复后回到原列（{archived.length} 个）
      </div>

      {archived.length === 0 ? (
        <Empty text="暂无已归档任务" />
      ) : (
        <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-0.5">
          {archived.map((t) => (
            <div key={t.id} className="qs-card flex items-center gap-3 p-2.5">
              <span className="qs-meta tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>#{t.id}</span>
              <button
                type="button"
                className="qs-clickable min-w-0 flex-1 truncate text-left text-[13px] font-medium"
                title="查看详情"
                onClick={() => {
                  onClose();
                  openTask(t.id);
                }}
              >
                {t.title}
              </button>
              <span className="qs-badge shrink-0">{COL_LABEL[t.column] ?? t.column}</span>
              <span className="qs-meta hidden min-w-0 shrink-0 truncate sm:inline" style={{ color: 'var(--color-ink-faint)', maxWidth: 110 }}>
                {stageText(t)}
              </span>
              <Btn size="sm" onClick={() => { void restoreTask(t.id); pushToast({ message: `已恢复任务 #${t.id}`, tone: 'ok', duration: 4000 }); }}>
                恢复
              </Btn>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
