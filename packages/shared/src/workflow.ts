/**
 * 电商新品上架工作流 —— 6 阶段图定义（OpenSpec workflow-engine）
 * 阶段节点 + 顺序边 + 3 确认点条件分支 + 校对回退分支 + 并行子任务分组
 */
import type { WorkflowDefinition, WorkflowNode } from './types.ts';

/** 阶段节点 id（稳定 key，任务表 stage 字段使用） */
export const STAGE_REQUIREMENT = 'requirement';
export const STAGE_COPY = 'copy';
export const STAGE_MAIN_IMAGE = 'main-image';
export const STAGE_DETAIL_IMAGE = 'detail-image';
export const STAGE_REVIEW = 'review';
export const STAGE_DELIVER = 'deliver';

export const WORKFLOW_STAGE_KEYS = [
  STAGE_REQUIREMENT,
  STAGE_COPY,
  STAGE_MAIN_IMAGE,
  STAGE_DETAIL_IMAGE,
  STAGE_REVIEW,
  STAGE_DELIVER,
] as const;

/* ===== 小红书种草笔记工作流（第二条业务工作流） =====
 * 阶段 key 统一带 `xhs-` 前缀：电商已有 copy / review / deliver 三个同名 key，
 * 不加前缀会让 XHS 任务在加载错图时匹配到电商节点并跑错 producer（静默错误）。
 * 加前缀后 nodeOf 返回 undefined → 安全失败，而非静默跑错逻辑。 */

export const XHS_STAGE_TOPIC = 'xhs-topic';
export const XHS_STAGE_COPY = 'xhs-copy';
export const XHS_STAGE_IMAGE = 'xhs-image';
export const XHS_STAGE_REVIEW = 'xhs-review';
export const XHS_STAGE_PACKAGE = 'xhs-package';
export const XHS_STAGE_DELIVER = 'xhs-deliver';

export const XHS_WORKFLOW_ID = 'xhs-note';

export const XHS_WORKFLOW_NAME = '小红书种草笔记';

export const XHS_STAGE_KEYS = [
  XHS_STAGE_TOPIC,
  XHS_STAGE_COPY,
  XHS_STAGE_IMAGE,
  XHS_STAGE_REVIEW,
  XHS_STAGE_PACKAGE,
  XHS_STAGE_DELIVER,
] as const;

/** XHS 确认点（选题 / 笔记 / 配图）；合规审核与发布包装均为自动节点，不在其中 */
export const XHS_APPROVAL_POINT_STAGES = [XHS_STAGE_TOPIC, XHS_STAGE_COPY, XHS_STAGE_IMAGE];

export const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  [STAGE_REQUIREMENT]: '需求对接',
  [STAGE_COPY]: '卖点文案',
  [STAGE_MAIN_IMAGE]: '主图设计',
  [STAGE_DETAIL_IMAGE]: '详情图设计',
  [STAGE_REVIEW]: '主管校对',
  [STAGE_DELIVER]: '交付完成',
  // XHS 阶段（key 带 xhs- 前缀，永不与电商同名）
  [XHS_STAGE_TOPIC]: '选题策划',
  [XHS_STAGE_COPY]: '笔记撰写',
  [XHS_STAGE_IMAGE]: '封面配图',
  [XHS_STAGE_REVIEW]: '合规审核',
  [XHS_STAGE_PACKAGE]: '发布包装',
  [XHS_STAGE_DELIVER]: '交付完成',
};

/** 确认点所在阶段（卖点文案、主图设计、详情图设计） */
export const APPROVAL_POINT_STAGES = [STAGE_COPY, STAGE_MAIN_IMAGE, STAGE_DETAIL_IMAGE];

export const WORKFLOW_ID = 'ecom-new-listing';

export const WORKFLOW_NAME = '电商新品上架';

/** 阶段 → 负责 Agent 角色 */
export const STAGE_OWNER_ROLE: Record<string, string> = {
  [STAGE_REQUIREMENT]: '文案',
  [STAGE_COPY]: '文案',
  [STAGE_MAIN_IMAGE]: '设计师',
  [STAGE_DETAIL_IMAGE]: '设计师',
  [STAGE_REVIEW]: '主管',
  [STAGE_DELIVER]: '主管',
};

/**
 * 预置图定义：
 * 节点链 requirement → copy → main-image → detail-image → review → deliver
 * copy / main-image / detail-image 为确认点（approved 边推进 / rejected 边返回自身返工）
 * review 通过沿 passed 边到 deliver；发现问题沿 rollback 边回退受影响节点（copy / main-image / detail-image）
 * main-image / detail-image 声明并行子任务分组（按渠道分组、组内串行）
 */
