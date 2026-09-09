import type { WebSocket } from 'ws';
import type { Agent, Deliverable, Message, Task, TaskEvent, WSClientMessage, WSServerMessage } from '@workbench/shared';
import { USER_NAME } from '@workbench/shared';
import { bus } from '../engine/bus.ts';
import { sendChatMessage } from '../routes/chat.ts';

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
}

/** 订阅引擎总线 → WS 广播 */
export function wireBroadcast(): void {
  bus.on('task', (e: { kind: 'task'; task: Task }) => broadcast({ type: 'task:update', task: e.task }));
  bus.on('event', (e: { kind: 'event'; event: TaskEvent }) => broadcast({ type: 'event:new', event: e.event }));
  bus.on('deliverable', (e: { kind: 'deliverable'; deliverable: Deliverable }) =>
    broadcast({ type: 'deliverable:update', deliverable: e.deliverable }),
  );
  bus.on('agent', (e: { kind: 'agent'; agent: Agent }) => broadcast({ type: 'agent:status', agent: e.agent }));
  bus.on('approval', (e: { kind: 'approval'; taskId: number; stage: string }) =>
    broadcast({ type: 'approval:prompt', taskId: e.taskId, stage: e.stage }),
  );
}
