import { ECOM_WORKFLOW, STAGE_OWNER_ROLE, SYSTEM_NAME, type TaskEvent } from '@workbench/shared';
import { bus, type BusEvent } from '../engine/bus.ts';
import { sendChatMessage } from '../routes/chat.ts';
import { get } from '../db/client.ts';
import { broadcast } from '../ws/broadcast.ts';

/**
 * 事件播报器：订阅引擎事件总线，把任务状态事件转成中文播报写入工作群
 * （chat_kind='group', from='系统', to='全体', kind='evt'）并全量广播 chat:message。
 * 完成类事件（STAGE_COMPLETED / SUB_TASK_COMPLETE 成功 / REVIEW_PASSED）额外落库并广播
 * 一条 kind='msg' 的 Agent 署名气泡（from=Agent 姓名），与居中 evt 播报并存。
 * 在 index.ts main() 中 seed() 后调用 installAnnouncer() 安装。
 */

/** 角色 → Agent 名（与工位映射一致） */
const ROLE_TO_NAME: Record<string, string> = {
  文案: '美美',
  设计师: '平平',
  主管: '波波',
};

/** 阶段 id → 负责 Agent 名 */
function ownerNameOfStage(stage: string): string {
  return ROLE_TO_NAME[STAGE_OWNER_ROLE[stage] ?? ''] ?? '';
}

/** 确认点采纳后下一阶段负责 Agent 名（沿 approved 边） */
function nextOwnerNameOfStage(stage: string): string {
  const edge = ECOM_WORKFLOW.edges.find((e) => e.from === stage && e.condition === 'approved');
  return edge ? ownerNameOfStage(edge.to) : '';
}

/** payload 取值宽松转字符串（未知值容错） */
function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

/** 事件 → 中文播报文案；未覆盖的事件返回 null（不播报） */
function announceBody(e: TaskEvent): string | null {
  const { type, taskId, payload } = e;
  const note = str(payload.note);
  const noteSuffix = note ? `（${note}）` : '';
  switch (type) {
    case 'TASK_CREATED':
      return `任务 #${taskId}「${str(payload.title)}」已创建，等待确认开工`;
    case 'TASK_CONFIRMED': {
      const stage = str(payload.stage);
      return `任务 #${taskId} 已开工，${ownerNameOfStage(stage)} 开始「${str(payload.stageLabel)}」`;
    }
    case 'STAGE_COMPLETED':
      if (payload.done === true) return `任务 #${taskId} 已完成全部阶段，交付完成`;
      if (payload.awaitingApproval === true) return `${str(payload.stageLabel)} 完成 · 待你确认`;
      return `${str(payload.stageLabel)} 完成 · 自动推进`;
    case 'APPROVED': {
      const stage = str(payload.stage);
      return `你已采纳「${str(payload.stageLabel)}」，${nextOwnerNameOfStage(stage)} 继续推进`;
    }
    case 'REJECTED':
      return `「${str(payload.stageLabel)}」被打回返工${noteSuffix}`;
    case 'REVIEW_PASSED':
      return `任务 #${taskId} 通过主管校对，进入交付完成`;
    case 'REVIEW_ROLLBACK':
      return `主管校对发现问题，已回退至「${str(payload.targetLabel)}」返工${noteSuffix}`;
    case 'SUB_TASK_COMPLETE':
      return payload.ok === false
        ? `「${str(payload.itemId)}」生成失败`
        : `「${str(payload.itemId)}」生成完成`;
    default:
      return null; // DELIVERABLE_DECIDED 等不播报
  }
}

/** 完成类事件 → 署名气泡文案；非完成类事件返回 null（不署名播报） */
function signatureBody(e: TaskEvent): string | null {
  const { type, taskId, payload } = e;
  // 任务信息：有 taskId 时在气泡正文带上任务号，便于群聊定位
  const idPrefix = taskId ? `任务 #${taskId} · ` : '';
  switch (type) {
    case 'STAGE_COMPLETED': {
      const label = str(payload.stageLabel);
      if (payload.done === true) return `${idPrefix}全部阶段完成，已交付完成`;
      if (payload.awaitingApproval === true) return `${idPrefix}${label}已生成 1 版，请审阅确认`;
      return `${idPrefix}${label}已完成，自动推进下一阶段`;
    }
    case 'SUB_TASK_COMPLETE':
      // 仅成功子任务署名（失败保持 evt「生成失败」播报，不冒充完成）
      return payload.ok === true ? `${idPrefix}${str(payload.itemId)} 已生成` : null;
    case 'REVIEW_PASSED':
      return `${idPrefix}主管校对通过，进入交付完成`;
    default:
      return null;
  }
}

/** 署名气泡 from：payload.agentId 优先查 agents 表姓名；否则按阶段角色映射；再回退角色名或「AI」 */
function signatureFrom(e: TaskEvent): string {
  const agentId = str(e.payload.agentId);
  if (agentId) {
    const row = get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [agentId]);
    if (row?.name) return row.name;
  }
  const role = STAGE_OWNER_ROLE[str(e.payload.stage)] ?? '';
  return ROLE_TO_NAME[role] ?? (role || 'AI');
}

/** 安装播报器（幂等：仅订阅一次，避免重复安装导致群消息重复播报） */
let installed = false;
export function installAnnouncer(): void {
  if (installed) return;
  installed = true;
  bus.on('event', (e: BusEvent & { kind: 'event' }) => {
    const body = announceBody(e.event);
    if (body) {
      const message = sendChatMessage('group', SYSTEM_NAME, '全体', body, 'evt', e.event.taskId);
      broadcast({ type: 'chat:message', message });
    }
    // 完成类事件：额外发一条 Agent 署名气泡（kind='msg'），与原 evt 播报并存
    const sig = signatureBody(e.event);
    if (sig) {
      const message = sendChatMessage('group', signatureFrom(e.event), '全体', sig, 'msg', e.event.taskId);
      broadcast({ type: 'chat:message', message });
    }
  });
}
