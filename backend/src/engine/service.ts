import { APPROVAL_POINT_STAGES, WORKFLOW_STAGE_LABELS, type BoardColumn, type CopyPackage, type DeliverableDecisionInput, type ImageItem, type Task, type TaskEvent } from '@workbench/shared';
import { MockProducer, getProducer, type ReviewReport } from '../agents/producer.ts';
import { logExecution } from '../agents/execution-logger.ts';
import { markBusy, markIdle } from '../agents/runtime.ts';
import * as delivery from '../delivery/store.ts';
import { get } from '../db/client.ts';
import { ensureSchema } from '../db/ensure.ts';
import { bus } from './bus.ts';
import { TaskExecutor } from './executor.ts';
import { getOrchestrationMode } from '../db/seed.ts';

// 服务单例创建前保证表存在（幂等）
ensureSchema();

const AGENT_NAMES: Record<string, string> = {
  'agent-copy': '美美',
  'agent-design': '平平',
  'agent-supervisor': '波波',
};

/** 阶段 → 负责 Agent id（美美/平平/波波 三工位，与 STAGE_OWNER_ROLE 归属一致） */
const STAGE_AGENT: Record<string, string> = {
  requirement: 'agent-copy',
  copy: 'agent-copy',
  'main-image': 'agent-design',
  'detail-image': 'agent-design',
  review: 'agent-supervisor',
  deliver: 'agent-supervisor',
};

