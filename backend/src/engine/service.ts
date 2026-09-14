import { WORKFLOW_ID, WORKFLOW_STAGE_LABELS, approvalPointsOf, isXhsWorkflow, nodeOfStage, type BoardColumn, type ComplianceReport, type CopyPackage, type Deliverable, type DeliverableDecisionInput, type ImageItem, type NotePackage, type ProvenanceResult, type ReworkInfo, type Task, type TaskBrief, type TaskEvent, type TopicOption, type XhsNote } from '@workbench/shared';
import { MockProducer, getProducer, type ReviewReport } from '../agents/producer.ts';
import { MAX_IMAGE_ATTEMPTS } from '../agents/smart-producer.ts';
import { xhsProducer } from '../agents/xhs-producer.ts';
import { logExecution } from '../agents/execution-logger.ts';
import { setLlmUsageSink, type LlmUsage } from '../agents/llm.ts';
import { markBusy, markIdle, effectiveModel } from '../agents/runtime.ts';
import * as delivery from '../delivery/store.ts';
import { buildProvenanceResult, getProvenanceResult } from '../delivery/provenance.ts';
import { getReworkInfo } from './rework.ts';
import { get, run } from '../db/client.ts';
import { ensureSchema } from '../db/ensure.ts';
import { bus } from './bus.ts';
import { TaskExecutor } from './executor.ts';
import { loadAllWorkflows } from './graph.ts';
import { getOrchestrationMode } from '../db/seed.ts';

// 服务单例创建前保证表存在（幂等）
ensureSchema();

/** 单张图片重试已达累计上限（B11 · 4.9：路由层转 400 返回可见错误） */
export class RetryLimitError extends Error {
  constructor(max: number) {
    super(`该图片已达重试上限（${max} 次），无法再次重试`);
    this.name = 'RetryLimitError';
  }
}

/** 单张图片重试被拒绝（非失败图 / 未找到 / 该阶段无交付物；B11 · 4.8） */
export class RetryNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryNotAllowedError';
  }
}

const AGENT_NAMES: Record<string, string> = {
  'agent-copy': '美美',
  'agent-design': '平平',
  'agent-supervisor': '波波',
};

/** 角色 → Agent id（与 executor.ts 的 AGENT_BY_ROLE 一致；此处用于按图节点 ownerRole 反查） */
const AGENT_BY_ROLE: Record<string, string> = {
  文案: 'agent-copy',
  设计师: 'agent-design',
  主管: 'agent-supervisor',
};

/** 兜底：图节点缺失 ownerRole 时的电商阶段映射（存量兼容，XHS 不依赖） */
const STAGE_AGENT_FALLBACK: Record<string, string> = {
  requirement: 'agent-copy',
  copy: 'agent-copy',
  'main-image': 'agent-design',
  'detail-image': 'agent-design',
  review: 'agent-supervisor',
  deliver: 'agent-supervisor',
};

/**
 * 配图数量边界（用户定案 2026-09-14）：**总数含首图**，首图固定 1 张，内页图 = 总数 − 1。
 * 默认 3（1 首图 + 2 内页）；最小 2（至少 1 张内页）；最大 7（内页最多 6 张）。
 */
const IMAGE_TOTAL_MIN = 2;
const IMAGE_TOTAL_MAX = 7;
const IMAGE_TOTAL_DEFAULT = 3;

/** 从任务 brief 取配图总数（越界/缺失回退默认值） */
function noteImageTotal(task: Task): number {
  const raw = task.brief?.imageCount;
  const n = typeof raw === 'number' ? Math.floor(raw) : Number.NaN;
  if (!Number.isFinite(n)) return IMAGE_TOTAL_DEFAULT;
  return Math.min(IMAGE_TOTAL_MAX, Math.max(IMAGE_TOTAL_MIN, n));
}

/** 内页图数量 = 配图总数 − 1（首图固定 1 张） */
function noteInnerImageCount(task: Task): number {
  return noteImageTotal(task) - 1;
}

