import type {
  Agent,
  AgentExecution,
  AgentUpdateInput,
  AttentionConfig,
  ChannelTestResult,
  CopyPackage,
  Deliverable,
  DeliverableDiff,
  DeliverableSearchResult,
  DeliverableVersion,
  ExecutionStats,
  HotPanel,
  KnowledgeDirInfo,
  KnowledgeDoc,
  KnowledgeDocSummary,
  KnowledgeGraphData,
  KnowledgeHealth,
  KnowledgeNodeDetail,
  KnowledgeSearchResult,
  KnowledgeStats,
  KnowledgeStatus,
  KnowledgeTagInfo,
  KnowledgeVaultConfigInput,
  Message,
  ProvenanceResult,
  ReworkInfo,
  Task,
  TaskCostSummary,
  TaskCreateInput,
  TaskEvent,
  TaskHotRef,
  TaskHotRefInput,
  TaskKbRef,
  TaskKbRefInput,
  TaskListQuery,
  TaskListItem,
  WorkflowDefinition,
} from '@workbench/shared';

async function j<T>(p: Promise<Response>): Promise<T> {
  const res = await p;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export const api = {
  // ===== 任务 =====
  /** 任务列表（B5 扩展 query：platform/owner/from/to/q/sort/order；B6 附带 kbRefsTotal/kbRefsInvalid） */
  listTasks: (query?: TaskListQuery) => {
    const qs = new URLSearchParams();
    if (query?.platform) {
      const vals = Array.isArray(query.platform) ? query.platform : [query.platform];
      for (const v of vals) if (v) qs.append('platform', v);
    }
    if (query?.owner) qs.set('owner', query.owner);
    if (query?.from) qs.set('from', query.from);
    if (query?.to) qs.set('to', query.to);
    if (query?.q) qs.set('q', query.q);
    if (query?.sort) qs.set('sort', query.sort);
    if (query?.order) qs.set('order', query.order);
    if (query?.includeArchived) qs.set('includeArchived', '1');
    const s = qs.toString();
    return j<{ tasks: TaskListItem[] }>(fetch(`/api/tasks${s ? `?${s}` : ''}`));
  },
  createTask: (input: TaskCreateInput) => j<{ task: Task }>(fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
  confirmTask: (id: number) => j<{ task: Task }>(fetch(`/api/tasks/${id}/confirm`, { method: 'POST' })),
  /** 归档任务（归档≠删除：数据保留，看板不显示，可恢复回原列） */
  archiveTask: (id: number) => j<{ task: Task }>(fetch(`/api/tasks/${id}/archive`, { method: 'POST' })),
  /** 恢复归档任务回看板原列 */
  restoreTask: (id: number) => j<{ task: Task }>(fetch(`/api/tasks/${id}/restore`, { method: 'POST' })),
  taskEvents: (id: number) => j<{ events: TaskEvent[] }>(fetch(`/api/tasks/${id}/events`)),
  taskDeliverables: (id: number) => j<{ deliverables: Deliverable[] }>(fetch(`/api/tasks/${id}/deliverables`)),
  decideDeliverable: (taskId: number, kind: 'copy' | 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, note?: string) =>
    j<{ task: Task; deliverables: Deliverable[] }>(
      fetch(`/api/tasks/${taskId}/deliverables/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, decision, imageId, note }),
      }),
    ),
  reviewDecision: (taskId: number, decision: 'pass' | 'rollback', targetStage?: string, note?: string) =>
    j<{ task: Task }>(
      fetch(`/api/tasks/${taskId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, targetStage, note }) }),
    ),
  /** 单张图片重试（B11）：只重新生成目标 failed 图；非失败图/已达上限返回可见错误 */
  retryImage: (taskId: number, imageId: string) =>
    j<{ deliverable: Deliverable; image: { id: string; status: string; url: string; error?: string; attempts?: number }; deliverables: Deliverable[] }>(
      fetch(`/api/tasks/${taskId}/deliverables/images/${encodeURIComponent(imageId)}/retry`, { method: 'POST' }),
    ),
  /** 参考图上传：POST /api/uploads（JSON { dataUrl }）→ { url }；后端未实现（404）时由调用方回退为直接存 dataURL */
  uploadImage: (dataUrl: string) => j<{ url: string }>(fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) })),

  // ===== 工位 =====
  /** 返回含 channelConfigured（后端 isAgentConfigured 权威判定：面板 key 或 .env 默认渠道回退） */
  listAgents: () => j<{ agents: (Agent & { channelConfigured: boolean })[] }>(fetch('/api/agents')),
  updateAgent: (id: string, input: AgentUpdateInput) => j<{ agent: Agent }>(fetch(`/api/agents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
  agentStats: (id: string) => j<{ stats: ExecutionStats }>(fetch(`/api/agents/${id}/stats`)),
  executions: (limit = 50) => j<{ executions: AgentExecution[] }>(fetch(`/api/executions?limit=${limit}`)),
  /** Agent 文件目录：GET /api/agents/files；后端未实现（404）时由调用方降级提示 */
  listFiles: () => j<{ files: { id: string; name: string }[] }>(fetch('/api/agents/files')),
  /** 上传 Agent 文件：POST /api/agents/files（JSON { name, content }）；后端未实现时由调用方降级提示 */
  uploadFile: (input: { name: string; content: string }) => j<{ file: { id: string; name: string } }>(
    fetch('/api/agents/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
  ),

  // ===== 工作流 / 设置 =====
  listWorkflows: () => j<{ workflows: WorkflowDefinition[] }>(fetch('/api/workflows')),
  getSettings: () => j<Record<string, unknown>>(fetch('/api/settings')),
  putSettings: (body: Record<string, unknown>) => j<Record<string, unknown>>(fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),

  // ===== 聊天 =====
  chatHistory: (chatKind: 'group' | 'private', to: string) => j<{ messages: Message[] }>(fetch(`/api/chat/history?kind=${chatKind}&to=${encodeURIComponent(to)}`)),

  // ===== 知识库 =====
  kbStatus: () => j<{ status: KnowledgeStatus }>(fetch('/api/knowledge/status')),
  /** 保存 Vault 配置（root 为空 = 断开连接；可携带业务预设依据目录）；保存后后端触发后台重建索引 */
  kbSaveConfig: (input: KnowledgeVaultConfigInput) =>
    j<{ status: KnowledgeStatus; reindexStarted: boolean }>(
      fetch('/api/knowledge/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }),
    ),
  kbReindex: () => j<{ started: boolean; status: KnowledgeStatus }>(fetch('/api/knowledge/reindex', { method: 'POST' })),
  kbStats: () => j<{ stats: KnowledgeStats }>(fetch('/api/knowledge/stats')),
  kbDirs: () => j<{ dirs: KnowledgeDirInfo[] }>(fetch('/api/knowledge/dirs')),
  kbTags: () => j<{ tags: KnowledgeTagInfo[] }>(fetch('/api/knowledge/tags')),
  /** 浏览文档：dir 传 null 表示全部；tag 优先于 dir */
  kbDocs: (opts: { dir?: string | null; tag?: string | null } = {}) => {
    const qs = opts.tag ? `?tag=${encodeURIComponent(opts.tag)}` : opts.dir != null ? `?dir=${encodeURIComponent(opts.dir)}` : '';
    return j<{ docs: KnowledgeDocSummary[] }>(fetch(`/api/knowledge/docs${qs}`));
  },
  kbDoc: (path: string) => j<{ doc: KnowledgeDoc }>(fetch(`/api/knowledge/doc?path=${encodeURIComponent(path)}`)),
  kbSearch: (q: string, limit = 30) => j<KnowledgeSearchResult>(fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`)),
  kbGraph: () => j<{ graph: KnowledgeGraphData }>(fetch('/api/knowledge/graph')),
  kbNode: (id: string) => j<{ detail: KnowledgeNodeDetail }>(fetch(`/api/knowledge/node?id=${encodeURIComponent(id)}`)),
  /** 知识健康度（文档使用率 + 孤岛文件；只读） */
  kbHealth: () => j<{ health: KnowledgeHealth }>(fetch('/api/knowledge/health')),

  // ===== 收件箱（助理收件箱产出；原「草稿区」，P2-5 改名）=====
  kbDrafts: () => j<{ drafts: unknown[] }>(fetch('/api/kb-drafts')),
  kbDraftDelete: (id: number) => j<{ deleted: boolean }>(fetch(`/api/kb-drafts/${id}`, { method: 'DELETE' })),

  // ===== 每日热点 =====
  hotPanel: (refresh = false) => j<{ panel: HotPanel }>(fetch(`/api/hot${refresh ? '?refresh=1' : ''}`)),
  hotAttention: () => j<{ config: AttentionConfig }>(fetch('/api/hot/attention')),
  hotSaveAttention: (config: AttentionConfig) =>
    j<{ config: AttentionConfig }>(fetch('/api/hot/attention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })),

  // ===== 任务关联资料（板块 A/B 唯一耦合点） =====
  taskKbRefs: (taskId: number) => j<{ refs: TaskKbRef[] }>(fetch(`/api/tasks/${taskId}/kb-refs`)),
  putTaskKbRefs: (taskId: number, refs: TaskKbRefInput[]) =>
    j<{ refs: TaskKbRef[] }>(fetch(`/api/tasks/${taskId}/kb-refs`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs }) })),

  // ===== 任务背景 · 外部环境情报（hot-intel D2） =====
  taskHotRefs: (taskId: number) => j<{ refs: TaskHotRef[] }>(fetch(`/api/tasks/${taskId}/hot-refs`)),
  saveTaskHotRefs: (taskId: number, refs: TaskHotRefInput[]) =>
    j<{ refs: TaskHotRef[] }>(fetch(`/api/tasks/${taskId}/hot-refs`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs }) })),

  // ===== 产出溯源（B1） / 返工上下文（B2） =====
  taskProvenance: (taskId: number) => j<{ provenance: ProvenanceResult | null }>(fetch(`/api/tasks/${taskId}/provenance`)),
  taskRework: (taskId: number) => j<{ rework: ReworkInfo }>(fetch(`/api/tasks/${taskId}/rework`)),

  // ===== 交付物版本历史与差异（B3） =====
  deliverableVersions: (taskId: number, kind: 'copy' | 'image') =>
    j<{ versions: DeliverableVersion[] }>(fetch(`/api/tasks/${taskId}/deliverables/${kind}/versions`)),
  deliverableDiff: (taskId: number, kind: 'copy' | 'image', opts?: { from?: number; to?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.from != null) qs.set('from', String(opts.from));
    if (opts?.to != null) qs.set('to', String(opts.to));
    const s = qs.toString();
    return j<{ diff: DeliverableDiff }>(fetch(`/api/tasks/${taskId}/deliverables/${kind}/diff${s ? `?${s}` : ''}`));
  },

  // ===== 交付包下载（B4） =====
  /** 下载交付包 zip：返回文件名与 Blob；非 2xx 时抛错（含 409 中文说明） */
  deliverablePackage: async (taskId: number): Promise<{ filename: string; blob: Blob }> => {
    const res = await fetch(`/api/tasks/${taskId}/deliverable-package`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="?([^";]+)"?/i.exec(disposition);
    const filename = m ? decodeURIComponent(m[1]) : `交付包-任务${taskId}.zip`;
    return { filename, blob: await res.blob() };
  },

  // ===== 交付物全局搜索（B5） =====
  searchDeliverables: (q: string, limit = 30) =>
    j<DeliverableSearchResult>(fetch(`/api/deliverables/search?q=${encodeURIComponent(q)}&limit=${limit}`)),

  // ===== 任务级成本/耗时（B12） =====
  taskCost: (taskId: number) => j<{ summary: TaskCostSummary }>(fetch(`/api/tasks/${taskId}/cost`)),

  // ===== 渠道健康检查（B8） =====
  channelTest: (agentId: string, override?: { baseUrl?: string; apiKey?: string; model?: string }) =>
    j<{ result: ChannelTestResult }>(fetch(`/api/agents/${agentId}/channel-test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(override ?? {}) })).then((r) => r.result),
};

export function parseCopy(deliverable: Deliverable | undefined): CopyPackage | null {
  if (!deliverable) return null;
  try {
    return JSON.parse(deliverable.content) as CopyPackage;
  } catch {
    return null;
  }
}

export function parseImages(deliverable: Deliverable | undefined): { id: string; name: string; kind: string; url: string; status: string; note?: string; error?: string; attempts?: number }[] | null {
  if (!deliverable) return null;
  try {
    return JSON.parse(deliverable.content) as { id: string; name: string; kind: string; url: string; status: string; note?: string; error?: string; attempts?: number }[];
  } catch {
    return null;
  }
}
