import { ECOM_WORKFLOW, WORKFLOW_ID } from '@workbench/shared';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@workbench/shared';
import { all, get } from '../db/client.ts';

/** 非默认工作流缺失或不可解析 → 抛错，绝不静默套用电商图 */
export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`工作流定义缺失或不可解析：${workflowId}`);
    this.name = 'WorkflowNotFoundError';
  }
}

/**
 * 从库中加载工作流图定义。
 * 默认工作流（电商）缺失/损坏时回退内置图，保证存量任务可用；
 * 其他工作流缺失或损坏时抛错——否则任务会静默跑在错误的图上
 * （XHS 阶段 key 在电商图中不存在，nodeOf 返回 undefined 导致任务卡死）。
 */
export function loadWorkflow(id: string = WORKFLOW_ID): WorkflowDefinition {
  const row = get<{ stages_json: string }>('SELECT stages_json FROM workflows WHERE id = ?', [id]);
  if (row) {
    try {
      return JSON.parse(row.stages_json) as WorkflowDefinition;
    } catch {
      if (id === WORKFLOW_ID) return ECOM_WORKFLOW;
      throw new WorkflowNotFoundError(id);
    }
  }
  if (id === WORKFLOW_ID) return ECOM_WORKFLOW;
  throw new WorkflowNotFoundError(id);
}

/** 库内全部工作流定义（GET /api/workflows 用；无有效记录时回退内置电商图） */
export function loadAllWorkflows(): WorkflowDefinition[] {
  const rows = all<{ id: string; stages_json: string }>('SELECT id, stages_json FROM workflows');
  const wfs: WorkflowDefinition[] = [];
  for (const r of rows) {
    try {
      wfs.push(JSON.parse(r.stages_json) as WorkflowDefinition);
    } catch {
      // 损坏记录跳过，不影响其余工作流返回
    }
  }
  return wfs.length > 0 ? wfs : [ECOM_WORKFLOW];
}

export function getNode(wf: WorkflowDefinition, nodeId: string): WorkflowNode | undefined {
  return wf.nodes.find((n) => n.id === nodeId);
}

export function getNodeIndex(wf: WorkflowDefinition, nodeId: string): number {
  return wf.nodes.findIndex((n) => n.id === nodeId);
}

/** 沿条件分支边取目标节点（approved/rejected/passed/rollback/next） */
export function followEdge(
  wf: WorkflowDefinition,
  from: string,
  condition: WorkflowEdge['condition'],
): WorkflowNode | undefined {
  const edge = wf.edges.find((e) => e.from === from && (e.condition ?? 'next') === condition);
  if (!edge) return undefined;
  return getNode(wf, edge.to);
}

/** 普通顺序边（无条件的推进边，如 requirement → copy） */
export function nextNode(wf: WorkflowDefinition, nodeId: string): WorkflowNode | undefined {
  return followEdge(wf, nodeId, 'next');
}

/** 确认点条件分支 */
export function approvalEdge(wf: WorkflowDefinition, from: string, approved: boolean): WorkflowNode | undefined {
  return followEdge(wf, from, approved ? 'approved' : 'rejected');
}

/** 校对回退目标（rollback 边集合） */
export function rollbackTargets(wf: WorkflowDefinition, from: string): WorkflowNode[] {
  return wf.edges
    .filter((e) => e.from === from && e.condition === 'rollback')
    .map((e) => getNode(wf, e.to))
    .filter((n): n is WorkflowNode => Boolean(n));
}

/** 阶段节点的并行子任务分组 */
export function parallelGroupsOf(wf: WorkflowDefinition, nodeId: string) {
  return getNode(wf, nodeId)?.parallelGroups ?? [];
}
