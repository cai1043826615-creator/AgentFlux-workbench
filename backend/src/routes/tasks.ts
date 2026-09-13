import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type {
  BoardColumn,
  CopyPackage,
  Deliverable,
  DeliverableDiff,
  DeliverableKind,
  DeliverableSearchHit,
  DeliverableSearchResult,
  DeliverableVersion,
  ImageItem,
  Task,
  TaskBrief,
  TaskKbRefInput,
  TaskListItem,
  TaskListQuery,
} from '@workbench/shared';
import { service, RetryLimitError, RetryNotAllowedError } from '../engine/service.ts';
import { KbRefInvalidError, KbRefLimitError, countKbRefsByTask, setTaskKbRefs, validateTaskKbRefs } from '../knowledge/refs.ts';
import { cleanTaskDescription } from '../knowledge/description-clean.ts';
import { all } from '../db/client.ts';
import type { TaskRow } from '../db/schema.ts';
import { buildTaskCostSummary } from '../agents/cost.ts';
import { diffDeliverableVersions, noPreviousDiff } from '../delivery/diff.ts';
import { buildTaskPackage, hasAnySettledDeliverable } from '../delivery/package.ts';
import { fullVersionHistory } from '../delivery/versions.ts';

/** 上传图片存放目录（gitignore 的 backend/data/ 下） */
const UPLOAD_DIR = join(import.meta.dirname, '..', '..', 'data', 'uploads');

type SqlParam = string | number | null;

