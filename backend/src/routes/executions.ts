import type { FastifyInstance } from 'fastify';
import type { AgentExecution } from '@workbench/shared';
import { all } from '../db/client.ts';
import type { AgentExecutionRow } from '../db/schema.ts';
import { toExecution } from '../agents/execution-logger.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // 执行日志列表（按 id DESC；limit 默认 50，上限 200）
  app.get<{ Querystring: { limit?: string } }>('/api/executions', async (req) => {
    const raw = Number(req.query.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const rows = all<AgentExecutionRow>('SELECT * FROM agent_executions ORDER BY id DESC LIMIT ?', [limit]);
    const executions: AgentExecution[] = rows.map(toExecution);
    return { executions };
  });
}
