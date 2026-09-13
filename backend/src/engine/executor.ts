import {
  WORKFLOW_STAGE_LABELS,
  type BoardColumn,
  type Task,
  type TaskBrief,
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
  let brief: Task['brief'] = null;
  if (row.brief) {
    try {
      brief = JSON.parse(row.brief) as Task['brief'];
    } catch {
      brief = null;
    }
  }
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
    brief,
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

/** 把毫秒差格式化为「已等待 X 小时 / X 分钟」（粗粒度，避免无意义精度） */
function waitedText(sinceIso: string): string {
  const ms = Date.now() - new Date(sinceIso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return '已等待不到 1 分钟';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `已等待 ${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `已等待 ${hours} 小时`;
  return `已等待 ${Math.floor(hours / 24)} 天`;
}

/** 该任务最近一次进入待确认的时刻（STAGE_COMPLETED 且 awaitingApproval=true）；无则返回 null */
function awaitingSince(taskId: number): string | null {
  const rows = all<TaskEventRow>('SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 60', [taskId]);
  for (const r of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(r.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (r.type === 'STAGE_COMPLETED' && payload.awaitingApproval === true) return r.created_at;
    // 往回遇到「已离开待确认」的事件（确认采纳/打回/放行/回退）即停止，避免取到上一轮
    if (r.type === 'APPROVED' || r.type === 'REJECTED' || r.type === 'REVIEW_PASSED' || r.type === 'REVIEW_ROLLBACK') return null;
  }
  return null;
}

/**
 * 卡片副标题（stage note）。
 * P1·1.7：这里只产出「补足信息」，不再复述状态列/阶段——状态已由卡片上的 badge 表达，
 * 两边说同一件事会让卡片显得啰嗦。done 列不再返回重复文案（调用方亦不再渲染该行）。
 * 待确认时补「已等待 X 小时」：等待时长从事件日志推导（不新增列），
 * 缺失时退回「等待你处理」，绝不渲染空文案。
 */
function stageNoteOf(stageNode: WorkflowNode | undefined, column: BoardColumn, ownerName?: string, taskId?: number): string {
  if (column === 'awaiting' && stageNode) {
    const since = taskId != null ? awaitingSince(taskId) : null;
    return since ? `等待你处理 · ${waitedText(since)}` : '等待你处理';
  }
  if (column === 'done') return '';
  if (stageNode) {
    return ownerName ? `由 ${ownerName} 处理中` : '处理中';
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
  createTask(input: { title: string; description: string; platforms: string[]; referenceImage?: string; workflowId?: string; brief?: TaskBrief | null }): Task {
    const id = tx(() => {
      const res = run(
        'INSERT INTO tasks (title, workflow_id, stage, column, owner_agent_id, description, platform, reference_image, brief, progress, stage_note, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          input.title,
          input.workflowId ?? this.wf.id,
          this.wf.nodes[0].id,
          'planned',
          null,
          input.description,
          (input.platforms ?? []).join(','),
          input.referenceImage ?? null,
          input.brief ? JSON.stringify(input.brief) : null,
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
        // 先记事件再算副标题：等待时长取自本次 STAGE_COMPLETED 的时间戳
        this.logEventSync(taskId, 'STAGE_COMPLETED', { stage: stageId, stageLabel: node.label, awaitingApproval: true });
        run('UPDATE tasks SET column = ?, stage_note = ?, owner_agent_id = ? WHERE id = ?', [
          'awaiting',
          stageNoteOf(node, 'awaiting', undefined, taskId),
          AGENT_BY_ROLE[node.ownerRole] ?? row.owner_agent_id,
          taskId,
        ]);
        bus.emitApproval(taskId, stageId);
        return toTask(getTaskRow(taskId)!);
      }

      // 无确认点：记录完成并自动推进下一节点
      this.logEventSync(taskId, 'STAGE_COMPLETED', { stage: stageId, stageLabel: node?.label, autoAdvance: true });
      return this.moveTo(row, nextNode(this.wf, stageId), stageId);
    });
  }

  /** 确认点采纳：沿 approved 边推进下一节点；meta 合并进 APPROVED 事件 payload（B11：失败图片数等警示信息） */
  approve(taskId: number, meta?: Record<string, unknown>): Task {
    return tx(() => {
      const row = getTaskRow(taskId);
      if (!row) throw new Error(`task ${taskId} not found`);
      const node = this.wf.nodes.find((n) => n.id === row.stage);
      if (!node?.approvalPoint) throw new Error(`task ${taskId} not at approval point`);
      const next = approvalEdge(this.wf, row.stage, true);
      this.logEventSync(taskId, 'APPROVED', { stage: row.stage, stageLabel: node.label, ...(meta ?? {}) });
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
