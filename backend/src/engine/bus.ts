import { EventEmitter } from 'node:events';
import type { Agent, Deliverable, Task, TaskEvent } from '@workbench/shared';

/** 引擎/运行时事件总线：状态变化发布，WS/聊天订阅（单进程 EventEmitter） */
export type BusEvent =
  | { kind: 'task'; task: Task }
  | { kind: 'event'; event: TaskEvent }
  | { kind: 'deliverable'; deliverable: Deliverable }
  | { kind: 'agent'; agent: Agent }
  | { kind: 'approval'; taskId: number; stage: string };

export class Bus extends EventEmitter {
  emitTask(task: Task): void {
    this.emit('task', { kind: 'task', task } satisfies BusEvent);
  }
  emitEvent(event: TaskEvent): void {
    this.emit('event', { kind: 'event', event } satisfies BusEvent);
  }
  emitDeliverable(deliverable: Deliverable): void {
    this.emit('deliverable', { kind: 'deliverable', deliverable } satisfies BusEvent);
  }
  emitAgent(agent: Agent): void {
    this.emit('agent', { kind: 'agent', agent } satisfies BusEvent);
  }
  emitApproval(taskId: number, stage: string): void {
    this.emit('approval', { kind: 'approval', taskId, stage } satisfies BusEvent);
  }
}

export const bus = new Bus();
