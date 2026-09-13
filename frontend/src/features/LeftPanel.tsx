import { useEffect, useState } from 'react';
import { useWorkbench } from '../store/useWorkbench.tsx';
import { api } from '../lib/api.ts';
import { Glyph } from '../components/ui.tsx';
import { NotifySettingsSection } from './workstation/NotifySettingsSection.tsx';

type OrchestrationMode = 'graph' | 'linear';

/** 工作流菜单项（图标 + 名称，选中浅紫高亮；右侧为该工作流自己的任务数） */
function WorkflowItem({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" className={`qs-nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Glyph name="flow" size={14} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className="qs-meta tabular shrink-0" style={{ color: active ? 'var(--color-signal)' : 'var(--color-ink-faint)' }}>
        {count}
      </span>
    </button>
  );
}

/** 左侧栏（对齐线框 left）：工作流卡 + 通用（Agent 状态/运行设置）
 *  openSettingsSignal：折叠态图标列触发的设置弹窗打开信号（>0 时打开，展示当前编排模式） */
export function LeftPanel({ onNew, onBack, openSettingsSignal = 0 }: { onNew: () => void; onBack: () => void; openSettingsSignal?: number }) {
  const { settings, refresh, tasks, view, setView, workflows, currentWorkflowId, setCurrentWorkflowId } = useWorkbench();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState<OrchestrationMode>('graph');

  const rawMode = (settings.orchestrationMode as { mode?: string } | undefined)?.mode;
  const orchestrationMode: OrchestrationMode = rawMode === 'linear' ? 'linear' : 'graph';

  /** 选中该工作流 → 切换当前工作流并回到看板 */
  const pickWorkflow = (id: string) => {
    setCurrentWorkflowId(id);
    setView('board');
  };

  const openSettings = () => {
    setMode(orchestrationMode); // 意见6：打开时预置为当前模式（而非相反值）
    setSettingsOpen(true);
  };

  // 折叠态图标列「设置」：信号变化 → 打开弹窗（此时左栏已同时展开）
  useEffect(() => {
    if (openSettingsSignal > 0) openSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSettingsSignal]);

  const saveSettings = async () => {
    try {
      await api.putSettings({ orchestrationMode: { mode } });
      await refresh();
    } finally {
      setSettingsOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-0.5 p-3">
      <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>知识库</div>
      <button type="button" className={`qs-nav-item ${view === 'knowledge' ? 'active' : ''}`} onClick={() => setView('knowledge')}>
        <Glyph name="box" size={14} className="shrink-0" />
        <span className="flex-1 truncate">知识库</span>
      </button>
      <button type="button" className={`qs-nav-item ${view === 'knowledge-graph' ? 'active' : ''}`} onClick={() => setView('knowledge-graph')}>
        <Glyph name="graph" size={14} className="shrink-0" />
        <span className="flex-1 truncate">知识星图</span>
      </button>
      <button type="button" className={`qs-nav-item ${view === 'hot' ? 'active' : ''}`} onClick={() => setView('hot')}>
        <Glyph name="trend" size={14} className="shrink-0" />
        <span className="flex-1 truncate">每日热点</span>
      </button>

      <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
        <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>工作流</div>
        {workflows.map((wf) => {
          const active = currentWorkflowId === wf.id && (view === 'board' || view === 'task');
          return (
            <WorkflowItem
              key={wf.id}
              label={wf.name}
              active={active}
              count={tasks.filter((t) => (t.workflowId ?? '') === wf.id && !t.archived).length}
              onClick={() => (active ? onBack() : pickWorkflow(wf.id))}
            />
          );
        })}
      </div>

      <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
        <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>通用</div>
        <button
          type="button"
          className={`qs-nav-item ${view === 'observability' ? 'active' : ''}`}
          onClick={() => setView('observability')}
        >
          <Glyph name="pulse" size={14} className="shrink-0" />
          <span className="flex-1 truncate">Agent 状态</span>
        </button>
        <button type="button" className="qs-nav-item" onClick={openSettings} title="打开运行设置">
          <Glyph name="gear" size={14} className="shrink-0" />
          <span className="flex-1 truncate">运行设置</span>
        </button>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]" onClick={() => setSettingsOpen(false)}>
          <div className="qs-card w-full p-5" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="font-display mb-3 text-[15px] font-semibold">设置</div>
            <p className="qs-meta mb-2" style={{ color: 'var(--color-ink-faint)' }}>任务推进方式</p>
            <div className="mb-4 space-y-2">
              <label
                className="flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2.5 transition-colors"
                style={{
                  borderColor: mode === 'graph' ? 'var(--color-signal)' : 'var(--color-line-strong)',
                  background: mode === 'graph' ? 'var(--color-signal-soft)' : 'var(--color-surface)',
                }}
              >
                <input
                  type="radio"
                  name="orchestration-mode"
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-signal)]"
                  checked={mode === 'graph'}
                  onChange={() => setMode('graph')}
                />
                <span className="text-[13px] leading-snug">
                  <span className="block font-medium">手动确认</span>
                  <span className="qs-meta block" style={{ color: 'var(--color-ink-faint)' }}>每个环节产出由你确认后再继续</span>
                </span>
              </label>
              <label
                className="flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2.5 transition-colors"
                style={{
                  borderColor: mode === 'linear' ? 'var(--color-signal)' : 'var(--color-line-strong)',
                  background: mode === 'linear' ? 'var(--color-signal-soft)' : 'var(--color-surface)',
                }}
              >
                <input
                  type="radio"
                  name="orchestration-mode"
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-signal)]"
                  checked={mode === 'linear'}
                  onChange={() => setMode('linear')}
                />
                <span className="text-[13px] leading-snug">
                  <span className="block font-medium">全自动</span>
                  <span className="qs-meta block" style={{ color: 'var(--color-ink-faint)' }}>所有环节自动推进，无需人工确认</span>
                </span>
              </label>
            </div>

            {/* P1·3.2/3.3/3.4：通知分区（原顶栏 NotifyControl 迁入；仅显式点击才申请权限） */}
            <p className="qs-meta mb-2" style={{ color: 'var(--color-ink-faint)' }}>通知</p>
            <div className="mb-4">
              <NotifySettingsSection />
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" className="qs-btn sm" onClick={() => setSettingsOpen(false)}>取消</button>
              <button type="button" className="qs-btn sm primary" onClick={saveSettings}>保存</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
