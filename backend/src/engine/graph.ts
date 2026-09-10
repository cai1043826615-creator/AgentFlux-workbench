import { ECOM_WORKFLOW, WORKFLOW_ID } from '@workbench/shared';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@workbench/shared';
import { get } from '../db/client.ts';

/** 从库中加载工作流图定义（v1 预置「电商新品上架」；缺失时回退内置图） */
export function loadWorkflow(id: string = WORKFLOW_ID): WorkflowDefinition {
  const row = get<{ stagesJson: string }>('SELECT stages_json FROM workflows WHERE id = ?', [id]);
  if (row) {
    try {
      return JSON.parse(row.stagesJson) as WorkflowDefinition;
    } catch {
      /* fall through */
    }
  }
  return ECOM_WORKFLOW;
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