/** TaskRow → shared Task（与 executor.toTask 同构） */
function toTaskFromRow(row: TaskRow): Task {
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
    // P1·7.3：读取时清洗正文里历史遗留的溯源机器字段（不改库）
    description: cleanTaskDescription(row.description),
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

/** 任务最近更新时刻：tasks.created_at 与 deliverables.updated_at、task_events.created_at 的较新者（相关子查询） */
const UPDATED_AT_EXPR = `MAX(t.created_at, COALESCE((SELECT MAX(d.updated_at) FROM deliverables d WHERE d.task_id = t.id), t.created_at), COALESCE((SELECT MAX(e.created_at) FROM task_events e WHERE e.task_id = t.id), t.created_at))`;

const SORT_COLUMNS: Record<string, string> = { created: 't.created_at', updated: UPDATED_AT_EXPR, progress: 't.progress' };

/**
 * 任务列表查询层（B5 · 组 6/7）：platform/owner/from/to/q 过滤 + sort/order 排序 + 归档过滤。
 * 无任何参数时返回全量（与改动前一致）；includeArchived=0 时排除归档任务。
 * 返回行附带 updated_at_derived（排序与响应用）。
 */
export function queryTaskRows(query: TaskListQuery = {}): (TaskRow & { updated_at_derived: string })[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (query.includeArchived === false) where.push('t.archived = 0');
  if (query.platform) {
    const vals = (Array.isArray(query.platform) ? query.platform : [query.platform])
      .map((s) => String(s ?? '').trim())
      .filter(Boolean);
    if (vals.length > 0) {
      // platform 存储为逗号拼接集合；用「,value,」子串匹配判定集合成员
      where.push(`(${vals.map(() => `(',' || t.platform || ',') LIKE ?`).join(' OR ')})`);
      for (const v of vals) params.push(`%,${v},%`);
    }
  }
  if (query.owner) {
    where.push('t.owner_agent_id = ?');
    params.push(query.owner);
  }
  if (query.from) {
    where.push('t.created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    // 纯日期（YYYY-MM-DD）→ 闭区间补到当日末尾
    const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? `${query.to}T23:59:59.999` : query.to;
    where.push('t.created_at <= ?');
    params.push(to);
  }
  if (query.q) {
    const like = `%${query.q}%`;
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(like, like);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORT_COLUMNS[query.sort ?? 'created'] ?? SORT_COLUMNS.created;
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  return all<TaskRow & { updated_at_derived: string }>(
    `SELECT t.*, ${UPDATED_AT_EXPR} AS updated_at_derived FROM tasks t ${whereSql} ORDER BY ${sortCol} ${order}, t.id DESC`,
    params,
  );
}

/** 任务最近更新时刻（响应透出字段） */
export function updatedAtOf(row: TaskRow & { updated_at_derived: string }): string {
  return row.updated_at_derived;
}

/** 可返工交付物：copy → 文案阶段（copy），image → 主图阶段（main-image） */
function reworkableDeliverable(taskId: number, kind: DeliverableKind): Deliverable | undefined {
  const stage = kind === 'copy' ? 'copy' : 'main-image';
  return service.deliverables(taskId).find((d) => d.kind === kind && d.stage === stage);
}

function kindValid(kind: string): kind is 'copy' | 'image' {
  return kind === 'copy' || kind === 'image';
}

/** 交付物搜索命中（B5 · 7.6：copy 匹配标题/卖点/关键词；image 匹配图片名） */
function matchDeliverable(
  row: { id: number; task_id: number; stage: string; kind: string; version: number; content: string },
  lq: string,
): Omit<DeliverableSearchHit, 'taskTitle'> | null {
  const hitBase = { taskId: row.task_id, stage: row.stage, kind: row.kind as 'copy' | 'image', version: row.version };
  try {
    if (row.kind === 'copy') {
      const cp = JSON.parse(row.content) as CopyPackage;
      if ((cp.title ?? '').toLowerCase().includes(lq)) return { ...hitBase, field: 'title', snippet: cp.title };
      for (const p of cp.points ?? []) if (p.toLowerCase().includes(lq)) return { ...hitBase, field: 'point', snippet: p };
      for (const k of cp.keywords ?? []) if (k.toLowerCase().includes(lq)) return { ...hitBase, field: 'keyword', snippet: k };
      return null;
    }
    const items = JSON.parse(row.content) as ImageItem[];
    for (const it of items) if ((it.name ?? '').toLowerCase().includes(lq)) return { ...hitBase, field: 'imageName', snippet: it.name };
    return null;
  } catch {
    return null;
  }
}

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // 任务列表（B5 扩展：platform/owner/from/to/q/sort/order/includeArchived；B6 附加 kbRefsTotal/kbRefsInvalid；updatedAt）
  app.get<{ Querystring: Record<string, string | string[] | undefined> }>('/api/tasks', async (req) => {
    const q = req.query;
    const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? (v[0] ?? undefined) : v ?? undefined);
    const platformRaw = Array.isArray(q.platform) ? q.platform.join(',') : q.platform ?? '';
    const query: TaskListQuery = {
      platform: platformRaw !== '' ? platformRaw.split(',').filter(Boolean) : undefined,
      owner: one(q.owner) || undefined,
      from: one(q.from) || undefined,
      to: one(q.to) || undefined,
      q: one(q.q) || undefined,
      sort: (one(q.sort) as TaskListQuery['sort']) || undefined,
      order: (one(q.order) as TaskListQuery['order']) || undefined,
      includeArchived: one(q.includeArchived) === '0' ? false : undefined,
    };
    const rows = queryTaskRows(query);
    const tasks = rows.map(toTaskFromRow);
    const ids = rows.map((r) => r.id);
    // B6 计数：一次查询全部任务的关联资料；板块 B 异常时降级为 0（列表不因知识库问题 5xx）
    let kbCounts = new Map<number, { total: number; invalid: number }>();
    try {
      kbCounts = countKbRefsByTask(ids);
    } catch {
      kbCounts = new Map();
    }
    return {
      tasks: tasks.map((t, i) => ({
        ...t,
        ownerName: service.ownerNameOf(t.ownerAgentId),
        stageLabel: service.stageLabel(t.stage),
        updatedAt: rows[i].updated_at_derived,
        kbRefsTotal: kbCounts.get(t.id)?.total ?? 0,
        kbRefsInvalid: kbCounts.get(t.id)?.invalid ?? 0,
      })) as TaskListItem[],
    };
  });

  // 创建任务（未确认，进入规划中；platforms 多选必填，referenceImage 参考图；
  // kbRefs 为知识库关联资料——板块 A/B 唯一耦合点，先校验再建任务，避免半成品）
  app.post<{
    Body: { title: string; description: string; platforms?: string[]; referenceImage?: string; workflowId?: string; brief?: TaskBrief | null; kbRefs?: TaskKbRefInput[] };
  }>('/api/tasks', async (req, reply) => {
    const { title, description, platforms, referenceImage, workflowId, brief, kbRefs } = req.body ?? {};
    if (!title) return reply.code(400).send({ error: 'title required' });
    if (!Array.isArray(platforms) || platforms.length === 0) return reply.code(400).send({ error: 'platforms required (at least one)' });
    const refs = Array.isArray(kbRefs) ? kbRefs : [];
    if (refs.length > 0) {
      try {
        validateTaskKbRefs(refs);
      } catch (err) {
        if (err instanceof KbRefLimitError || err instanceof KbRefInvalidError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    }
    const task = service.createTask({ title, description: description ?? '', platforms, referenceImage, workflowId, brief: brief ?? null });
    if (refs.length > 0) setTaskKbRefs(task.id, refs);
    return { task };
  });

  // 参考图上传：dataURL → 本地文件 → /uploads/xxx.png
  app.post<{ Body: { dataUrl: string } }>('/api/uploads', async (req, reply) => {
    const { dataUrl } = req.body ?? {};
    if (!dataUrl || typeof dataUrl !== 'string') return reply.code(400).send({ error: 'dataUrl required' });
    const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/.exec(dataUrl);
    if (!m) return reply.code(400).send({ error: 'invalid dataUrl (image/png|jpeg|webp base64)' });
    const [, mediaType, b64] = m;
    const ext = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : 'jpg';
    try {
      if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
      const name = `${randomUUID()}.${ext}`;
      writeFileSync(join(UPLOAD_DIR, name), Buffer.from(b64, 'base64'));
      return { url: `/uploads/${name}` };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'upload failed' });
    }
  });

  // 上传图片静态访问（参考图展示）
  app.get<{ Params: { file: string } }>('/uploads/:file', async (req, reply) => {
    const { file } = req.params;
    if (!/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/i.test(file)) return reply.code(404).send({ error: 'not found' });
    const path = join(UPLOAD_DIR, file);
    if (!existsSync(path)) return reply.code(404).send({ error: 'not found' });
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply.type(type).send(readFileSync(path));
  });

  // 确认开工（确认后 AI 才动工）
  app.post<{ Params: { id: string } }>('/api/tasks/:id/confirm', async (req) => {
    const task = await service.confirmAndRun(Number(req.params.id));
    return { task };
  });

  // 归档（归档≠删除：数据保留，看板不显示，可恢复回原列）
  app.post<{ Params: { id: string } }>('/api/tasks/:id/archive', async (req, reply) => {
    const task = service.archiveTask(Number(req.params.id));
    if (!task) return reply.code(404).send({ error: 'task not found' });
    return { task };
  });

  // 恢复归档任务回看板原列
  app.post<{ Params: { id: string } }>('/api/tasks/:id/restore', async (req, reply) => {
    const task = service.restoreTask(Number(req.params.id));
    if (!task) return reply.code(404).send({ error: 'task not found' });
    return { task };
  });

  // 任务事件（活动日志）
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (req) => {
    return { events: service.listEvents(Number(req.params.id)) };
  });

  // 任务交付物
  app.get<{ Params: { id: string } }>('/api/tasks/:id/deliverables', async (req) => {
    return { deliverables: service.deliverables(Number(req.params.id)) };
  });

  // 产出溯源结果（B1 · 2.5：无 kind='provenance' 行时返回 provenance: null；hasRefs 由结果内给出）
  app.get<{ Params: { id: string } }>('/api/tasks/:id/provenance', async (req) => {
    return { provenance: service.provenance(Number(req.params.id)) };
  });

  // 返工信息（B2 · 3.6：任务累计返工次数与记录；无返工 count=0、records=[]）
  app.get<{ Params: { id: string } }>('/api/tasks/:id/rework', async (req) => {
    return { rework: service.rework(Number(req.params.id)) };
  });

  // 交付物决策（文案整体 / 图片逐张；decision 支持 approve/reject/skip——skip 仅逐张图片，计为已决策且不触发返工）
  app.post<{
    Params: { id: string };
    Body: { kind: 'copy' | 'image'; imageId?: string; decision: 'approve' | 'reject' | 'skip'; note?: string };
  }>('/api/tasks/:id/deliverables/decide', async (req, reply) => {
    const { kind, imageId, decision, note } = req.body ?? {};
    if (!kind || !decision) return reply.code(400).send({ error: 'kind and decision required' });
    if (decision === 'skip' && (!imageId || kind !== 'image')) return reply.code(400).send({ error: 'skip 仅支持逐张图片（需指定 imageId）' });
    const task = await service.decideDeliverable({ taskId: Number(req.params.id), kind, imageId, decision, note });
    return { task, deliverables: service.deliverables(Number(req.params.id)) };
  });

  // 单张图片重试（B11 · 4.8/4.9：只重新生成该图；非失败图/超上限返回可见错误）
  app.post<{ Params: { id: string; imageId: string } }>('/api/tasks/:id/deliverables/images/:imageId/retry', async (req, reply) => {
    try {
      const { deliverable, image } = await service.retryImage(Number(req.params.id), req.params.imageId);
      return { deliverable, image, deliverables: service.deliverables(Number(req.params.id)) };
    } catch (err) {
      if (err instanceof RetryLimitError || err instanceof RetryNotAllowedError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // 主管校对决策（pass / rollback）
  app.post<{
    Params: { id: string };
    Body: { decision: 'pass' | 'rollback'; targetStage?: string; note?: string };
  }>('/api/tasks/:id/review', async (req, reply) => {
    const { decision, targetStage, note } = req.body ?? {};
    if (!decision) return reply.code(400).send({ error: 'decision required' });
    const task = await service.reviewDecision(Number(req.params.id), decision, targetStage, note);
    return { task };
  });

  // ===== B3 交付物版本历史与差异 =====

  // 版本历史（含当前版本；首次产出后恰 v1 一条）
  app.get<{ Params: { id: string; kind: string } }>('/api/tasks/:id/deliverables/:kind/versions', async (req, reply) => {
    const taskId = Number(req.params.id);
    const { kind } = req.params;
    if (!kindValid(kind)) return reply.code(400).send({ error: 'kind 必须是 copy 或 image' });
    const task = service.getTask(taskId);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const del = reworkableDeliverable(taskId, kind);
    if (!del) return { versions: [] as DeliverableVersion[] };
    return { versions: fullVersionHistory(del) };
  });

  // 相邻版本差异（默认当前 vs 上一版；支持 from/to 版本参数）
  app.get<{ Params: { id: string; kind: string }; Querystring: { from?: string; to?: string } }>(
    '/api/tasks/:id/deliverables/:kind/diff',
    async (req, reply) => {
      const taskId = Number(req.params.id);
      const { kind } = req.params;
      if (!kindValid(kind)) return reply.code(400).send({ error: 'kind 必须是 copy 或 image' });
      const task = service.getTask(taskId);
      if (!task) return reply.code(404).send({ error: 'task not found' });
      const del = reworkableDeliverable(taskId, kind);
      if (!del) return reply.code(404).send({ error: '交付物不存在' });

      const versions = fullVersionHistory(del);
      const toVer = req.query.to != null ? Number(req.query.to) : del.version;
      if (!Number.isFinite(toVer)) return reply.code(400).send({ error: 'to 版本参数非法' });
      const toRecord = versions.find((v) => v.version === toVer);
      if (!toRecord) return reply.code(404).send({ error: `版本 v${toVer} 不存在（当前最高 v${del.version}）` });

      let fromVer = req.query.from != null ? Number(req.query.from) : undefined;
      if (fromVer != null && !Number.isFinite(fromVer)) return reply.code(400).send({ error: 'from 版本参数非法' });
      if (fromVer == null) {
        // 默认取 to 之前的最大版本
        fromVer = versions.filter((v) => v.version < toVer).at(-1)?.version;
      }
      if (fromVer == null) return { diff: noPreviousDiff(toVer) };
      const fromRecord = versions.find((v) => v.version === fromVer);
      if (!fromRecord) return reply.code(404).send({ error: `版本 v${fromVer} 不存在` });

      const diff: DeliverableDiff = diffDeliverableVersions(fromRecord, toRecord);
      return { diff };
    },
  );

  // ===== B4 交付包下载 =====

  app.get<{ Params: { id: string } }>('/api/tasks/:id/deliverable-package', async (req, reply) => {
    const taskId = Number(req.params.id);
    const task = service.getTask(taskId);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const deliverables = service.deliverables(taskId);
    if (!hasAnySettledDeliverable(deliverables)) {
      return reply.code(409).send({ error: '该任务尚无任何已定案交付物，无法生成交付包' });
    }
    const { zip, missingCount } = await buildTaskPackage(task, deliverables);
    const safeTitle = task.title.replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 40);
    const filename = `交付包-任务${task.id}-${safeTitle}.zip`;
    return reply
      .code(200)
      .type('application/zip')
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .header('X-Deliverable-Missing', String(missingCount))
      .send(zip);
  });

  // ===== B5 交付物全局搜索 =====

  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/deliverables/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    const rawLimit = Number(req.query.limit ?? 30);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 100) : 30;
    if (!q) return { query: '', hits: [] as DeliverableSearchHit[], truncated: false, hint: '请输入关键字' } satisfies DeliverableSearchResult;

    const lq = q.toLowerCase();
    const rows = all<{ id: number; task_id: number; stage: string; kind: string; version: number; content: string }>('SELECT id, task_id, stage, kind, version, content FROM deliverables');
    const hits: Omit<DeliverableSearchHit, 'taskTitle'>[] = [];
    const taskIds = new Set<number>();
    for (const r of rows) {
      const hit = matchDeliverable(r, lq);
      if (hit) {
        hits.push(hit);
        taskIds.add(hit.taskId);
      }
    }
    const titles = new Map<number, string>();
    if (taskIds.size > 0) {
      const trows = all<{ id: number; title: string }>(`SELECT id, title FROM tasks WHERE id IN (${[...taskIds].map(() => '?').join(',')})`, [...taskIds]);
      for (const t of trows) titles.set(t.id, t.title);
    }
    const out: DeliverableSearchHit[] = hits.map((h) => ({ ...h, taskTitle: titles.get(h.taskId) ?? `任务#${h.taskId}` }));
    const truncated = out.length > limit;
    return {
      query: q,
      hits: out.slice(0, limit),
      truncated,
      hint: out.length === 0 ? '无命中交付物' : undefined,
    } satisfies DeliverableSearchResult;
  });

  // ===== B12 任务级执行汇总与费用估算 =====

  app.get<{ Params: { id: string } }>('/api/tasks/:id/cost', async (req, reply) => {
    const taskId = Number(req.params.id);
    const task = service.getTask(taskId);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    return { summary: buildTaskCostSummary(taskId) };
  });
}
