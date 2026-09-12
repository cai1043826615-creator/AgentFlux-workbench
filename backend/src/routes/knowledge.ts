/**
 * 知识库（板块 B）REST 路由。
 *
 * 板块边界：本文件只读写知识库表与 task_kb_refs（耦合点表），
 * 不触碰板块 A 的状态机与业务表；未连接/异常时全部接口返回可解释状态而非 5xx。
 */
import type { FastifyInstance } from 'fastify';
import type { AttentionConfig, KnowledgeVaultConfigInput, TaskHotRefInput, TaskKbRefInput } from '@workbench/shared';
import { loadAttentionConfig, saveAttentionConfig } from '../knowledge/attention.ts';
import { knowledgeStats, knowledgeStatus, listAllDocs, listDocsByDir, listDocsByTag, listDirs, listTags, readDoc } from '../knowledge/docs.ts';
import { graphData, nodeDetail } from '../knowledge/graph.ts';
import { knowledgeHealth } from '../knowledge/health.ts';
import { loadHotPanel } from '../knowledge/hot.ts';
import { rebuildIndexInBackground } from '../knowledge/indexer.ts';
import { HotRefInvalidError, HotRefLimitError, KbRefInvalidError, KbRefLimitError, listTaskHotRefs, listTaskKbRefs, setTaskHotRefs, setTaskKbRefs } from '../knowledge/refs.ts';
import { searchDocs } from '../knowledge/search.ts';
import { ensureKnowledgeSchema } from '../knowledge/schema.ts';
import { createDraft, deleteDraft, getDraft, listDrafts } from '../knowledge/drafts.ts';
import { runAssistant, type AssistantKind } from '../knowledge/assistant.ts';
import { resolveVaultConfig, saveVaultConfig } from '../knowledge/vault.ts';

