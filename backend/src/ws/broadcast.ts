import type { WebSocket } from 'ws';
import type { Agent, Deliverable, Message, Task, TaskEvent, WSClientMessage, WSServerMessage } from '@workbench/shared';
import { USER_NAME } from '@workbench/shared';
import { bus } from '../engine/bus.ts';
import { handleAgentReply } from '../agents/chat-reply.ts';
import { sendChatMessage } from '../routes/chat.ts';
import { get } from '../db/client.ts';

/** 已连接的 WS 客户端集合（v1 单用户，全量广播） */
const clients = new Set<WebSocket>();

export function addClient(ws: WebSocket): void {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

export function broadcast(msg: WSServerMessage): void {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === c.OPEN) c.send(data);
  }
}

/**
 * ownerName 口径与 engine 一致（读 agents 表显示名；无负责人 → 待分配）。
 * 广播负载补 ownerName（D-09）：前端 taskMerge 可拿到权威显示名，不再 `?? prev` 锁死旧值。
 */
function ownerNameOf(agentId: string | null): string {
  if (!agentId) return '待分配';
  const row = get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [agentId]);
  return row?.name ?? agentId;
}

/**
 * 处理客户端 WS 消息（chat:send）。工作台单用户场景：写入 messages（from='你'）后全量广播，
 * 其余指令（ping 等）由调用方保持原逻辑处理。
 */
export function handleWsClientMessage(raw: unknown): void {
  let msg: WSClientMessage | undefined;
  if (typeof raw === 'string') {
    try {
      msg = JSON.parse(raw) as WSClientMessage;
    } catch {
      return; // 忽略非法 JSON
    }
  } else if (raw && typeof raw === 'object') {
    msg = raw as WSClientMessage;
  } else {
    return;
  }
  if (msg?.type !== 'chat:send') return;
  const body = (msg.body ?? '').trim();
  if (!body) return; // 空消息不落库
  // 群聊统一归属 '全体'，与历史查询过滤条件一致
  const to = msg.chatKind === 'group' ? '全体' : msg.to;
  const message: Message = sendChatMessage(msg.chatKind, USER_NAME, to, body);
  broadcast({ type: 'chat:message', message });
  // 异步触发 Agent 回复（不 await，避免阻塞 WS；setTimeout 保证回复落在同步流之后）
  setTimeout(() => {
    void handleAgentReply(msg.chatKind, to, body).catch((err) => console.warn(`[chat-reply] 触发失败: ${err instanceof Error ? err.message : err}`));
  }, 0);
}

/** 订阅引擎总线 → WS 广播 */
export function wireBroadcast(): void {
  bus.on('task', (e: { kind: 'task'; task: Task }) => {
    // D-09：task:update 负载补 ownerName（避免前端 taskMerge `?? prev` 锁死旧显示名）
    const task = { ...e.task, ownerName: ownerNameOf(e.task.ownerAgentId) } as Task;
    broadcast({ type: 'task:update', task });
  });
  bus.on('event', (e: { kind: 'event'; event: TaskEvent }) => broadcast({ type: 'event:new', event: e.event }));
  bus.on('deliverable', (e: { kind: 'deliverable'; deliverable: Deliverable }) =>
    broadcast({ type: 'deliverable:update', deliverable: e.deliverable }),
  );
  bus.on('agent', (e: { kind: 'agent'; agent: Agent }) => broadcast({ type: 'agent:status', agent: e.agent }));
  bus.on('approval', (e: { kind: 'approval'; taskId: number; stage: string }) =>
    broadcast({ type: 'approval:prompt', taskId: e.taskId, stage: e.stage }),
  );
}
