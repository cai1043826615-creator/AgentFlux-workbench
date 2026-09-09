import { useState } from 'react';
import { useWorkbench } from '../store/useWorkbench.tsx';
import { api } from '../lib/api.ts';
import { Glyph } from '../components/ui.tsx';

/** 工作流菜单项（参考图2：图标+文字，选中浅紫圆角高亮；右侧任务总数） */
function WorkflowItem({ active, count, onClick }: { active: boolean; count: number; onClick: () => void }) {
  return (
    <button type="button" className={`qs-nav-item ${active ? 'active' : ''}`} onClick={onClick}>
      <Glyph name="flow" size={14} className="shrink-0" />
      <span className="flex-1 truncate">电商工作流</span>
      <span className="qs-meta tabular shrink-0" style={{ color: active ? 'var(--color-signal)' : 'var(--color-ink-faint)' }}>
        {count}
      </span>
    </button>
  );
}

/** 占位工作流（灰字不可点） */
function PlaceholderItem({ label }: { label: string }) {
  return (
    <button type="button" className="qs-nav-item disabled" tabIndex={-1} aria-disabled="true">
      <Glyph name="box" size={14} className="shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className="qs-meta shrink-0">占位</span>
    </button>
  );
}

/** 左侧栏（对齐线框 left）：工作流卡 + 通用（Agent 状态/设置） */
export function LeftPanel({ onNew, onBack }: { onNew: () => void; onBack: () => void }) {
  const { settings, refresh, tasks, view, setView } = useWorkbench();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState('');

  const orchestrationMode = (settings.orchestrationMode as { mode?: string } | undefined)?.mode ?? 'graph';
  const workflowActive = view === 'board' || view === 'task';

  const openSettings = () => {
    setMode(orchestrationMode === 'graph' ? 'linear' : 'graph');
    setSettingsOpen(true);
  };

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
      <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>工作流</div>
      <WorkflowItem active={workflowActive} count={tasks.length} onClick={onBack} />
      <PlaceholderItem label="直播带货上架" />
      <PlaceholderItem label="跨境选品" />

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
        <button type="button" className="qs-nav-item" onClick={openSettings}>
          <Glyph name="gear" size={14} className="shrink-0" />
          <span className="flex-1 truncate">设置</span>
        </button>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]" onClick={() => setSettingsOpen(false)}>
          <div className="qs-card w-full p-5" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="font-display mb-3 text-[15px] font-semibold">设置</div>
            <p className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>编排模式</p>
            <p className="mb-3 text-[13px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
              {mode === 'graph' ? '图编排：拍板点等待人工确认，逐级推进' : '线性降级：拍板点自动通过，全自动跑完'}
            </p>
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
