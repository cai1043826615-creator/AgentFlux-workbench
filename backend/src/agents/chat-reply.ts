/**
 * 聊天对话回复链路：用户发消息后由对应 Agent 用真实 LLM 回复（意见8/9）。
 * - 私聊：目标 Agent 直接回复；群聊：有进行中任务 → 当前阶段负责 Agent，否则/含指令词 → 主管波波回复并记录记忆。
 * - 回复前先发 receipt 确认（意见7），正文 kind='msg'，from=Agent 姓名。
 * - LLM 渠道不可用或调用失败 → 降级固定模板，任何异常只 console.warn 不抛（回复链路不允许中断 WS）。
 */
import type { ChatKind } from '@workbench/shared';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { get } from '../db/client.ts';
import type { AgentRow } from '../db/schema.ts';
import { listSupervisorNotes, recordSupervisorNote, sendChatMessage } from '../routes/chat.ts';
import { broadcast } from '../ws/broadcast.ts';
import { callLlm, LlmChannelUnavailableError } from './llm.ts';

export { listSupervisorNotes, recordSupervisorNote };

/** 阶段 → 负责 Agent id（与 engine/service.ts STAGE_AGENT 一致，本地复制常量避免改动 service.ts） */
const STAGE_AGENT: Record<string, string> = {
  requirement: 'agent-copy',
  copy: 'agent-copy',
  'main-image': 'agent-design',
  'detail-image': 'agent-design',
  review: 'agent-supervisor',
  deliver: 'agent-supervisor',
};

/** 主管 Agent id */
const SUPERVISOR_ID = 'agent-supervisor';

/** 群聊指令词：命中时由主管回复并记录要求 */
const DIRECTIVE_RE = /注意|要求|记住|检查|以后/;

/** 角色 → 回执确认语（意见7 简短确认） */
const RECEIPT_BY_ROLE: Record<string, string> = {
  文案: '我来梳理相关内容',
  设计师: '我来跟进视觉素材',
  主管: '我会检查并记录',
};

/** 按 id 或姓名解析 Agent（WS 私聊 to 可能是 agent id，也可能是 Agent 姓名） */
function findAgent(to: string): AgentRow | undefined {
  return get<AgentRow>('SELECT * FROM agents WHERE id = ? OR name = ?', [to, to]);
}

/** 决策回复 Agent：私聊直接对端；群聊按进行中任务阶段映射，无任务或含指令词交给主管 */
function resolveReplyAgentId(chatKind: ChatKind, to: string, body: string): string | undefined {
  if (chatKind === 'private') {
    const target = findAgent(to);
    return target ? target.id : undefined;
  }
  if (DIRECTIVE_RE.test(body)) return SUPERVISOR_ID;
  const active = get<{ stage: string }>('SELECT stage FROM tasks WHERE "column" = ? ORDER BY id DESC LIMIT 1', ['progress']);
  if (active) {
    const agentId = STAGE_AGENT[active.stage];
    if (agentId) return agentId;
  }
  return SUPERVISOR_ID;
}

/** 组装 system prompt：Agent 人设 + 挂载技能 + 进行中任务上下文 */
function buildSystemPrompt(agent: AgentRow, activeTask: { id: number; title: string; stage: string } | undefined): string {
  const lines: string[] = [`你是${agent.name}（${agent.role}）。${agent.persona}`];
  let skills: string[] = [];
  try {
    skills = JSON.parse(agent.skills) as string[];
  } catch {
    /* 坏 JSON 容错为空 */
  }
  if (skills.length > 0) lines.push(`你挂载了以下技能：${skills.join('、')}。请按技能风格回答。`);
  if (activeTask) {
    const label = WORKFLOW_STAGE_LABELS[activeTask.stage] ?? activeTask.stage;
    lines.push(`当前进行中任务 #${activeTask.id}「${activeTask.title}」，阶段：${label}。请结合任务上下文回复。`);
  }
  lines.push('用中文简洁回复用户，围绕你的职责范围，不要编造未发生的事实。');
  return lines.join('\n');
}

/**
 * 处理用户消息后的 Agent 回复（由 ws/broadcast 异步触发，不阻塞 WS）。
 * 流程：决策 Agent → 发 receipt 确认 → 主管分支记录要求 → callLlm 生成正文（失败降级模板）→ 广播 msg。
 * 全部逻辑 try/catch：任何异常只 console.warn，不向上抛。
 */
export async function handleAgentReply(chatKind: ChatKind, to: string, body: string): Promise<void> {
  try {
    const agentId = resolveReplyAgentId(chatKind, to, body);
    if (!agentId) {
      console.warn(`[chat-reply] 未找到可回复的 Agent（to=${to}），跳过回复`);
      return;
    }
    const agent = get<AgentRow>('SELECT * FROM agents WHERE id = ?', [agentId]);
    if (!agent) {
      console.warn(`[chat-reply] Agent ${agentId} 不存在，跳过回复`);
      return;
    }

    // 意见7：先发 receipt 收到确认，再回复正文
    const confirm = RECEIPT_BY_ROLE[agent.role] ?? '我会尽快处理';
    const receipt = sendChatMessage(chatKind, agent.name, to, `收到你的消息，${confirm}。`, 'receipt');
    broadcast({ type: 'chat:message', message: receipt });

    // 主管分支：记忆用户要求（供后续 review 阶段注入）
    if (agentId === SUPERVISOR_ID && chatKind === 'group') {
      recordSupervisorNote(body);
    }

    // 正文：真实 LLM（带任务上下文与技能），不可用/失败降级固定模板
    const activeTask = get<{ id: number; title: string; stage: string }>(
      'SELECT id, title, stage FROM tasks WHERE "column" = ? ORDER BY id DESC LIMIT 1',
      ['progress'],
    );
    const system = buildSystemPrompt(agent, activeTask);
    let reply: string;
    try {
      reply = (await callLlm({ agentId, system, user: body })).content.trim();
    } catch (err) {
      if (!(err instanceof LlmChannelUnavailableError)) {
        console.warn(`[chat-reply] LLM 调用失败，降级模板回复: ${err instanceof Error ? err.message : err}`);
      }
      const state = agent.online_status === 'busy' ? '正在处理' : '待命';
      reply = `我是${agent.name}，当前${state}。请稍候，我会尽快跟进。`;
    }
    if (!reply) reply = `我是${agent.name}，当前待命。请稍候，我会尽快跟进。`;

    const message = sendChatMessage(chatKind, agent.name, to, reply, 'msg');
    broadcast({ type: 'chat:message', message });
  } catch (err) {
    // 回复链路兜底：任何异常只记录，不中断 WS 消息处理
    console.warn(`[chat-reply] 回复链路异常: ${err instanceof Error ? err.message : err}`);
  }
}
