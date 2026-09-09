import { useState } from 'react';
import { useWorkbench } from '../store/useWorkbench.tsx';
import { api } from '../lib/api.ts';

/** 左侧栏（对齐线框 left）：工作流卡 + 通用（设置/执行观测） */
export function LeftPanel({ onNew, onBack }: { onNew: () => void; onBack: () => void }) {
  const { settings, refresh, agents, view, setView } = useWorkbench();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mode, setMode] = useState('');

  const orchestrationMode = (settings.orchestrationMode as { mode?: string } | undefined)?.mode ?? 'graph';

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
    <div className="flex flex-col gap-1 p-3">
      <div className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>工作流</div>
      <button
        type="button"
        className="flex items-center justify-between rounded-[4px] px-2.5 py-2 text-left transition-colors"
        style={{ background: 'var(--color-ink)', color: '#fff', transitionDuration: 'var(--dur-fast)' }}
        onClick={onBack}
      >
        <span className="font-display text-[13px] font-semibold">电商新品上架</span>
        <span className="qs-meta tabular text-white/70">{agents.length}</span>
      </button>
      <div className="qs-meta px-2.5 pb-2" style={{ color: 'var(--color-ink-faint)' }}>6阶段 · 2拍板点</div>
      <button type="button" className="qs-meta rounded-[4px] px-2.5 py-2 text-left opacity-50" style={{ color: 'var(--color-ink-soft)' }}>
        直播带货上架 <span className="ml-1">占位</span>
      </button>
      <button type="button" className="qs-meta rounded-[4px] px-2.5 py-2 text-left opacity-50" style={{ color: 'var(--color-ink-soft)' }}>
        跨境选品 <span className="ml-1">占位</span>
      </button>

      <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--color-line)' }}>
        <div className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>通用</div>
        <button
          type="button"
          className="block w-full rounded-[4px] px-2.5 py-2 text-left text-[13px] transition-colors"
          style={{
            color: view === 'observability' ? 'var(--color-signal-strong)' : 'var(--color-ink-soft)',
            transitionDuration: 'var(--dur-fast)',
            fontWeight: view === 'observability' ? 600 : 400,
          }}
          onClick={() => setView('observability')}
        >
          执行观测
        </button>
        <button
          type="button"
          className="block w-full rounded-[4px] px-2.5 py-2 text-left text-[13px] transition-colors"
          style={{ color: 'var(--color-ink-soft)', transitionDuration: 'var(--dur-fast)' }}
          onClick={openSettings}
        >
          设置
        </button>
      </div>

      <button type="button" className="qs-btn primary mt-3" onClick={onNew}>
        ＋ 新建任务
      </button>

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
