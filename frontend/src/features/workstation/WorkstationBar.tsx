import { useState } from 'react';
import type { Agent } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Avatar, Badge } from '../../components/ui.tsx';
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

/** 状态文字颜色（配合 dotClass；busy→紫 / online·idle→绿 / 其余→灰） */
function statusColor(s: string): string {
  if (s === 'busy') return 'var(--color-signal)';
  if (s === 'online' || s === 'idle') return 'var(--color-ok)';
  return 'var(--color-ink-faint)';
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
        <div className="grid gap-2.5 sm:grid-cols-3">
          {agents.map((a) => (
            <div
              key={a.id}
              className="group flex items-center gap-3.5 rounded-[4px] border px-3 py-4 transition-colors"
              style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)', transitionDuration: 'var(--dur-fast)' }}
            >
              {/* 头像（放大）+ 状态点右下（参照 ChatPanel：relative 包裹 + 白描边） */}
              <span className="relative shrink-0" title={dotLabel(a.onlineStatus)}>
                <Avatar name={a.name} id={a.id} size={56} />
                <span className={`qs-dot absolute -bottom-0.5 -right-0.5 ${dotClass(a.onlineStatus)}`} style={{ boxShadow: '0 0 0 2px var(--color-surface)', width: 10, height: 10 }} />
              </span>
              {/* 信息列：名字+角色一行、模型+活动一行、状态文字一行 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-semibold">{a.name}</span>
                  <Badge>{a.role}</Badge>
                </div>
                <div className="qs-meta truncate text-[13px]" style={{ color: 'var(--color-ink-faint)' }}>
                  {a.model ? `模型 ${a.model}` : '未配置模型'}
                  {a.activity ? ` · ${a.activity}` : ''}
                </div>
                <div className="qs-meta text-[13px]" style={{ color: statusColor(a.onlineStatus) }}>
                  {dotLabel(a.onlineStatus)}
                </div>
              </div>
              <button
                type="button"
                className="qs-btn sm shrink-0 opacity-80 transition-opacity group-hover:opacity-100 cursor-pointer"
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
