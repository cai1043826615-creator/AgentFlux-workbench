import type { Agent } from '@workbench/shared';
import { Avatar, Badge } from '../../components/ui.tsx';
import { agentColor, agentDotClass, agentLabel } from '../../lib/agentStatus.ts';

/**
 * 工位 Agent 卡（P1·5.3 从 WorkstationBar 抽出为可复用组件）。
 * 用途一：工位栏展开态，遍历 agents 渲染多张。
 * 用途二：知识库总览带的「小助理」入口位（P1·5.4）——同一形态，P2 挂上 assistant 实例即可自动出现。
 *
 * 行为与抽取前一致：展示头像（右下状态点）、名字、角色、模型与活动、状态文案与「配置」入口。
 */
export function AgentCard({
  agent,
  onConfigure,
  compact = false,
}: {
  agent: Agent;
  /** 提供时渲染「配置」按钮并回调；总览带占位场景可不传 */
  onConfigure?: (agent: Agent) => void;
  /** 紧凑模式：不渲染模型/活动行，用于空间受限的入口位 */
  compact?: boolean;
}) {
  return (
    <div
      className="group flex items-center gap-3.5 rounded-[4px] border px-3 py-4 transition-colors hover:border-[var(--color-line-strong)]"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)', transitionDuration: 'var(--dur-fast)' }}
    >
      {/* 头像（放大）+ 状态点右下（参照 ChatPanel：relative 包裹 + 白描边）
          tooltip 统一为「名字（岗位）· 状态」，直接传给 Avatar —— 外包层设 title 会被 Avatar 自身的覆盖 */}
      <span className="relative shrink-0">
        <Avatar name={agent.name} id={agent.id} size={compact ? 40 : 56} title={`${agent.name}（${agent.role}）· ${agentLabel(agent.onlineStatus)}`} />
        <span
          className={`qs-dot absolute -bottom-0.5 -right-0.5 ${agentDotClass(agent.onlineStatus)}`}
          style={{ boxShadow: '0 0 0 2px var(--color-surface)', width: 10, height: 10 }}
        />
      </span>
      {/* 信息列：名字+角色一行、模型+活动一行、状态文字一行（模型等细节仅展开态显示） */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{agent.name}</span>
          <Badge>{agent.role}</Badge>
        </div>
        {!compact ? (
          <div className="qs-meta truncate text-[13px]" style={{ color: 'var(--color-ink-faint)' }}>
            {agent.model ? `模型 ${agent.model}` : '未配置模型'}
            {agent.activity ? ` · ${agent.activity}` : ''}
          </div>
        ) : null}
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