/** 长文本摘要截断 */
function brief(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 某阶段图片交付物的图片总数（推进警示「全部失败」判定用；无交付物返回 0） */
function deliveryImageTotal(taskId: number, stage: string): number {
  const d = delivery.getDeliverable(taskId, stage, 'image');
  if (!d) return 0;
  try {
    return (JSON.parse(d.content) as ImageItem[]).length;
  } catch {
    return 0;
  }
}

/**
 * 工作流业务服务：统一编排（图执行 / 线性降级）、审批决策联动状态机、交付物读写。
 * 状态机迁移全部走 TaskExecutor（单写者），前端/API 只消费状态（design.md Risks）。
 */
export class WorkflowService {
  /** 按 workflowId 分派的 executor 集合（每条工作流一个状态机实例，互不干扰） */
  private executors = new Map<string, TaskExecutor>();

  constructor(executor: TaskExecutor = new TaskExecutor()) {
    this.executors.set(executor.workflow().id, executor);
  }

  /** 取（或懒创建）某工作流的 executor */
  private executorFor(workflowId?: string): TaskExecutor {
    const id = workflowId ?? WORKFLOW_ID;
    let ex = this.executors.get(id);
    if (!ex) {
      ex = new TaskExecutor(id);
      this.executors.set(id, ex);
    }
    return ex;
  }

  /** 按任务取 executor（所有读写路径统一入口） */
  private ex(task: Task): TaskExecutor {
    return this.executorFor(task.workflowId);
  }

  /** 某任务当前阶段是否为其所属工作流的人工确认点 */
  private isApprovalPoint(task: Task): boolean {
    return approvalPointsOf(task.workflowId).includes(task.stage);
  }

  // ===== 任务生命周期 =====

  createTask(input: { title: string; description: string; platforms: string[]; referenceImage?: string; workflowId?: string; brief?: TaskBrief | null }): Task {
    return this.executorFor(input.workflowId).createTask(input);
  }

  /** 确认开工 → 自动编排推进到首个确认点或完成 */
  async confirmAndRun(taskId: number): Promise<Task> {
    const t0 = this.getTask(taskId);
    if (!t0) throw new Error(`task ${taskId} not found`);
    this.ex(t0).confirmTask(taskId);
    return this.advance(taskId);
  }

  /** 从当前状态自动跑阶段链，直到待确认 / 已完成（线性降级模式：确认点自动通过） */
  async advance(taskId: number): Promise<Task> {
    const first = this.getTask(taskId);
    if (!first) throw new Error(`task ${taskId} not found`);
    // 按工作流分派：XHS 走独立分支，绝不进入电商的 switch（阶段 key 语义不同）
    if (isXhsWorkflow(first.workflowId)) return this.advanceXhs(taskId);
    return this.advanceEcom(taskId);
  }

  /** 电商工作流阶段链（原 advance 主体，逻辑不变） */
  private async advanceEcom(taskId: number): Promise<Task> {
    const producer = getProducer();
    let t = this.getTask(taskId);
    if (!t) throw new Error(`task ${taskId} not found`);
    const linear = getOrchestrationMode() === 'linear';

    let guard = 0;
    while (t && t.column !== 'awaiting' && t.column !== 'done' && guard++ < 24) {
      const node = this.ex(t).nodeOf(t);
      if (!node) throw new Error(`task ${t.id} 阶段 ${t.stage} 不在工作流 ${t.workflowId} 的节点中`);
      const task: Task = t; // 循环内快照：闭包引用避免 let 窄化丢失（Task | undefined → Task）

      if (linear && this.isApprovalPoint(task) && t.column === 'progress') {
        // 线性降级：确认点自动通过
        t = this.ex(task).approve(t.id);
        continue;
      }

      switch (node.id) {
        case 'requirement': {
          await this.runStage(task, node.id, () => producer.produceRequirement(task), (r) => `上架需求单已生成：${brief((r as { summary: string }).summary)}`);
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'copy': {
          const cp = (await this.runStage(task, node.id, () => producer.produceCopy(task), (r) => `文案标题：${(r as CopyPackage).title}`)) as CopyPackage;
          delivery.saveDeliverable(t.id, node.id, 'copy', cp);
          // B1 · 2.4：文案产出后立即生成并持久化溯源结果（kind='provenance'，同一任务重复产出时版本递增）
          try {
            const result = await buildProvenanceResult(t.id, cp);
            delivery.saveDeliverable(t.id, node.id, 'provenance', result);
          } catch (err) {
            // 溯源失败不阻塞文案产出（板块 B 异常降级：板块 A 照常执行）
            console.warn(`[provenance] 任务 #${t.id} 溯源结果生成失败，跳过：${err instanceof Error ? err.message : err}`);
          }
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'main-image':
        case 'detail-image': {
          await this.runStage(task, node.id, () => this.produceImages(task, node.id, node.parallelGroups ?? [], producer), (r) => `生成 ${r as number} 张图片`);
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'review': {
          const report = (await this.runStage(task, node.id, () => producer.produceReview(task), (r) => {
            const rep = r as ReviewReport;
            return `校对结论：${rep.issues.length ? `发现 ${rep.issues.length} 处问题，触发返工` : '无问题，准予放行'}`;
          })) as ReviewReport;
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: '主管校对报告', points: [], outline: report.report, keywords: [] });
          t = report.issues.length
            ? this.ex(task).reviewRollback(t.id, report.issues[0].targetStage, report.issues[0].note)
            : this.ex(task).reviewPass(t.id);
          break;
        }
        case 'deliver': {
          const pack = (await this.runStage(task, node.id, () => producer.produceDeliverable(task), (r) => `交付完成：${(r as { packName: string }).packName}`)) as { packName: string; entries: string[] };
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: pack.packName, points: pack.entries, outline: '上架资料包已完成', keywords: [] });
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        default:
          return t;
      }
    }
    return t ?? this.getTask(taskId)!;
  }

  /**
   * 小红书种草笔记阶段链（架构与 advanceEcom 一致：复用 runStage 包装，只换 stage 分支）。
   * 合规审核为自动节点：通过走 passed 边，有问题按 targetStage 走 rollback 边，从不进「待确认」。
   */
  private async advanceXhs(taskId: number): Promise<Task> {
    let t = this.getTask(taskId);
    if (!t) throw new Error(`task ${taskId} not found`);
    const linear = getOrchestrationMode() === 'linear';

    let guard = 0;
    while (t && t.column !== 'awaiting' && t.column !== 'done' && guard++ < 24) {
      const node = this.ex(t).nodeOf(t);
      if (!node) throw new Error(`task ${t.id} 阶段 ${t.stage} 不在工作流 ${t.workflowId} 的节点中`);
      const task: Task = t;

      if (linear && this.isApprovalPoint(task) && t.column === 'progress') {
        t = this.ex(task).approve(t.id);
        continue;
      }

      switch (node.id) {
        case 'xhs-topic': {
          const topics = (await this.runStage(task, node.id, () => xhsProducer.produceTopic(task), (r) => `生成 ${(r as TopicOption[]).length} 个选题方向`)) as TopicOption[];
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: '选题方向', points: topics.map((x) => `${x.angle}｜${x.desc}`), outline: '', keywords: topics[0]?.anchors ?? [] });
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'xhs-copy': {
          const note = (await this.runStage(task, node.id, () => xhsProducer.produceNote(task), (r) => `笔记标题：${(r as XhsNote).title}`)) as XhsNote;
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: note.title, points: note.tags, outline: note.body, keywords: note.tags });
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'xhs-cover': {
          // 首图：只生成 1 张（确认后再进内页设计，避免一次生成全废）
          await this.runStage(task, node.id, () => this.produceNoteImages(task, node.id, [{ channel: 'img-1', items: ['首图'] }]), () => '生成首图 1 张');
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'xhs-inner': {
          // 内页图：数量由任务 brief.imageCount 决定（1-6，默认 2）
          const count = noteInnerImageCount(task);
          const items = Array.from({ length: count }, (_, i) => `内页图${i + 1}`);
          await this.runStage(task, node.id, () => this.produceNoteImages(task, node.id, [{ channel: 'img-2', items }]), (r) => `生成内页图 ${r as number} 张`);
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        case 'xhs-review': {
          const report = (await this.runStage(task, node.id, () => xhsProducer.produceCompliance(task), (r) => {
            const rep = r as ComplianceReport;
            return `校对结论：${rep.issues.length ? `发现 ${rep.issues.length} 处问题，自动回退` : '无问题，自动放行'}`;
          })) as ComplianceReport;
          delivery.saveDeliverable(t.id, node.id, 'copy', { title: '主管校对报告', points: report.checks.map((c) => `${c.passed ? '通过' : '未通过'}：${c.label}`), outline: report.report, keywords: [] });
          t = report.issues.length
            ? this.ex(task).reviewRollback(t.id, report.issues[0].targetStage, report.issues[0].note)
            : this.ex(task).reviewPass(t.id);
          break;
        }
        case 'xhs-deliver': {
          // 交付完成是确认点：跑完进待确认，由用户「确认归档」（approve）后置 done
          await this.runStage(task, node.id, async () => ({ packName: `小红书交付包 · ${task.title}` }), (r) => `交付准备完成：${(r as { packName: string }).packName}`);
          t = this.ex(task).onStageCompleted(t.id, node.id);
          break;
        }
        default:
          return t;
      }
    }
    return t ?? this.getTask(taskId)!;
  }

  /** XHS 配图产出：按传入分组生成（首图段传 1 张，内页段传 N 张），逐张上报并把交付物挂在对应阶段 */
  private async produceNoteImages(task: Task, stageId: string, groups: { channel: string; items: string[] }[]): Promise<number> {
    const results = await xhsProducer.produceNoteImages(task, groups, (itemId, ok) => {
      this.ex(task).subTaskComplete(task.id, stageId, itemId, ok, ok ? '生成完成' : '生成失败');
    });
    const images: ImageItem[] = results.map((r) => ({
      id: r.itemId,
      name: r.itemId,
      kind: r.itemId.includes('首图') ? 'main' : 'sub',
      url: r.dataUrl ?? '',
      status: r.ok ? 'pending' : 'failed',
      note: r.error,
      error: r.ok ? undefined : r.error,
      attempts: r.attempts ?? (r.ok ? 1 : MAX_IMAGE_ATTEMPTS),
    }));
    // 交付物必须挂在被执行的阶段（首图段挂 xhs-cover、内页段挂 xhs-inner），不能再用 task.stage
    delivery.saveDeliverable(task.id, stageId, 'image', images);
    return results.length;
  }

  /** 图片并行产出：按渠道分组、逐张上报 SUB_TASK_COMPLETE（组 3 真实生图经 producer 注入）；返回产出图片数供执行日志摘要 */
  private async produceImages(
    task: Task,
    stageId: string,
    groups: { channel: string; items: string[] }[],
    producer: ReturnType<typeof getProducer>,
  ): Promise<number> {
    const results = await producer.produceImages(task, groups, (itemId, ok, dataUrl) => {
      this.ex(task).subTaskComplete(task.id, stageId, itemId, ok, ok ? '生成完成' : '生成失败');
    });
    const images: ImageItem[] = results.map((r) => ({
      id: r.itemId,
      name: r.itemId,
      kind: stageId === 'main-image' ? (r.itemId.includes('主图1') ? 'main' : 'sub') : 'detail',
      url: r.dataUrl ?? '',
      // 生图异常（真实渠道失败）标记 failed，与用户打回 rejected 区分；不存 svg 占位图当成品
      status: r.ok ? 'pending' : 'failed',
      note: r.error,
      error: r.ok ? undefined : r.error,
      // B11 · 4.2：累计尝试次数（含自动重试；失败路径记满上限）
      attempts: r.attempts ?? (r.ok ? 1 : MAX_IMAGE_ATTEMPTS),
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
    // 负责人从「任务所属工作流的图节点 ownerRole」解析，不再用电商专属的 stage→agent 硬映射
    // （否则 XHS 阶段会得到 undefined → markBusy(undefined) → 工位栏异常）
    const node = nodeOfStage(task.workflowId, stage);
    const agentId = AGENT_BY_ROLE[node?.ownerRole ?? ''] ?? STAGE_AGENT_FALLBACK[stage];
    if (!agentId) throw new Error(`阶段 ${stage} 未解析到负责 Agent（工作流 ${task.workflowId}）`);
    const row = get<{ model: string }>('SELECT model FROM agents WHERE id = ?', [agentId]);
    const model = effectiveModel(agentId, row?.model ?? '');
    // 顶层 producer 为内置 mock 时，成功也标注 (mock)
    const isMock = getProducer() instanceof MockProducer;

    markBusy(agentId, WORKFLOW_STAGE_LABELS[stage] ?? stage);
    const started = performance.now();
    // B12 token 采集：阶段执行前注册 usage sink，执行后读取（阶段内 LLM 调用均为顺序）
    const collected: LlmUsage[] = [];
    setLlmUsageSink((u) => collected.push(u));
    try {
      const result = await producerCall();
      const durationMs = Math.round(performance.now() - started);
      const hasReal = collected.length > 0;
      // 生图阶段（main-image/detail-image）不产生 token：两列显式写 0，不计入汇总口径
      const isImageStage = stage === 'main-image' || stage === 'detail-image';
      const inputTokens = isImageStage ? 0 : hasReal ? collected.reduce((s, u) => s + u.promptTokens, 0) : undefined;
      const outputTokens = isImageStage ? 0 : hasReal ? collected.reduce((s, u) => s + u.completionTokens, 0) : undefined;
      logExecution({
        agentId,
        taskId: task.id,
        stage,
        model,
        status: 'success',
        inputSummary: task.title,
        outputSummary: isMock ? `${summarize(result)} (mock)` : summarize(result),
        durationMs,
        inputTokens,
        outputTokens,
        tokensEstimated: isImageStage ? false : !hasReal,
      });
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - started);
      const hasReal = collected.length > 0;
      const isImageStage = stage === 'main-image' || stage === 'detail-image';
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
        inputTokens: isImageStage ? 0 : hasReal ? collected.reduce((s, u) => s + u.promptTokens, 0) : undefined,
        outputTokens: isImageStage ? 0 : hasReal ? collected.reduce((s, u) => s + u.completionTokens, 0) : undefined,
        tokensEstimated: isImageStage ? false : !hasReal,
      });
      // 失败可见化：把原因写进卡片副标题，避免任务静默停在「进行中」看起来像还在跑
      // （评审 1.3：没有失败态时用户看到的是"AI 正在干活"的假象）
      try {
        const reason = (err instanceof Error ? err.message : String(err)).slice(0, 80);
        run('UPDATE tasks SET stage_note = ? WHERE id = ?', [`生成失败：${reason}｜可回到看板点「确认开工」重试`, task.id]);
      } catch {
        /* 写提示失败不掩盖原始错误 */
      }
      throw err;
    } finally {
      setLlmUsageSink(null);
      markIdle(agentId);
    }
  }

  // ===== 审批决策联动（内容交付页 → 状态机） =====

  /** 文案/图片决策；图片逐张决策，全部处理完联动状态机（有打回→返工、全采纳→推进） */
  async decideDeliverable(input: DeliverableDecisionInput): Promise<Task> {
    const { taskId, kind, decision, note } = input;
    const task0 = this.getTask(taskId)!;
    const stage = task0?.stage ?? '';

    if (kind === 'copy') {
      delivery.updateDeliverableStatus(taskId, stage, 'copy', undefined, decision === 'approve' ? 'approved' : 'rejected');
      const task = this.getTask(taskId)!;
      if (!this.isApprovalPoint(task) || task.column !== 'awaiting') return task;
      if (decision === 'approve') {
        this.ex(task).approve(taskId);
      } else {
        this.ex(task).reject(taskId, note);
      }
      // 推进或返工重产出
      return this.advance(taskId);
    }

    // image：逐张决策（按当前阶段定位：main-image / detail-image；kind 在此处已窄化为非 copy）
    if (decision === 'skip' && !input.imageId) throw new Error('skip 仅支持逐张图片（需指定 imageId）');
    // 推进警示用「决策前」失败数：本张决策可能把 failed 改为 approved/skipped，统计口径为「该阶段曾失败的图片数」
    const failedBefore = delivery.countFailedImages(taskId, stage);
    const st: 'approved' | 'rejected' | 'skipped' = decision === 'approve' ? 'approved' : decision === 'skip' ? 'skipped' : 'rejected';
    delivery.updateDeliverableStatus(taskId, stage, 'image', input.imageId, st);
    const task = this.getTask(taskId)!;
    if (task.column !== 'awaiting' || !this.isApprovalPoint(task)) return task;
    if (!delivery.allImagesDecided(taskId, task.stage)) return task; // 尚有未决策图片（pending），等待

    if (delivery.anyImageRejected(taskId, task.stage)) {
      // 打回优先：failed 不掩盖 rejected（B11 · 4.7）
      this.ex(task).reject(taskId, note ?? '图片被打回，请返工');
    } else {
      // 推进：failed 不阻塞拍板点（B11 · 4.5/4.6）；推进事件记录失败图片数供界面警示
      const meta =
        failedBefore > 0
          ? {
              failedCount: failedBefore,
              note:
                failedBefore === deliveryImageTotal(taskId, task.stage)
                  ? `全部图片生成失败（${failedBefore} 张），已按可跳过处理推进`
                  : `${failedBefore} 张图片生成失败，已按可跳过处理推进`,
            }
          : undefined;
      this.ex(task).approve(taskId, meta);
    }
    return this.advance(taskId);
  }

  /**
   * 单张图片重试（B11 · 4.8/4.9）：只重新生成目标 failed 图。
   * - 非 failed / 未找到 / 无交付物 → RetryNotAllowedError
   * - 累计尝试已达 MAX_IMAGE_ATTEMPTS → RetryLimitError（不发出第 4 次请求）
   */
  async retryImage(taskId: number, imageId: string): Promise<{ deliverable: Deliverable; image: ImageItem }> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);
    const stage = task.stage;
    const del = delivery.getDeliverable(taskId, stage, 'image');
    if (!del) throw new RetryNotAllowedError('该阶段没有图片交付物');
    let images: ImageItem[];
    try {
      images = JSON.parse(del.content) as ImageItem[];
    } catch {
      throw new RetryNotAllowedError('交付物内容损坏，无法重试');
    }
    const img = images.find((i) => i.id === imageId);
    if (!img) throw new RetryNotAllowedError('未找到该图片');
    if (img.status !== 'failed') throw new RetryNotAllowedError('仅失败的图片可重试');
    const attempts = img.attempts ?? 0;
    if (attempts >= MAX_IMAGE_ATTEMPTS) throw new RetryLimitError(MAX_IMAGE_ATTEMPTS);

    // XHS 配图走 xhs-producer 的重试（与电商生图渠道相互独立）
    if (isXhsWorkflow(task.workflowId)) {
      const r = await xhsProducer.retryImage(task, img.id);
      const newAttempts = attempts + 1;
      if (r.ok) {
        img.status = 'pending';
        img.url = r.dataUrl ?? '';
        img.error = undefined;
        img.note = undefined;
        img.attempts = newAttempts;
      } else {
        img.status = 'failed';
        img.url = '';
        img.error = r.error ?? '生图失败';
        img.attempts = newAttempts;
      }
      const updated = delivery.updateImageItems(taskId, stage, images);
      if (!updated) throw new Error('更新交付物失败');
      return { deliverable: updated, image: img };
    }

    const producer = getProducer();
    if (!producer.retryImage) throw new RetryNotAllowedError('当前执行模式不支持单张重试');
    const r = await producer.retryImage(task, img.id);
    const newAttempts = attempts + 1;
    if (r.ok) {
      img.status = 'pending';
      img.url = r.dataUrl ?? '';
      img.error = undefined;
      img.note = undefined;
      img.attempts = newAttempts;
    } else {
      img.status = 'failed';
      img.url = '';
      img.error = r.error ?? '生图失败';
      img.attempts = newAttempts;
    }
    const updated = delivery.updateImageItems(taskId, stage, images);
    if (!updated) throw new Error('更新交付物失败');
    return { deliverable: updated, image: img };
  }

  /** 主管校对人工决策（pass / rollback） */
  async reviewDecision(taskId: number, decision: 'pass' | 'rollback', targetStage?: string, note?: string): Promise<Task> {
    const task = this.getTask(taskId)!;
    if (decision === 'pass') {
      this.ex(task).reviewPass(taskId, note);
    } else {
      this.ex(task).reviewRollback(taskId, targetStage ?? task.stage, note);
    }
    return this.advance(taskId);
  }

  // ===== 查询透传 =====

  /** 归档（归档≠删除：数据保留，看板不显示，可恢复回原列） */
  archiveTask(taskId: number): Task {
    const t = this.getTask(taskId);
    return this.executorFor(t?.workflowId).archiveTask(taskId);
  }
  /** 恢复归档任务回看板原列 */
  restoreTask(taskId: number): Task {
    const t = this.getTask(taskId);
    return this.executorFor(t?.workflowId).restoreTask(taskId);
  }

  /** 全部任务（跨工作流合并，按 id 倒序；TaskExecutor.listTasks 本身即全表查询） */
  listTasks(): Task[] {
    return this.executorFor(WORKFLOW_ID).listTasks();
  }
  /** 取任务（未知工作流时按默认 executor 查，内部按 id 全表定位） */
  getTask(id: number): Task | undefined {
    return this.executorFor(WORKFLOW_ID).getTask(id);
  }
  listEvents(taskId: number): TaskEvent[] {
    return this.executorFor(WORKFLOW_ID).listEvents(taskId);
  }
  boardCounts(): Record<BoardColumn, number> {
    return this.executorFor(WORKFLOW_ID).boardCounts();
  }
  deliverables(taskId: number) {
    return delivery.listDeliverables(taskId);
  }
  /** 产出溯源结果（无 kind='provenance' 行时返回 null；hasRefs 由结果内给出） */
  provenance(taskId: number): ProvenanceResult | null {
    return getProvenanceResult(taskId);
  }
  /** 返工信息（任务累计返工次数与记录；无返工 count=0、records=[]） */
  rework(taskId: number): ReworkInfo {
    return getReworkInfo(taskId);
  }
  ownerNameOf(agentId: string | null): string {
    return agentId ? AGENT_NAMES[agentId] ?? this.executorFor(WORKFLOW_ID).ownerNameOf(agentId) : '待分配';
  }
  stageLabel(stage: string): string {
    return WORKFLOW_STAGE_LABELS[stage] ?? stage;
  }
  /** 默认（电商）工作流定义，兼容既有调用方 */
  workflow() {
    return this.executorFor(WORKFLOW_ID).workflow();
  }
  /** 库内全部工作流定义（GET /api/workflows） */
  workflows() {
    return loadAllWorkflows();
  }
}

export const service = new WorkflowService();
