import {
  WORKFLOW_STAGE_LABELS,
  type BoardColumn,
  type Task,
  type TaskEvent,
  type TaskEventType,
  type WorkflowDefinition,
  type WorkflowNode,
} from '@workbench/shared';
import { all, get, run, tx } from '../db/client.ts';
import type { TaskEventRow, TaskRow } from '../db/schema.ts';
import { bus } from './bus.ts';
import { approvalEdge, followEdge, getNodeIndex, loadWorkflow, nextNode } from './graph.ts';

const AGENT_BY_ROLE: Record<string, string> = {
  文案: 'agent-copy',
  设计师: 'agent-design',
  主管: 'agent-supervisor',
};

function now(): string {
  return new Date().toISOString();
}

/** TaskRow → shared Task */
function toTask(row: TaskRow): Task {
  const platforms = (row.platform ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: row.id,
    title: row.title,
    workflowId: row.workflow_id,
    stage: row.stage,
    column: row.column as BoardColumn,
    ownerAgentId: row.owner_agent_id,
    description: row.description,
    platform: platforms[0] ?? '',
    platforms: platforms.length > 0 ? platforms : undefined,
    referenceImage: row.reference_image ?? undefined,
    progress: row.progress,
    stageNote: row.stage_note,
    archived: row.archived === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toEvent(row: TaskEventRow): TaskEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return { id: row.id, taskId: row.task_id, type: row.type as TaskEventType, payload, createdAt: row.created_at };
}

function progressOf(wf: WorkflowDefinition, stage: string, done: boolean): number {
  if (done) return 100;
  const idx = getNodeIndex(wf, stage);
  return Math.round((idx / (wf.nodes.length - 1)) * 100);
}

function stageNoteOf(stageNode: WorkflowNode | undefined, column: BoardColumn, ownerName?: string): string {
  if (column === 'awaiting' && stageNode) return `${stageNode.label}完成 · 待你确认`;
  if (column === 'done') return '已交付 · 已完成';
  if (stageNode) {
    return ownerName ? `${stageNode.label} · ${ownerName} 处理中` : `${stageNode.label} · 进行中`;
  }
  return '待领取';
}

/**
 * 图执行引擎：状态迁移只由事件触发（STAGE_COMPLETED / APPROVED / REJECTED /
 * REVIEW_PASSED / REVIEW_ROLLBACK / SUB_TASK_COMPLETE），每个事件写入任务事件日志
 * 并经事件总线广播（WS 推送 + 群聊通知同源）。
 */
export class TaskExecutor {
  private wf: WorkflowDefinition;

  constructor(workflowId?: string) {
    this.wf = loadWorkflow(workflowId);
  }

  // ===== 任务生命周期 =====

  /** 创建任务（未确认，列=规划中）；platforms 多选逗号拼接存储，referenceImage 参考图地址 */
  createTask(input: { title: string; description: string; platforms: string[]; referenceImage?: string; workflowId?: string }): Task {
    const id = tx(() => {
      const res = run(
        'INSERT INTO tasks (title, workflow_id, stage, column, owner_agent_id, description, platform, reference_image, progress, stage_note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          input.title,
          input.workflowId ?? this.wf.id,
          this.wf.nodes[0].id,
          'planned',
          null,
          input.description,
          (input.platforms ?? []).join(','),
          input.referenceImage ?? null,
          0,
          stageNoteOf(this.wf.nodes[0], 'planned'),
          '你',
          now(),
        ],
      );
      this.logEventSync(res.lastInsertRowid, 'TASK_CREATED', { title: input.title, platforms: input.platforms });
      return res.lastInsertRowid;
    });
    const task = this.getTask(id)!;
    bus.emitTask(task);
    return task;
  }

  /** 确认开工：进入需求对齐（进行中） */
  confirmTask(taskId: number): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      const first = this.wf.nodes[0];
      const ownerId = AGENT_BY_ROLE[first.ownerRole] ?? null;
      run('UPDATE tasks SET stage = ?, column = ?, owner_agent_id = ?, progress = ?, stage_note = ? WHERE id = ?', [
        first.id,
        'progress',
        ownerId,
        progressOf(this.wf, first.id, false),
        stageNoteOf(first, 'progress'),
        taskId,
      ]);
      this.logEventSync(taskId, 'TASK_CONFIRMED', { stage: first.id, stageLabel: first.label });
      return toTask(getTaskRow(taskId)!);
    });
  }

  /** 阶段产出完成（Agent 报告）→ 状态机流转 */
  onStageCompleted(taskId: number, stageId: string): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      if (row.stage !== stageId) throw new Error(`task ${taskId} not in stage ${stageId}`);

      const node = this.wf.nodes.find((n) => n.id === stageId);
      const isLast = getNodeIndex(this.wf, stageId) === this.wf.nodes.length - 1;

      if (isLast) {
        run('UPDATE tasks SET column = ?, progress = ?, stage_note = ?, owner_agent_id = ? WHERE id = ?', [
          'done',
          100,
          '已交付 · 已完成',
          AGENT_BY_ROLE[node?.ownerRole ?? ''] ?? row.owner_agent_id,
          taskId,
        ]);
        this.logEventSync(taskId, 'STAGE_COMPLETED', { stage: stageId, stageLabel: node?.label, done: true });
        return toTask(getTaskRow(taskId)!);
      }

      if (node?.approvalPoint) {
        run('UPDATE tasks SET column = ?, stage_note = ?, owner_agent_id = ? WHERE id = ?', [
          'awaiting',
          stageNoteOf(node, 'awaiting'),
          AGENT_BY_ROLE[node.ownerRole] ?? row.owner_agent_id,
          taskId,
        ]);
        this.logEventSync(taskId, 'STAGE_COMPLETED', { stage: stageId, stageLabel: node.label, awaitingApproval: true });
        bus.emitApproval(taskId, stageId);
        return toTask(getTaskRow(taskId)!);
      }

      // 无确认点：记录完成并自动推进下一节点
      this.logEventSync(taskId, 'STAGE_COMPLETED', { stage: stageId, stageLabel: node?.label, autoAdvance: true });
      return this.moveTo(row, nextNode(this.wf, stageId), stageId);
    });
  }

  /** 确认点采纳：沿 approved 边推进下一节点 */
  approve(taskId: number): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      const node = this.wf.nodes.find((n) => n.id === row.stage);
      if (!node?.approvalPoint) throw new Error(`task ${taskId} not at approval point`);
      const next = approvalEdge(this.wf, row.stage, true);
      this.logEventSync(taskId, 'APPROVED', { stage: row.stage, stageLabel: node.label });
      return this.moveTo(row, next, row.stage);
    });
  }

  /** 确认点打回：沿 rejected 边回自身节点返工（进行中） */
  reject(taskId: number, note?: string): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      const node = this.wf.nodes.find((n) => n.id === row.stage);
      if (!node?.approvalPoint) throw new Error(`task ${taskId} not at approval point`);
      run('UPDATE tasks SET column = ?, stage_note = ?, progress = ? WHERE id = ?', [
        'progress',
        `${node.label} · 返工中`,
        progressOf(this.wf, row.stage, false),
        taskId,
      ]);
      this.logEventSync(taskId, 'REJECTED', { stage: row.stage, stageLabel: node.label, note: note ?? '' });
      return toTask(getTaskRow(taskId)!);
    });
  }

  /** 主管校对通过：沿 passed 边到交付完成 */
  reviewPass(taskId: number, note?: string): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      const next = followEdge(this.wf, row.stage, 'passed');
      if (!next) throw new Error(`task ${taskId} has no passed edge from ${row.stage}`);
      this.logEventSync(taskId, 'REVIEW_PASSED', { stage: row.stage, note: note ?? '' });
      return this.moveTo(row, next, row.stage);
    });
  }

  /** 主管校对发现问题：沿 rollback 边回退受影响节点（已完成→进行中） */
  reviewRollback(taskId: number, targetStage: string, note?: string): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      const target = this.wf.nodes.find((n) => n.id === targetStage);
      if (!target) throw new Error(`rollback target ${targetStage} not found`);
      run('UPDATE tasks SET stage = ?, column = ?, progress = ?, stage_note = ?, owner_agent_id = ? WHERE id = ?', [
        targetStage,
        'progress',
        progressOf(this.wf, targetStage, false),
        stageNoteOf(target, 'progress'),
        AGENT_BY_ROLE[target.ownerRole] ?? row.owner_agent_id,
        taskId,
      ]);
      this.logEventSync(taskId, 'REVIEW_ROLLBACK', {
        fromStage: row.stage,
        targetStage,
        targetLabel: target.label,
        note: note ?? '',
      });
      return toTask(getTaskRow(taskId)!);
    });
  }

  /** 并行子任务完成：逐张上报事件 */
  subTaskComplete(taskId: number, stageId: string, itemId: string, ok: boolean, detail?: string): Task | undefined {
    this.logEventSync(taskId, 'SUB_TASK_COMPLETE', { stage: stageId, itemId, ok, detail: detail ?? '' });
    return this.getTask(taskId);
  }

  // ===== 查询 =====

  getTask(id: number): Task | undefined {
    const row = getTaskRow(id);
    return row ? toTask(row) : undefined;
  }

  listTasks(): Task[] {
    return all<TaskRow>('SELECT * FROM tasks ORDER BY id DESC').map(toTask);
  }

  // ===== 归档（归档≠删除：仅置位 archived，数据保留，可恢复回原列） =====

  archiveTask(taskId: number): Task {
    return tx(() => {
      run('UPDATE tasks SET archived = 1 WHERE id = ?', [taskId]);
      const task = toTask(getTaskRow(taskId)!);
      bus.emitTask(task);
      return task;
    });
  }

  restoreTask(taskId: number): Task {
    return tx(() => {
      run('UPDATE tasks SET archived = 0 WHERE id = ?', [taskId]);
      const task = toTask(getTaskRow(taskId)!);
      bus.emitTask(task);
      return task;
    });
  }

  listEvents(taskId: number): TaskEvent[] {
    return all<TaskEventRow>('SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC', [taskId]).map(toEvent);
  }

  boardCounts(): Record<BoardColumn, number> {
    const counts: Record<BoardColumn, number> = { planned: 0, progress: 0, awaiting: 0, done: 0 };
    for (const t of this.listTasks()) {
      if (t.archived) continue; // 归档任务不占看板列计数
      counts[t.column] += 1;
    }
    return counts;
  }

  ownerNameOf(agentId: string | null): string {
    if (!agentId) return '待分配';
    const row = get<{ name: string }>('SELECT name FROM agents WHERE id = ?', [agentId]);
    return row?.name ?? agentId;
  }

  stageLabel(stage: string): string {
    return WORKFLOW_STAGE_LABELS[stage] ?? stage;
  }

  nodeOf(task: Task): WorkflowNode | undefined {
    return this.wf.nodes.find((n) => n.id === task.stage);
  }

  workflow(): WorkflowDefinition {
    return this.wf;
  }

  // ===== 内部 =====

  private moveTo(row: TaskRow, next: WorkflowNode | undefined, fromStage: string): Task {
    if (!next) {
      run('UPDATE tasks SET column = ?, progress = ?, stage_note = ? WHERE id = ?', ['done', 100, '已交付 · 已完成', row.id]);
      this.logEventSync(row.id, 'STAGE_COMPLETED', { stage: fromStage, done: true });
      return toTask(getTaskRow(row.id)!);
    }
    const ownerId = AGENT_BY_ROLE[next.ownerRole] ?? row.owner_agent_id;
    run('UPDATE tasks SET stage = ?, column = ?, owner_agent_id = ?, progress = ?, stage_note = ? WHERE id = ?', [
      next.id,
      'progress',
      ownerId,
      progressOf(this.wf, next.id, false),
      stageNoteOf(next, 'progress'),
      row.id,
    ]);
    this.logEventSync(row.id, 'STAGE_STARTED', { stage: next.id, stageLabel: next.label });
    return toTask(getTaskRow(row.id)!);
  }

  private logEventSync(taskId: number, type: TaskEventType, payload: Record<string, unknown>): void {
    const createdAt = now();
    const res = run('INSERT INTO task_events (task_id, type, payload, created_at) VALUES (?,?,?,?)', [
      taskId,
      type,
      JSON.stringify(payload),
      createdAt,
    ]);
    bus.emitEvent({ id: res.lastInsertRowid, taskId, type, payload, createdAt });
  }
}

function getTaskRow(id: number): TaskRow | undefined {
  return get<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
}
