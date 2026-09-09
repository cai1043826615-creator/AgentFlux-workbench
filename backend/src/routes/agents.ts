import type { FastifyInstance } from 'fastify';
import type { AgentOnlineStatus, AgentUpdateInput, ExecutionStats, StageStat } from '@workbench/shared';
import { all, get, run } from '../db/client.ts';
import type { AgentExecutionRow, AgentRow } from '../db/schema.ts';
import { toAgent } from '../agents/runtime.ts';
import { listSkills } from '../agents/skills.ts';

/** PUT 请求体：AgentUpdateInput 基础上扩展工位在线状态字段（shared 冻结，本地扩展） */
type AgentUpdateBody = AgentUpdateInput & { onlineStatus?: AgentOnlineStatus; activity?: string };

/** 计算单个 Agent 的执行统计（无记录时 runs=0 / successRate=100 / avgDurationMs=0） */
export function executionStats(agentId: string): ExecutionStats {
  const rows = all<AgentExecutionRow>('SELECT * FROM agent_executions WHERE agent_id = ? ORDER BY id ASC', [agentId]);
  const runs = rows.length;
  const successCount = rows.filter((r) => r.status === 'success').length;
  const successRate = runs === 0 ? 100 : Math.round((successCount / runs) * 100);
  const avgDurationMs = runs === 0 ? 0 : Math.round(rows.reduce((sum, r) => sum + r.duration_ms, 0) / runs);

  // 按阶段分组统计
  const groups = new Map<string, AgentExecutionRow[]>();
  for (const r of rows) {
    const key = r.stage ?? 'unknown';
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const byStage: StageStat[] = [...groups.entries()].map(([stage, list]) => {
    const ok = list.filter((r) => r.status === 'success').length;
    return {
      stage,
      runs: list.length,
      successRate: Math.round((ok / list.length) * 100),
      avgDurationMs: Math.round(list.reduce((sum, r) => sum + r.duration_ms, 0) / list.length),
    };
  });

  return { agentId, runs, successCount, successRate, avgDurationMs, byStage };
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // 工位列表（online_status 转 camelCase）
  app.get('/api/agents', async () => {
    const agents = all<AgentRow>('SELECT * FROM agents ORDER BY id ASC').map(toAgent);
    return { agents };
  });

  // 可挂载技能列表（扫描本地技能目录 backend/skills/*.md）
  app.get('/api/agents/skills', async () => {
    return { skills: await listSkills() };
  });

  // 更新工位（persona/model/skills/files/onlineStatus/activity），id 不存在返回 404
  app.put<{ Params: { id: string }; Body: AgentUpdateBody }>('/api/agents/:id', async (req, reply) => {
    const id = req.params.id;
    const exists = get<{ id: string }>('SELECT id FROM agents WHERE id = ?', [id]);
    if (!exists) return reply.code(404).send({ error: `agent ${id} not found` });

    const body = req.body ?? {};
    if (body.persona !== undefined) run('UPDATE agents SET persona = ? WHERE id = ?', [body.persona, id]);
    if (body.model !== undefined) run('UPDATE agents SET model = ? WHERE id = ?', [body.model, id]);
    if (body.skills !== undefined) run('UPDATE agents SET skills = ? WHERE id = ?', [JSON.stringify(body.skills), id]);
    if (body.files !== undefined) run('UPDATE agents SET files = ? WHERE id = ?', [JSON.stringify(body.files), id]);
    if (body.onlineStatus !== undefined) run('UPDATE agents SET online_status = ? WHERE id = ?', [body.onlineStatus, id]);
    if (body.activity !== undefined) run('UPDATE agents SET activity = ? WHERE id = ?', [body.activity, id]);

    const row = get<AgentRow>('SELECT * FROM agents WHERE id = ?', [id])!;
    return { agent: toAgent(row) };
  });

  // 工位执行统计
  app.get<{ Params: { id: string } }>('/api/agents/:id/stats', async (req, reply) => {
    const id = req.params.id;
    const exists = get<{ id: string }>('SELECT id FROM agents WHERE id = ?', [id]);
    if (!exists) return reply.code(404).send({ error: `agent ${id} not found` });
    return { stats: executionStats(id) };
  });
}
