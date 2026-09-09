import { useState } from 'react';
import type { Agent } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Avatar } from '../../components/ui.tsx';
import { AgentSettingsModal } from './AgentSettingsModal.tsx';

/** 状态点：unconfigured=灰 / online·idle=绿 / busy=紫闪（意见5/19） */
export function dotClass(s: string): string {
  if (s === 'busy') return 'qs-dot signal busy';
  if (s === 'online' || s === 'idle') return 'qs-dot ok';
  return 'qs-dot unconfigured';
}

export function dotLabel(s: string): string {
  if (s === 'busy') return '忙碌';
  if (s === 'online') return '在线';
  if (s === 'idle') return '待命';
  return '未配置';
}

/** 工位栏（对齐线框 ws-bar）：主视区顶部常驻，Agent 实时状态卡 + 设置入口 */
export function WorkstationBar() {
  const { agents } = useWorkbench();
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);

  return (
    <>
      <div className="qs-card mb-3 px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
            工位 WORKSTATIONS
          </span>
          <span className="qs-meta tabular" style={{ color: 'var(--color-ink-faint)' }}>
            {agents.length} 个工位
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {agents.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-2.5 rounded-[4px] border px-2.5 py-2 transition-colors"
              style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)', transitionDuration: 'var(--dur-fast)' }}
            >
              <Avatar name={a.name} id={a.id} size={26} />
              <span className={dotClass(a.onlineStatus)} title={dotLabel(a.onlineStatus)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{a.name}</span>
                  <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{a.role}</span>
                </div>
                <div className="qs-meta truncate" style={{ color: 'var(--color-ink-faint)' }}>
                  {a.model ? `模型 ${a.model}` : '未配置模型'}
                  {a.activity ? ` · ${a.activity}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="qs-meta shrink-0 rounded-[4px] border px-1.5 py-0.5 opacity-70 transition-opacity group-hover:opacity-100"
                style={{ borderColor: 'var(--color-line-strong)' }}
                title="Agent 设置"
                onClick={() => setSettingsAgent(a)}
              >
                设置
              </button>
            </div>
          ))}
        </div>
      </div>

      {settingsAgent ? (
        <AgentSettingsModal agent={settingsAgent} open onClose={() => setSettingsAgent(null)} />
      ) : null}
    </>
  );
}
