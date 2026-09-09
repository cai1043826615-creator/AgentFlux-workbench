/**
 * WebSocket 协议（OpenSpec：实时通信 WS 推送 / 聊天 / 审批）
 * 服务端 → 客户端推送事件；客户端 → 服务端指令。
 */
import type {
  Agent,
  BoardColumn,
  Deliverable,
  Message,
  Task,
  TaskEvent,
} from './types.ts';

/** 客户端 → 服务端 */
export type WSClientMessage =
  | { type: 'chat:send'; chatKind: 'group' | 'private'; to: string; body: string }
  | { type: 'chat:history'; chatKind: 'group' | 'private'; to: string }
  | { type: 'task:create'; input: { title: string; description: string; platform: string } }
  | { type: 'task:confirm'; taskId: number }
  | { type: 'deliverable:decide'; taskId: number; kind: 'copy' | 'image'; imageId?: string; decision: 'approve' | 'reject'; note?: string }
  | { type: 'review:decide'; taskId: number; decision: 'pass' | 'rollback'; targetStage?: string; note?: string }
  | { type: 'ping' };

/** 服务端 → 客户端 */
export type WSServerMessage =
  | { type: 'heartbeat'; ts: number }
  | { type: 'task:update'; task: Task }
  | { type: 'task:list'; tasks: Task[] }
  | { type: 'event:new'; event: TaskEvent }
  | { type: 'event:list'; events: TaskEvent[] }
  | { type: 'chat:message'; message: Message }
  | { type: 'chat:history'; chatKind: string; messages: Message[] }
  | { type: 'agent:status'; agent: Agent }
  | { type: 'agent:list'; agents: Agent[] }
  | { type: 'deliverable:update'; deliverable: Deliverable }
  | { type: 'deliverable:list'; deliverables: Deliverable[] }
  | { type: 'approval:prompt'; taskId: number; stage: string }
  | { type: 'stats:update'; stats: { agentId: string; runs: number; successRate: number; avgDurationMs: number } }
  | { type: 'error'; message: string };

export interface HeartbeatPayload {
  type: 'heartbeat';
  ts: number;
}

/** 任务状态摘要（看板卡片所需最小集） */
export interface TaskSummary {
  id: number;
  title: string;
  stage: string;
  stageLabel: string;
  column: BoardColumn;
  ownerName: string;
  stageNote: string;
  progress: number;
}
