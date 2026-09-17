import { useState } from 'react';
import type { Agent } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { AgentSettingsModal } from './AgentSettingsModal.tsx';
import { AgentAvatarRowItem, AgentCard } from './AgentCard.tsx';

import { agentDotClass, agentLabel } from '../../lib/agentStatus.ts';

/**
 * 状态点/文案/颜色 统一收敛至 lib/agentStatus.ts（默认值 = 工位栏语义，行为不变）。
 * dotClass / dotLabel 以别名导出，兼容 ObservabilityView 的既有 import。
 */
export const dotClass = agentDotClass;
export const dotLabel = agentLabel;

/**
 * 工位栏（对齐线框 ws-bar）。
 * P1·2.1：默认展开（原为默认折叠）。
 * P1·2.2：折叠态改为头像行——小头像 + 状态点 + 名字 + 岗位，不再只有状态点灰字。
 * P1·5.3：Agent 卡结构抽至 AgentCard.tsx，供总览带小助理入口位复用。
 */
/**
 * 工位栏（对齐线框 ws-bar）。
 * P1·2.1：默认展开（原为默认折叠）。
 * P1·2.2：折叠态改为头像行——小头像 + 状态点 + 名字 + 岗位，不再只有状态点灰字。
 * P1·5.3：Agent 卡结构抽至 AgentCard.tsx，供总览带小助理入口位复用。
 * P2·F3：工位栏语义 = **工作流班组**，只渲染文案/设计师/主管三角色——
 *        知识库小助理（依依，role='助理'）不参与工作流，不出现在工位栏（其入口在知识库总览带）。
 */
const WORKFLOW_ROLES = ['文案', '设计师', '主管'];

export function WorkstationBar() {
  const { agents } = useWorkbench();
  const crew = agents.filter((a) => (WORKFLOW_ROLES as string[]).includes(a.role));
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      {expanded ? (
        <div className="qs-card mb-3 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
              工位 WORKSTATIONS · {crew.length} 个
            </span>
            <button type="button" className="qs-clickable qs-meta" style={{ color: 'var(--color-ink-soft)' }} onClick={() => setExpanded(false)} title="折叠工位栏">
              收起 ▸
            </button>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {crew.map((a) => (
              <AgentCard key={a.id} agent={a} onConfigure={setSettingsAgent} />
            ))}
          </div>
        </div>
      ) : (
        <div className="qs-card mb-3 flex items-center gap-3 px-3 py-2" style={{ minHeight: 40 }}>
          <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)' }}>
            工位
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            {crew.map((a) => (
              <AgentAvatarRowItem key={a.id} agent={a} />
            ))}
          </div>
          <button type="button" className="qs-clickable qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)' }} onClick={() => setExpanded(true)} title="展开工位栏，查看模型与配置">
            展开 ▾
          </button>
        </div>
      )}

      {settingsAgent ? (
        // 工位栏入口随当前工作流看板：挂载卡片只显示当前工作流份（scope 定案 2026-09-14）
        <AgentSettingsModal agent={settingsAgent} open scope="workflow" onClose={() => setSettingsAgent(null)} />
      ) : null}
    </>
  );
}
