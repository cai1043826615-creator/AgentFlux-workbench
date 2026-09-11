import type {
  Agent,
  AgentExecution,
  AgentUpdateInput,
  AttentionConfig,
  CopyPackage,
  Deliverable,
  ExecutionStats,
  HotPanel,
  KnowledgeDirInfo,
  KnowledgeDoc,
  KnowledgeDocSummary,
  KnowledgeGraphData,
  KnowledgeNodeDetail,
  KnowledgeSearchResult,
  KnowledgeStats,
  KnowledgeStatus,
  KnowledgeTagInfo,
  Message,
  Task,
  TaskCreateInput,
  TaskEvent,
  TaskKbRef,
  TaskKbRefInput,
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
  listTasks: () => j<{ tasks: (Task & { ownerName: string; stageLabel: string })[] }>(fetch('/api/tasks')),
  createTask: (input: TaskCreateInput) => j<{ task: Task }>(fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
  confirmTask: (id: number) => j<{ task: Task }>(fetch(`/api/tasks/${id}/confirm`, { method: 'POST' })),
  /** 归档任务（归档≠删除：数据保留，看板不显示，可恢复回原列） */
  archiveTask: (id: number) => j<{ task: Task }>(fetch(`/api/tasks/${id}/archive`, { method: 'POST' })),
  /** 恢复归档任务回看板原列 */
  restoreTask: (id: number) => j<{ task: Task }>(fetch(`/api/tasks/${id}/restore`, { method: 'POST' })),
  taskEvents: (id: number) => j<{ events: TaskEvent[] }>(fetch(`/api/tasks/${id}/events`)),
  taskDeliverables: (id: number) => j<{ deliverables: Deliverable[] }>(fetch(`/api/tasks/${id}/deliverables`)),
  decideDeliverable: (taskId: number, kind: 'copy' | 'image', decision: 'approve' | 'reject', imageId?: string, note?: string) =>
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

  // ===== 知识库（板块 B） =====
  kbStatus: () => j<{ status: KnowledgeStatus }>(fetch('/api/knowledge/status')),
  /** 保存 Vault 配置（root 为空 = 断开连接）；保存后后端触发后台重建索引 */
  kbSaveConfig: (input: { root?: string; includeDirs?: string[]; excludeDirs?: string[] }) =>
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

  // ===== 每日热点 =====
  hotPanel: (refresh = false) => j<{ panel: HotPanel }>(fetch(`/api/hot${refresh ? '?refresh=1' : ''}`)),
  hotAttention: () => j<{ config: AttentionConfig }>(fetch('/api/hot/attention')),
  hotSaveAttention: (config: AttentionConfig) =>
    j<{ config: AttentionConfig }>(fetch('/api/hot/attention', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })),

  // ===== 任务关联资料（板块 A/B 唯一耦合点） =====
  taskKbRefs: (taskId: number) => j<{ refs: TaskKbRef[] }>(fetch(`/api/tasks/${taskId}/kb-refs`)),
  putTaskKbRefs: (taskId: number, refs: TaskKbRefInput[]) =>
    j<{ refs: TaskKbRef[] }>(fetch(`/api/tasks/${taskId}/kb-refs`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refs }) })),
};

export function parseCopy(deliverable: Deliverable | undefined): CopyPackage | null {
  if (!deliverable) return null;
  try {
    return JSON.parse(deliverable.content) as CopyPackage;
  } catch {
    return null;
  }
}

export function parseImages(deliverable: Deliverable | undefined): { id: string; name: string; kind: string; url: string; status: string; note?: string }[] | null {
  if (!deliverable) return null;
  try {
    return JSON.parse(deliverable.content) as { id: string; name: string; kind: string; url: string; status: string; note?: string }[];
  } catch {
    return null;
  }
}