export const ECOM_WORKFLOW: WorkflowDefinition = {
  id: WORKFLOW_ID,
  name: WORKFLOW_NAME,
  nodes: [
    {
      id: STAGE_REQUIREMENT,
      label: '需求对接',
      ownerRole: '文案',
      autoNext: true,
    },
    {
      id: STAGE_COPY,
      label: '卖点文案',
      ownerRole: '文案',
      approvalPoint: true,
    },
    {
      id: STAGE_MAIN_IMAGE,
      label: '主图设计',
      ownerRole: '设计师',
      approvalPoint: true,
      parallelGroups: [
        { channel: 'img-1', items: ['主图1', '副图2'] },
        { channel: 'img-2', items: ['副图3'] },
      ],
    },
    {
      id: STAGE_DETAIL_IMAGE,
      label: '详情图设计',
      ownerRole: '设计师',
      approvalPoint: true,
      parallelGroups: [
        { channel: 'img-1', items: ['卖点图', '细节图'] },
        { channel: 'img-2', items: ['参数图', '场景图'] },
      ],
    },
    {
      id: STAGE_REVIEW,
      label: '主管校对',
      ownerRole: '主管',
      autoNext: false,
    },
    {
      id: STAGE_DELIVER,
      label: '交付完成',
      ownerRole: '主管',
      autoNext: true,
    },
  ],
  edges: [
    { from: STAGE_REQUIREMENT, to: STAGE_COPY, label: '顺序' },
    { from: STAGE_COPY, to: STAGE_MAIN_IMAGE, label: '确认点1', condition: 'approved' },
    { from: STAGE_COPY, to: STAGE_COPY, label: '返工', condition: 'rejected' },
    { from: STAGE_MAIN_IMAGE, to: STAGE_DETAIL_IMAGE, label: '确认点2', condition: 'approved' },
    { from: STAGE_MAIN_IMAGE, to: STAGE_MAIN_IMAGE, label: '返工', condition: 'rejected' },
    { from: STAGE_DETAIL_IMAGE, to: STAGE_REVIEW, label: '确认点3', condition: 'approved' },
    { from: STAGE_DETAIL_IMAGE, to: STAGE_DETAIL_IMAGE, label: '返工', condition: 'rejected' },
    { from: STAGE_REVIEW, to: STAGE_DELIVER, label: '放行', condition: 'passed' },
    { from: STAGE_REVIEW, to: STAGE_COPY, label: '回退文案', condition: 'rollback' },
    { from: STAGE_REVIEW, to: STAGE_MAIN_IMAGE, label: '回退主图', condition: 'rollback' },
    { from: STAGE_REVIEW, to: STAGE_DETAIL_IMAGE, label: '回退详情图', condition: 'rollback' },
  ],
};

/** 校对可回退的目标节点（发现问题按归属回退） */
export const REVIEW_ROLLBACK_TARGETS = [STAGE_COPY, STAGE_MAIN_IMAGE, STAGE_DETAIL_IMAGE];

/**
 * 小红书种草笔记图定义：
 * 节点链 xhs-topic → xhs-copy → xhs-image → xhs-review → xhs-package → xhs-deliver
 * xhs-topic / xhs-copy / xhs-image 为人工确认点（3 个）；
 * xhs-review 与 xhs-package 均为自动节点（autoNext）：
 *   合规审核通过沿 passed 边到发布包装，检出问题沿 rollback 边回退 xhs-copy 或 xhs-image；
 *   发布包装产出后沿 next 边直接进交付完成，用户无需再点确认（交付包在右上角下载）。
 * xhs-image 声明并行子任务分组（首图 ×1 + 内页图 ×2）。
 */
