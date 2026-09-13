import type { Agent } from '@workbench/shared';
import { Avatar, Badge } from '../../components/ui.tsx';
import { agentColor, agentDotClass, agentLabel } from '../../lib/agentStatus.ts';

/**
 * Agent 卡（P1·5.3 从 WorkstationBar 抽出为可复用组件）。
 * 用途一：工位栏展开态，遍历工作流班组（文案/设计师/主管）渲染多张。
 * 用途二：知识库总览带的「依依」入口位（P2）——**同一张卡、同一尺寸与信息密度**。
 *
 * 展示头像（右下状态点）、名字、角色、模型与活动、状态文案与「配置」入口。
 * 注：早期有 `compact` 变体（省略模型行），因总览带卡与工位卡视觉不一致（P2-1 验收打回）
 * 已移除——两处统一使用完整卡。
 */
export function AgentCard({
  agent,
  onConfigure,
}: {
  agent: Agent;
  /** 提供时渲染「配置」按钮并回调 */
  onConfigure?: (agent: Agent) => void;
}) {
  return (
    <div
      className="group flex items-center gap-3.5 rounded-[4px] border px-3 py-4 transition-colors hover:border-[var(--color-line-strong)]"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)', transitionDuration: 'var(--dur-fast)' }}
    >
      {/* 头像（放大）+ 状态点右下（参照 ChatPanel：relative 包裹 + 白描边）
          tooltip 统一为「名字（岗位）· 状态」，直接传给 Avatar —— 外包层设 title 会被 Avatar 自身的覆盖 */}
      <span className="relative shrink-0">
        <Avatar name={agent.name} id={agent.id} size={56} title={`${agent.name}（${agent.role}）· ${agentLabel(agent.onlineStatus)}`} />
        <span
          className={`qs-dot absolute -bottom-0.5 -right-0.5 ${agentDotClass(agent.onlineStatus)}`}
          style={{ boxShadow: '0 0 0 2px var(--color-surface)', width: 10, height: 10 }}
        />
      </span>
      {/* 信息列：名字+角色一行、模型+活动一行、状态文字一行 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{agent.name}</span>
          <Badge>{agent.role}</Badge>
        </div>
        <div className="qs-meta truncate text-[13px]" style={{ color: 'var(--color-ink-faint)' }}>
          {agent.model ? `模型 ${agent.model}` : '未配置模型'}
          {agent.activity ? ` · ${agent.activity}` : ''}
        </div>
        <div className="qs-meta text-[13px]" style={{ color: agentColor(agent.onlineStatus) }}>
          {agentLabel(agent.onlineStatus)}
        </div>
      </div>
      {onConfigure ? (
        <button
          type="button"
          className="qs-btn sm shrink-0 opacity-80 transition-opacity group-hover:opacity-100 cursor-pointer"
          title="Agent 设置"
          onClick={() => onConfigure(agent)}
        >
          配置
        </button>
      ) : null}
    </div>
  );
}

/**
 * 折叠态的一行 Agent 摘要（P1·2.2）：小头像 + 状态点 + 名字 + 岗位。
 * 复用于工位栏折叠态。
 */
export function AgentAvatarRowItem({ agent }: { agent: Agent }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2.5"
      style={{ background: 'var(--color-sunken)', border: '1px solid var(--color-line)' }}
      title={`${agent.name}（${agent.role}）· ${agentLabel(agent.onlineStatus)}`}
    >
      <span className="relative shrink-0">
        <Avatar name={agent.name} id={agent.id} size={20} title={`${agent.name}（${agent.role}）`} />
        <span
          className={`qs-dot absolute -bottom-0.5 -right-0.5 ${agentDotClass(agent.onlineStatus)}`}
          style={{ boxShadow: '0 0 0 1.5px var(--color-sunken)', width: 7, height: 7 }}
        />
      </span>
      <span className="qs-meta whitespace-nowrap" style={{ color: 'var(--color-ink)' }}>
        {agent.name}
      </span>
      <span className="qs-meta whitespace-nowrap" style={{ color: 'var(--color-ink-faint)' }}>
        {agent.role}
      </span>
    </span>
  );
}