export async function knowledgeRoutes(app: FastifyInstance): Promise<void> {
  ensureKnowledgeSchema();

  // ===== Vault 连接与索引 =====

  // 连接状态（未连接时给出原因；板块 A 不受影响）
  app.get('/api/knowledge/status', async () => ({ status: knowledgeStatus() }));

  // 保存 Vault 配置（设置面板）：root 为空 = 断开连接；保存后触发后台重建索引
  app.put<{ Body: KnowledgeVaultConfigInput }>('/api/knowledge/config', async (req) => {
    // P1·6.5：presetEntries（重点目录）必须一并透传，否则前端编辑无法落库
    const { root, includeDirs, excludeDirs, presetDirs, presetEntries } = req.body ?? {};
    saveVaultConfig({ root, includeDirs, excludeDirs, presetDirs, presetEntries });
    const cfg = resolveVaultConfig();
    let started = false;
    if (cfg.root) started = rebuildIndexInBackground();
    return { status: knowledgeStatus(), reindexStarted: started };
  });

  // 手动重建索引（后台异步，立即返回进行中状态）
  app.post('/api/knowledge/reindex', async () => {
    const started = rebuildIndexInBackground();
    return { started, status: knowledgeStatus() };
  });

  // 总览统计
  app.get('/api/knowledge/stats', async () => ({ stats: knowledgeStats() }));

  // 知识健康度（只读：文档使用率 + 孤岛文件；未连接/空索引返回可解释空值而非 5xx）
  app.get('/api/knowledge/health', async () => ({ health: knowledgeHealth() }));

  // ===== 浏览 =====

  app.get('/api/knowledge/dirs', async () => ({ dirs: listDirs() }));
  app.get('/api/knowledge/tags', async () => ({ tags: listTags() }));

  // 浏览文档：?dir= 按目录（默认递归）；?tag= 按标签；都不传返回全部
  app.get<{ Querystring: { dir?: string; tag?: string; recursive?: string } }>('/api/knowledge/docs', async (req) => {
    const { dir, tag, recursive } = req.query ?? {};
    if (tag) return { docs: listDocsByTag(tag) };
    if (dir !== undefined) return { docs: listDocsByDir(dir, recursive !== '0') };
    return { docs: listAllDocs() };
  });

  // 阅读原文（含章节锚点）
  app.get<{ Querystring: { path?: string } }>('/api/knowledge/doc', async (req, reply) => {
    const path = req.query?.path ?? '';
    if (!path) return reply.code(400).send({ error: 'path required' });
    const doc = await readDoc(path);
    if (!doc) return reply.code(404).send({ error: '文档不存在或不在索引范围' });
    return { doc };
  });

  // 全文搜索（中文：≥3 字 FTS5 trigram，1-2 字 LIKE 兜底）
  app.get<{ Querystring: { q?: string; limit?: string } }>('/api/knowledge/search', async (req) => {
    const q = req.query?.q ?? '';
    const limit = Number(req.query?.limit ?? 30);
    return searchDocs(q, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 30);
  });

  // ===== 知识星图 =====

  app.get('/api/knowledge/graph', async () => ({ graph: graphData() }));

  app.get<{ Querystring: { id?: string } }>('/api/knowledge/node', async (req, reply) => {
    const id = req.query?.id ?? '';
    if (!id) return reply.code(400).send({ error: 'id required' });
    const detail = nodeDetail(id);
    if (!detail) return reply.code(404).send({ error: '节点不存在' });
    return { detail };
  });

  // ===== 每日热点 =====

  // ?refresh=1 强制刷新（忽略 15 分钟 TTL）
  app.get<{ Querystring: { refresh?: string } }>('/api/hot', async (req) => {
    const panel = await loadHotPanel(req.query?.refresh === '1');
    return { panel };
  });

  app.get('/api/hot/attention', async () => ({ config: loadAttentionConfig() }));

  app.put<{ Body: AttentionConfig }>('/api/hot/attention', async (req) => {
    const config = saveAttentionConfig(req.body ?? {});
    return { config };
  });

  // ===== 任务关联资料（板块 A/B 唯一耦合点） =====

  // 任务详情读取关联资料（含失效标记）
  app.get<{ Params: { id: string } }>('/api/tasks/:id/kb-refs', async (req) => {
    return { refs: listTaskKbRefs(Number(req.params.id)) };
  });

  // 覆盖写入任务关联资料（新建任务时由 /api/tasks 调用；此处供后续编辑）
  app.put<{ Params: { id: string }; Body: { refs?: TaskKbRefInput[] } }>('/api/tasks/:id/kb-refs', async (req, reply) => {
    const taskId = Number(req.params.id);
    if (!Number.isFinite(taskId)) return reply.code(400).send({ error: 'invalid task id' });
    try {
      const refs = setTaskKbRefs(taskId, req.body?.refs ?? []);
      return { refs };
    } catch (err) {
      if (err instanceof KbRefLimitError || err instanceof KbRefInvalidError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // ===== 任务背景 · 外部环境情报（hot-intel D2，独立表 task_hot_refs） =====

  // 任务详情读取热点背景（持久化快照，不依赖面板当前状态）
  app.get<{ Params: { id: string } }>('/api/tasks/:id/hot-refs', async (req) => {
    return { refs: listTaskHotRefs(Number(req.params.id)) };
  });

  // 覆盖写入任务热点背景（2.8 卡片「挂为任务背景」调用；不产生新任务）
  app.put<{ Params: { id: string }; Body: { refs?: TaskHotRefInput[] } }>('/api/tasks/:id/hot-refs', async (req, reply) => {
    const taskId = Number(req.params.id);
    if (!Number.isFinite(taskId)) return reply.code(400).send({ error: 'invalid task id' });
    try {
      const refs = setTaskHotRefs(taskId, req.body?.refs ?? []);
      return { refs };
    } catch (err) {
      if (err instanceof HotRefLimitError || err instanceof HotRefInvalidError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // ===== 小助理草稿区（P2·F3）：列表 / 详情 / 删除 =====
  // 只读承诺：这里只有工作台自有库的草稿 CRUD，绝不触碰 Vault 文件。

  app.get('/api/kb-drafts', async () => ({ drafts: listDrafts() }));

  app.get<{ Params: { id: string } }>('/api/kb-drafts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid draft id' });
    const draft = getDraft(id);
    if (!draft) return reply.code(404).send({ error: '草稿不存在或已删除' });
    return { draft };
  });

  app.delete<{ Params: { id: string } }>('/api/kb-drafts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: 'invalid draft id' });
    const ok = deleteDraft(id);
    if (!ok) return reply.code(404).send({ error: '草稿不存在或已删除' });
    return { deleted: true };
  });

  // 小助理整理（P2·F3）：doc=文档整理 / hot=热点素材卡 / audit=知识库体检；产出一律进草稿区
  app.post<{ Body: { kind?: string; ref?: string; note?: string; item?: { id?: string; title?: string; summary?: string; sourceName?: string; source?: string; url?: string } } }>(
    '/api/kb-assistant/organize',
    async (req, reply) => {
      const kind = req.body?.kind as AssistantKind | undefined;
      if (kind !== 'doc' && kind !== 'hot' && kind !== 'audit') {
        return reply.code(400).send({ error: 'kind 必须是 doc / hot / audit 之一' });
      }
      const result = await runAssistant({ kind, ref: req.body?.ref, item: req.body?.item, note: req.body?.note });
      if (!result.ok) return reply.code(422).send({ error: result.error });
      return result;
    },
  );
}
