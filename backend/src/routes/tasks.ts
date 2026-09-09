import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { service } from '../engine/service.ts';

/** 上传图片存放目录（gitignore 的 backend/data/ 下） */
const UPLOAD_DIR = join(import.meta.dirname, '..', '..', 'data', 'uploads');

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // 任务列表
  app.get('/api/tasks', async () => {
    const tasks = service.listTasks().map((t) => ({ ...t, ownerName: service.ownerNameOf(t.ownerAgentId), stageLabel: service.stageLabel(t.stage) }));
    return { tasks };
  });

  // 创建任务（未确认，进入规划中；platforms 多选必填，referenceImage 参考图）
  app.post<{ Body: { title: string; description: string; platforms?: string[]; referenceImage?: string; workflowId?: string } }>('/api/tasks', async (req, reply) => {
    const { title, description, platforms, referenceImage, workflowId } = req.body ?? {};
    if (!title) return reply.code(400).send({ error: 'title required' });
    if (!Array.isArray(platforms) || platforms.length === 0) return reply.code(400).send({ error: 'platforms required (at least one)' });
    const task = service.createTask({ title, description: description ?? '', platforms, referenceImage, workflowId });
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

  // 任务事件（活动日志）
  app.get<{ Params: { id: string } }>('/api/tasks/:id/events', async (req) => {
    return { events: service.listEvents(Number(req.params.id)) };
  });

  // 任务交付物
  app.get<{ Params: { id: string } }>('/api/tasks/:id/deliverables', async (req) => {
    return { deliverables: service.deliverables(Number(req.params.id)) };
  });

  // 交付物决策（文案整体 / 图片逐张）
  app.post<{
    Params: { id: string };
    Body: { kind: 'copy' | 'image'; imageId?: string; decision: 'approve' | 'reject'; note?: string };
  }>('/api/tasks/:id/deliverables/decide', async (req, reply) => {
    const { kind, imageId, decision, note } = req.body ?? {};
    if (!kind || !decision) return reply.code(400).send({ error: 'kind and decision required' });
    const task = await service.decideDeliverable({ taskId: Number(req.params.id), kind, imageId, decision, note });
    return { task, deliverables: service.deliverables(Number(req.params.id)) };
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
}
