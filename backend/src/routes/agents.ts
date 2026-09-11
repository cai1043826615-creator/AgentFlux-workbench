import type { FastifyInstance } from 'fastify';
import type { AgentOnlineStatus, AgentUpdateInput, ChannelTestResult, ExecutionStats, StageStat } from '@workbench/shared';
import { all, get, run } from '../db/client.ts';
import type { AgentExecutionRow, AgentRow } from '../db/schema.ts';
import { toAgent, isAgentConfigured, effectiveModel } from '../agents/runtime.ts';
import { listFiles, listSkills, saveFileContent } from '../agents/skills.ts';
import { testAgentChannel } from '../agents/channel-test.ts';

/** PUT 请求体：AgentUpdateInput 基础上扩展工位在线状态字段（shared 冻结，本地扩展） */
type AgentUpdateBody = AgentUpdateInput & { onlineStatus?: AgentOnlineStatus; activity?: string };

/** POST /api/agents/files 请求体：content 直接文本；或 dataUrl（data:[mediatype][;base64],<data>，上传接口兼容） */
type FileUploadBody = { name?: string; content?: string; dataUrl?: string };

/** 解析 data URL 为文本内容与推导扩展名；仅接受 text/* 或 application/json 文本型，无法解析返回 null */
function parseDataUrl(dataUrl: string): { content: string; ext: string } | null {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const mediaType = m[1].toLowerCase();
  if (mediaType && !mediaType.startsWith('text/') && mediaType !== 'application/json') return null;
  const isBase64 = Boolean(m[2]);
  const data = m[3];
  let content: string;
  try {
    content = isBase64 ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
  } catch {
    return null;
  }
  const ext = mediaType.includes('json') ? '.json' : mediaType.includes('markdown') || mediaType.includes('md') ? '.md' : '.txt';
  return { content, ext };
}

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
  // 工位列表（online_status 转 camelCase；channelConfigured 为渠道可用性权威判定：面板 key 或 .env 默认渠道回退；model 为运行时实际模型）
  app.get('/api/agents', async () => {
    const agents = all<AgentRow>('SELECT * FROM agents ORDER BY id ASC').map((row) => {
      const a = toAgent(row);
      return { ...a, model: effectiveModel(a.id, a.model), channelConfigured: isAgentConfigured(a.id) };
    });
    return { agents };
  });

  // 可挂载技能列表（扫描本地技能目录 backend/skills/*.md）
  app.get('/api/agents/skills', async () => {
    return { skills: await listSkills() };
  });

  // 可挂载文件列表（扫描 backend/files/*.{md,txt,json}，供前端目录选择）
  app.get('/api/agents/files', async () => {
    return { files: await listFiles() };
  });

  // 上传挂载文件：body { name, content } 或 { name, dataUrl }（dataUrl 无 name 时按媒体类型生成默认名）
  app.post<{ Body: FileUploadBody }>('/api/agents/files', async (req, reply) => {
    const body = req.body ?? {};
    let name = (body.name ?? '').trim();
    let content = body.content;
    if (content === undefined && body.dataUrl) {
      const parsed = parseDataUrl(body.dataUrl);
      if (!parsed) return reply.code(400).send({ error: 'dataUrl 解析失败或媒体类型不受支持' });
      content = parsed.content;
      if (!name) name = `上传文件_${Date.now()}${parsed.ext}`;
    }
    if (typeof content !== 'string') return reply.code(400).send({ error: '缺少 content 或 dataUrl' });
    try {
      const id = await saveFileContent(name, content);
      return { file: { id, name: id.replace(/\.(md|txt|json)$/i, '') } };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : '写入文件失败' });
    }
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
    const a = toAgent(row);
    return { agent: { ...a, model: effectiveModel(a.id, a.model), channelConfigured: isAgentConfigured(a.id) } };
  });

  // 工位执行统计
  app.get<{ Params: { id: string } }>('/api/agents/:id/stats', async (req, reply) => {
    const id = req.params.id;
    const exists = get<{ id: string }>('SELECT id FROM agents WHERE id = ?', [id]);
    if (!exists) return reply.code(404).send({ error: `agent ${id} not found` });
    return { stats: executionStats(id) };
  });

  // 渠道健康检查（B8）：不写库、不改状态；未配置 → ok:false + not_configured
  app.post<{ Params: { id: string }; Body: { baseUrl?: string; apiKey?: string; model?: string } }>(
    '/api/agents/:id/channel-test',
    async (req, reply) => {
      const id = req.params.id;
      const exists = get<{ id: string }>('SELECT id FROM agents WHERE id = ?', [id]);
      if (!exists) return reply.code(404).send({ error: `agent ${id} not found` });

      const body = req.body ?? {};
      const override: { baseUrl?: string; apiKey?: string; model?: string } = {};
      if (body.baseUrl !== undefined) {
        if (typeof body.baseUrl !== 'string') return reply.code(400).send({ error: 'baseUrl 必须是字符串' });
        override.baseUrl = body.baseUrl;
      }
      if (body.apiKey !== undefined) {
        if (typeof body.apiKey !== 'string') return reply.code(400).send({ error: 'apiKey 必须是字符串' });
        override.apiKey = body.apiKey;
      }
      if (body.model !== undefined) {
        if (typeof body.model !== 'string') return reply.code(400).send({ error: 'model 必须是字符串' });
        override.model = body.model;
      }

      const result: ChannelTestResult = await testAgentChannel(id, Object.keys(override).length > 0 ? override : undefined);
      return { result };
    },
  );
}
