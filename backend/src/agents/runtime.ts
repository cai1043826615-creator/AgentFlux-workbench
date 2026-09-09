import type { Agent, AgentOnlineStatus } from '@workbench/shared';
import { get, run } from '../db/client.ts';
import type { AgentRow } from '../db/schema.ts';
import { bus } from '../engine/bus.ts';

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
