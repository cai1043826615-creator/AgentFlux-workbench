import { useState } from 'react';
import type { Agent } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Avatar, Badge } from '../../components/ui.tsx';
import { AgentSettingsModal } from './AgentSettingsModal.tsx';

import { agentColor, agentDotClass, agentLabel } from '../../lib/agentStatus.ts';

/**
 * 状态点/文案/颜色 统一收敛至 lib/agentStatus.ts（默认值 = 工位栏语义，行为不变）。
 * dotClass / dotLabel 以别名导出，兼容 ObservabilityView 的既有 import。
 */
export const dotClass = agentDotClass;
export const dotLabel = agentLabel;

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
              className="group flex items-center gap-3.5 rounded-[4px] border px-3 py-4 transition-colors hover:border-[var(--color-line-strong)]"
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
                <div className="qs-meta text-[13px]" style={{ color: agentColor(a.onlineStatus) }}>
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
