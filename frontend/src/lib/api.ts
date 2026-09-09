import type { Agent, AgentExecution, AgentUpdateInput, CopyPackage, Deliverable, ExecutionStats, Message, Task, TaskCreateInput, TaskEvent, WorkflowDefinition } from '@workbench/shared';

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
  listAgents: () => j<{ agents: Agent[] }>(fetch('/api/agents')),
  updateAgent: (id: string, input: AgentUpdateInput) => j<{ agent: Agent }>(fetch(`/api/agents/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })),
  agentStats: (id: string) => j<{ stats: ExecutionStats }>(fetch(`/api/agents/${id}/stats`)),
  executions: (limit = 50) => j<{ executions: AgentExecution[] }>(fetch(`/api/executions?limit=${limit}`)),

  // ===== 工作流 / 设置 =====
  listWorkflows: () => j<{ workflows: WorkflowDefinition[] }>(fetch('/api/workflows')),
  getSettings: () => j<Record<string, unknown>>(fetch('/api/settings')),
  putSettings: (body: Record<string, unknown>) => j<Record<string, unknown>>(fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),

  // ===== 聊天 =====
  chatHistory: (chatKind: 'group' | 'private', to: string) => j<{ messages: Message[] }>(fetch(`/api/chat/history?kind=${chatKind}&to=${encodeURIComponent(to)}`)),
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