export const XHS_WORKFLOW: WorkflowDefinition = {
  id: XHS_WORKFLOW_ID,
  name: XHS_WORKFLOW_NAME,
  nodes: [
    {
      id: XHS_STAGE_TOPIC,
      label: '选题策划',
      ownerRole: '文案',
      approvalPoint: true,
    },
    {
      id: XHS_STAGE_COPY,
      label: '笔记撰写',
      ownerRole: '文案',
      approvalPoint: true,
    },
    {
      id: XHS_STAGE_IMAGE,
      label: '封面配图',
      ownerRole: '设计师',
      approvalPoint: true,
      parallelGroups: [{ channel: 'img-1', items: ['首图', '内页图1', '内页图2'] }],
    },
    {
      id: XHS_STAGE_REVIEW,
      label: '合规审核',
      ownerRole: '主管',
      autoNext: true,
    },
    {
      id: XHS_STAGE_PACKAGE,
      label: '发布包装',
      ownerRole: '文案',
      autoNext: true,
    },
    {
      id: XHS_STAGE_DELIVER,
      label: '交付完成',
      ownerRole: '主管',
      autoNext: true,
    },
  ],
  edges: [
    { from: XHS_STAGE_TOPIC, to: XHS_STAGE_COPY, label: '确认点1', condition: 'approved' },
    { from: XHS_STAGE_TOPIC, to: XHS_STAGE_TOPIC, label: '返工', condition: 'rejected' },
    { from: XHS_STAGE_COPY, to: XHS_STAGE_IMAGE, label: '确认点2', condition: 'approved' },
    { from: XHS_STAGE_COPY, to: XHS_STAGE_COPY, label: '返工', condition: 'rejected' },
    { from: XHS_STAGE_IMAGE, to: XHS_STAGE_REVIEW, label: '确认点3', condition: 'approved' },
    { from: XHS_STAGE_IMAGE, to: XHS_STAGE_IMAGE, label: '返工', condition: 'rejected' },
    { from: XHS_STAGE_REVIEW, to: XHS_STAGE_PACKAGE, label: '放行', condition: 'passed' },
    { from: XHS_STAGE_REVIEW, to: XHS_STAGE_COPY, label: '回退文案', condition: 'rollback' },
    { from: XHS_STAGE_REVIEW, to: XHS_STAGE_IMAGE, label: '回退配图', condition: 'rollback' },
    // 发布包装为自动节点：产出后沿无条件 next 边直接到交付完成（无人为确认点）
    { from: XHS_STAGE_PACKAGE, to: XHS_STAGE_DELIVER, label: '顺序' },
  ],
};

/** 默认图片并行分组（与图定义 parallelGroups 对应） */
export const DEFAULT_IMAGE_CHANNELS = ['img-1', 'img-2'];

/* ===== 按工作流取值的 helper（替代前端与 service 层的电商常量硬引用） ===== */

/** 工作流 id → 内置图定义；未知 id 返回 undefined（调用方决定回退或抛错） */
export function workflowById(workflowId?: string): WorkflowDefinition | undefined {
  if (!workflowId || workflowId === WORKFLOW_ID) return ECOM_WORKFLOW;
  if (workflowId === XHS_WORKFLOW_ID) return XHS_WORKFLOW;
  return undefined;
}

/** 某工作流的阶段序列（按节点顺序）；未知工作流回退电商，保证存量任务可用 */
export function stagesOf(workflowId?: string): WorkflowNode[] {
  return (workflowById(workflowId) ?? ECOM_WORKFLOW).nodes;
}

/** 某工作流的阶段 key 数组（替换前端的 WORKFLOW_STAGE_KEYS） */
export function stageKeysOf(workflowId?: string): string[] {
  return stagesOf(workflowId).map((n) => n.id);
}

/** 某工作流的人工确认点 key 数组（替换 service 层与前端的 APPROVAL_POINT_STAGES） */
export function approvalPointsOf(workflowId?: string): string[] {
  return stagesOf(workflowId)
    .filter((n) => n.approvalPoint)
    .map((n) => n.id);
}

/** 某阶段在其所属工作流中的序号（0 基；不在图中返回 -1） */
export function stageIndexOf(workflowId: string | undefined, stage: string): number {
  return stageKeysOf(workflowId).indexOf(stage);
}

/** 某阶段节点（不在图中返回 undefined → 调用方应安全失败，不静默推进） */
export function nodeOfStage(workflowId: string | undefined, stage: string): WorkflowNode | undefined {
  return stagesOf(workflowId).find((n) => n.id === stage);
}

/** 某工作流的图片类阶段（声明了并行子任务分组的节点） */
export function imageStagesOf(workflowId?: string): string[] {
  return stagesOf(workflowId)
    .filter((n) => n.parallelGroups?.length)
    .map((n) => n.id);
}

/** 是否为 XHS 工作流（前端布局与面板分派用） */
export function isXhsWorkflow(workflowId?: string): boolean {
  return workflowId === XHS_WORKFLOW_ID;
}

/* ===== 技能工作流分类隔离（skill-workflow-isolation）===== */

/**
 * 工作流 → 可使用的技能分类（与技能库目录分类同名：电商/小红书/通用）。
 * - 挂载技能按此边界过滤：注入（后端 prompt）与展示（前端任务侧）同口径；
 * - 「通用」对所有工作流可用（兜底区语义）；
 * - 未列出的 workflowId 由 allowedCategoriesFor 返回 null = 全分类可见（兜底，防新增工作流技能被静默丢弃）。
 */
export const WORKFLOW_CATEGORIES: Record<string, string[]> = {
  [WORKFLOW_ID]: ['电商', '通用'],
  [XHS_WORKFLOW_ID]: ['小红书', '通用'],
};

/**
 * 某工作流可使用的技能分类集合。
 * 返回 null 表示该工作流不在映射表中（未知工作流兜底：全分类可见，不做过滤）。
 */
export function allowedCategoriesFor(workflowId?: string): string[] | null {
  if (!workflowId) return null;
  return WORKFLOW_CATEGORIES[workflowId] ?? null;
}
