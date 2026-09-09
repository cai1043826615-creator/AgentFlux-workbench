import type { AgentOnlineStatus } from '@workbench/shared';
import type { BadgeTone } from '../components/ui.tsx';

/**
 * Agent 在线状态 → 语义元数据（单一事实源）。
 *
 * 历史背景：App / ChatPanel / WorkstationBar / ObservabilityView 曾各自内联同一套
 * 「状态 → 状态点 class / 文案 / 颜色」映射（重复 4~5 处）。此处统一收敛。
 *
 * 注意：各页面历史上存在有意的文案/色调差异（如聊天栏 unconfigured 显示「未连接API」、
 * 忙碌状态在任务顶栏显示「忙碌中」、idle 在聊天栏用灰点）。因此本工具提供「默认值 +
 * 显式覆盖」：默认值遵循工位栏（WorkstationBar）语义；需要不同文案/颜色的页面在调用处
 * 显式传入覆盖，保证渲染结果与改动前逐像素一致，不改变任何现有功能。
 */

export interface AgentStatusMeta {
  /** qs-dot 样式类（含 busy 脉冲） */
  dotClass: string;
  /** 默认文案 */
  label: string;
  /** 状态文字颜色 token */
  color: string;
  /** 徽章 tone */
  badgeTone: BadgeTone;
}

/** 默认映射（与工位栏 WorkstationBar 语义一致：busy=紫脉冲 / online·idle=绿 / unconfigured=灰） */
export const AGENT_STATUS_META: Record<AgentOnlineStatus, AgentStatusMeta> = {
  busy: { dotClass: 'qs-dot signal busy', label: '忙碌', color: 'var(--color-signal)', badgeTone: 'signal' },
  idle: { dotClass: 'qs-dot ok', label: '待命', color: 'var(--color-ok)', badgeTone: 'default' },
  online: { dotClass: 'qs-dot ok', label: '在线', color: 'var(--color-ok)', badgeTone: 'ok' },
  unconfigured: { dotClass: 'qs-dot unconfigured', label: '未配置', color: 'var(--color-ink-faint)', badgeTone: 'warn' },
};

export function agentDotClass(s: AgentOnlineStatus): string {
  return AGENT_STATUS_META[s].dotClass;
}

export function agentLabel(s: AgentOnlineStatus): string {
  return AGENT_STATUS_META[s].label;
}

export function agentColor(s: AgentOnlineStatus): string {
  return AGENT_STATUS_META[s].color;
}

export function agentBadgeTone(s: AgentOnlineStatus): BadgeTone {
  return AGENT_STATUS_META[s].badgeTone;
}
