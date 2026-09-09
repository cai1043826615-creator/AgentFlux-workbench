import type { FastifyInstance } from 'fastify';
import { service } from '../engine/service.ts';

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // 任务列表
  app.get('/api/tasks', async () => {
    const tasks = service.listTasks().map((t) => ({ ...t, ownerName: service.ownerNameOf(t.ownerAgentId), stageLabel: service.stageLabel(t.stage) }));
    return { tasks };
  });

  // 创建任务（未确认，进入规划中）
  app.post<{ Body: { title: string; description: string; platform: string } }>('/api/tasks', async (req, reply) => {
    const { title, description, platform } = req.body ?? {};
    if (!title) return reply.code(400).send({ error: 'title required' });
    const task = service.createTask({ title, description: description ?? '', platform: platform ?? '' });
    return { task };
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
