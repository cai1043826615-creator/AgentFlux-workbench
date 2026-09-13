import type { FastifyInstance } from 'fastify';
import { service } from '../engine/service.ts';

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/workflows', async () => {
    return { workflows: service.workflows() };
  });
}