/** 长文本摘要截断 */
function brief(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 工作流业务服务：统一编排（图执行 / 线性降级）、审批决策联动状态机、交付物读写。
 * 状态机迁移全部走 TaskExecutor（单写者），前端/API 只消费状态（design.md Risks）。
 */
export class WorkflowService {
  private executor: TaskExecutor;

  constructor(executor: TaskExecutor = new TaskExecutor()) {
    this.executor = executor;
  }

  // ===== 任务生命周期 =====

  createTask(input: { title: string; description: string; platform: string }): Task {
    return this.executor.createTask(input);
  }

  /** 确认开工 → 自动编排推进到首个拍板点或完成 */
  async confirmAndRun(taskId: number): Promise<Task> {
    this.executor.confirmTask(taskId);
    return this.advance(taskId);
  }

  /** 从当前状态自动跑阶段链，直到待确认 / 已完成（线性降级模式：拍板点自动通过） */
  async advance(taskId: number): Promise<Task> {
    const producer = getProducer();
    let t = this.executor.getTask(taskId);
    if (!t) throw new Error(`task ${taskId} not found`);
    const linear = getOrchestrationMode() === 'linear';

    let guard = 0;
    while (t && t.column !== 'awaiting' && t.column !== 'done' && guard++ < 24) {
      const node = this.executor.nodeOf(t);
      if (!node) break;
      const task = t; // 循环内快照：闭包引用避免 let 窄化丢失（Task | undefined → Task）

      if (linear && APPROVAL_POINT_STAGES.includes(node.id) && t.column === 'progress') {
        // 线性降级：拍板点自动通过
        t = this.executor.approve(t.id);
        continue;
      }

      switch (node.id) {
        case 'requirement': {
          await this.runStage(task, node.id, () => producer.produceRequirement(task), (r) => `上架需求单已生成：${brief((r as { summary: string }).summary)}`);
          t = this.executor.onStageCompleted(t.id, node.id);
          break;
        }
        case 'copy': {
          const cp = (await this.runStage(task, node.id, () => producer.produceCopy(task), (r) => `文案标题：${(r as CopyPackage).title}`)) as CopyPackage;
          delivery.saveDeliverable(t.id, node.id, 'copy', cp);
          t = this.executor.onStageCompleted(t.id, node.id);
          break;
        }
        case 'main-image':
        case 'detail-image': {
          await this.runStage(task, node.id, () => this.produceImages(task, node.id, node.parallelGroups ?? [], producer), (r) => `生成 ${r as number} 张图片`);
          t = this.executor.onStageCompleted(t.id, node.id);
          break;
        }
        case 'review': {
          const report = (await this.runStage(task, node.id, () => producer.produceReview(task), (r) => {
            const rep = r as ReviewReport;
            return `校对结论：${rep.issues.length ? `发现 ${rep.issues.length} 处问题，触发返工` : '无问题，准予放行'}`;
          })) as ReviewReport;
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: '主管校对报告', points: [], outline: report.report, keywords: [] });
          t = report.issues.length
            ? this.executor.reviewRollback(t.id, report.issues[0].targetStage, report.issues[0].note)
            : this.executor.reviewPass(t.id);
          break;
        }
        case 'deliver': {
          const pack = (await this.runStage(task, node.id, () => producer.produceDeliverable(task), (r) => `交付归档：${(r as { packName: string }).packName}`)) as { packName: string; entries: string[] };
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: pack.packName, points: pack.entries, outline: '上架资料包已归档', keywords: [] });
          t = this.executor.onStageCompleted(t.id, node.id);
          break;
        }
        default:
          return t;
      }
    }
    return t ?? this.executor.getTask(taskId)!;
  }

  /** 图片并行产出：按渠道分组、逐张上报 SUB_TASK_COMPLETE（组 3 真实生图经 producer 注入）；返回产出图片数供执行日志摘要 */
  private async produceImages(
    task: Task,
    stageId: string,
    groups: { channel: string; items: string[] }[],
    producer: ReturnType<typeof getProducer>,
  ): Promise<number> {
    const results = await producer.produceImages(task, groups, (itemId, ok, dataUrl) => {
      this.executor.subTaskComplete(task.id, stageId, itemId, ok, ok ? '生成完成' : '生成失败');
    });
    const images: ImageItem[] = results.map((r) => ({
      id: r.itemId,
      name: r.itemId,
      kind: stageId === 'main-image' ? (r.itemId.includes('主图1') ? 'main' : 'sub') : 'detail',
      url: r.dataUrl ?? '',
      status: r.ok ? 'pending' : 'rejected',
      note: r.error,
    }));
    delivery.saveDeliverable(task.id, stageId, 'image', images);
    return results.length;
  }

  /**
   * 阶段执行包装：开始 markBusy / 实测耗时 / 记执行日志 / 结束 markIdle。
   * producer 失败记 failed 并向上抛（保持原状态机行为：失败不推进）。
   */
  private async runStage(
    task: Task,
    stage: string,
    producerCall: () => Promise<unknown>,
    summarize: (result: unknown) => string,
  ): Promise<unknown> {
    const agentId = STAGE_AGENT[stage];
    const row = get<{ model: string }>('SELECT model FROM agents WHERE id = ?', [agentId]);
    const model = row?.model ?? '';
    // 顶层 producer 为内置 mock 时，成功也标注 (mock)
    const isMock = getProducer() instanceof MockProducer;

    markBusy(agentId, WORKFLOW_STAGE_LABELS[stage] ?? stage);
    const started = performance.now();
    try {
      const result = await producerCall();
      const durationMs = Math.round(performance.now() - started);
      logExecution({
        agentId,
        taskId: task.id,
        stage,
        model,
        status: 'success',
        inputSummary: task.title,
        outputSummary: isMock ? `${summarize(result)} (mock)` : summarize(result),
        durationMs,
      });
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      logExecution({
        agentId,
        taskId: task.id,
        stage,
        model,
        status: 'failed',
        inputSummary: task.title,
        outputSummary: '',
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      });
      throw err;
    } finally {
      markIdle(agentId);
    }
  }

  // ===== 审批决策联动（内容交付页 → 状态机） =====

  /** 文案/图片决策；图片逐张决策，全部处理完联动状态机（有打回→返工、全采纳→推进） */
  async decideDeliverable(input: DeliverableDecisionInput): Promise<Task> {
    const { taskId, kind, decision, note } = input;

    if (kind === 'copy') {
      delivery.updateDeliverableStatus(taskId, 'copy', undefined, decision === 'approve' ? 'approved' : 'rejected');
      const task = this.executor.getTask(taskId)!;
      if (!APPROVAL_POINT_STAGES.includes(task.stage) || task.column !== 'awaiting') return task;
      if (decision === 'approve') {
        this.executor.approve(taskId);
      } else {
        this.executor.reject(taskId, note);
      }
      // 推进或返工重产出
      return this.advance(taskId);
    }

    // image：逐张决策
    delivery.updateDeliverableStatus(taskId, 'image', input.imageId, decision === 'approve' ? 'approved' : 'rejected');
    const task = this.executor.getTask(taskId)!;
    if (task.column !== 'awaiting' || !APPROVAL_POINT_STAGES.includes(task.stage)) return task;
    if (!delivery.allImagesDecided(taskId)) return task; // 尚有未决策图片，等待

    if (delivery.anyImageRejected(taskId)) {
      this.executor.reject(taskId, note ?? '图片被打回，请返工');
    } else {
      this.executor.approve(taskId);
    }
    return this.advance(taskId);
  }

  /** 主管校对人工决策（pass / rollback） */
  async reviewDecision(taskId: number, decision: 'pass' | 'rollback', targetStage?: string, note?: string): Promise<Task> {
    const task = this.executor.getTask(taskId)!;
    if (decision === 'pass') {
      this.executor.reviewPass(taskId, note);
    } else {
      this.executor.reviewRollback(taskId, targetStage ?? task.stage, note);
    }
    return this.advance(taskId);
  }

  // ===== 查询透传 =====

  listTasks(): Task[] {
    return this.executor.listTasks();
  }
  getTask(id: number): Task | undefined {
    return this.executor.getTask(id);
  }
  listEvents(taskId: number): TaskEvent[] {
    return this.executor.listEvents(taskId);
  }
  boardCounts(): Record<BoardColumn, number> {
    return this.executor.boardCounts();
  }
  deliverables(taskId: number) {
    return delivery.listDeliverables(taskId);
  }
  ownerNameOf(agentId: string | null): string {
    return agentId ? AGENT_NAMES[agentId] ?? this.executor.ownerNameOf(agentId) : '待分配';
  }
  stageLabel(stage: string): string {
    return WORKFLOW_STAGE_LABELS[stage] ?? stage;
  }
  workflow() {
    return this.executor.workflow();
  }
}

export const service = new WorkflowService();
