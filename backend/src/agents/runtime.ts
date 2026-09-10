/**
 * Agent 运行时状态辅助：行转换、忙碌/空闲/在线标记，以及渠道配置判断（unconfigured 状态支持）。
 * routes/agents.ts 读取在线状态时可结合 isAgentConfigured 把未配置渠道的 Agent 展示为「未连接API」。
 */
import type { Agent, AgentOnlineStatus } from '@workbench/shared';
import { CHANNEL, hasImageChannel, hasLlmChannel, hasSupervisorChannel } from '../config.ts';
import { get, run } from '../db/client.ts';
import type { AgentRow } from '../db/schema.ts';
import { bus } from '../engine/bus.ts';
import { getSetting } from './channel-settings.ts';

function now(): string {
  return new Date().toISOString();
}

/** 行转换：snake_case → camelCase（skills/files JSON.parse，坏 JSON 容错为空数组） */
export function toAgent(row: AgentRow): Agent {
  let skills: string[] = [];
  let files: string[] = [];
  try {
    skills = JSON.parse(row.skills) as string[];
  } catch {
    /* ignore */
  }
  try {
    files = JSON.parse(row.files) as string[];
  } catch {
    /* ignore */
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role as Agent['role'],
    persona: row.persona,
    model: row.model,
    skills,
    files,
    onlineStatus: row.online_status as AgentOnlineStatus,
    activity: row.activity ?? undefined,
    lastActiveAt: row.last_active_at ?? undefined,
    createdAt: row.created_at,
  };
}

function load(agentId: string): AgentRow | undefined {
  return get<AgentRow>('SELECT * FROM agents WHERE id = ?', [agentId]);
}

/** 标记忙碌：更新在线状态/活动/最近活跃并经总线广播 */
export function markBusy(agentId: string, activity: string): void {
  run("UPDATE agents SET online_status = 'busy', activity = ?, last_active_at = ? WHERE id = ?", [activity, now(), agentId]);
  const row = load(agentId);
  if (row) bus.emitAgent(toAgent(row));
}

/** 标记空闲：活动回到待命，广播 */
export function markIdle(agentId: string): void {
  run("UPDATE agents SET online_status = 'idle', activity = '待命', last_active_at = ? WHERE id = ?", [now(), agentId]);
  const row = load(agentId);
  if (row) bus.emitAgent(toAgent(row));
}

/** 标记在线（签到上线），广播 */
export function markOnline(agentId: string): void {
  run("UPDATE agents SET online_status = 'online', last_active_at = ? WHERE id = ?", [now(), agentId]);
  const row = load(agentId);
  if (row) bus.emitAgent(toAgent(row));
}

/**
 * 判断 Agent 渠道是否已配置：设置面板 llmChannels 按 agent 优先，回退 .env.local 默认渠道。
 * 设计师（agent-design）走生图渠道；主管波波（agent-supervisor）走视觉审阅渠道（SUPERVISOR_*）或 LLM 渠道；其余文本 Agent 走 LLM 渠道。
 */
export function isAgentConfigured(agentId: string): boolean {
  const channels = getSetting<Record<string, { baseUrl: string; apiKey: string; model: string }>>('llmChannels') ?? {};
  if (channels[agentId]?.apiKey) return true;
  if (agentId === 'agent-design') return hasImageChannel();
  if (agentId === 'agent-supervisor') return hasSupervisorChannel() || hasLlmChannel();
  return hasLlmChannel();
}

/**
 * Agent 运行时实际使用的模型（界面展示 / 执行日志的权威来源）：
 * 主管波波在视觉审阅渠道（SUPERVISOR_*）已配置时返回该渠道模型（gpt-5.5），
 * 其余返回 agents 表存储的 model。
 */
export function effectiveModel(agentId: string, storedModel?: string): string {
  if (agentId === 'agent-supervisor' && hasSupervisorChannel()) return CHANNEL.supervisor.model;
  return storedModel ?? '';
}

/** 在线状态中文标签（意见19：unconfigured 显示「未连接API」） */
export function agentStatusLabel(status: AgentOnlineStatus): string {
  switch (status) {
    case 'online':
      return '在线';
    case 'busy':
      return '忙碌';
    case 'idle':
      return '待命';
    case 'unconfigured':
      return '未连接API';
    default:
      return '未知';
  }
}
