/**
 * 电商新品上架工作流 —— 6 阶段图定义（OpenSpec workflow-engine）
 * 阶段节点 + 顺序边 + 2 拍板点条件分支 + 校对回退分支 + 并行子任务分组
 */
import type { WorkflowDefinition } from './types.ts';

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

export const WORKFLOW_STAGE_LABELS: Record<string, string> = {
  [STAGE_REQUIREMENT]: '需求对齐',
  [STAGE_COPY]: '卖点文案',
  [STAGE_MAIN_IMAGE]: '主图设计',
  [STAGE_DETAIL_IMAGE]: '详情图设计',
  [STAGE_REVIEW]: '主管校对',
  [STAGE_DELIVER]: '交付归档',
};

/** 拍板点所在阶段（卖点文案、主图设计） */
export const APPROVAL_POINT_STAGES = [STAGE_COPY, STAGE_MAIN_IMAGE];

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
 * copy / main-image 为拍板点（approved 边推进 / rejected 边返回自身返工）
 * review 通过沿 passed 边到 deliver；发现问题沿 rollback 边回退受影响节点（copy / main-image / detail-image）
 * main-image / detail-image 声明并行子任务分组（按渠道分组、组内串行）
 */
export const ECOM_WORKFLOW: WorkflowDefinition = {
  id: WORKFLOW_ID,
  name: WORKFLOW_NAME,
  nodes: [
    {
      id: STAGE_REQUIREMENT,
      label: '需求对齐',
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
      autoNext: true,
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
      label: '交付归档',
      ownerRole: '主管',
      autoNext: true,
    },
  ],
  edges: [
    { from: STAGE_REQUIREMENT, to: STAGE_COPY, label: '顺序' },
    { from: STAGE_COPY, to: STAGE_MAIN_IMAGE, label: '拍板点1', condition: 'approved' },
    { from: STAGE_COPY, to: STAGE_COPY, label: '返工', condition: 'rejected' },
    { from: STAGE_MAIN_IMAGE, to: STAGE_DETAIL_IMAGE, label: '拍板点2', condition: 'approved' },
    { from: STAGE_MAIN_IMAGE, to: STAGE_MAIN_IMAGE, label: '返工', condition: 'rejected' },
    { from: STAGE_DETAIL_IMAGE, to: STAGE_REVIEW, label: '顺序' },
    { from: STAGE_REVIEW, to: STAGE_DELIVER, label: '放行', condition: 'passed' },
    { from: STAGE_REVIEW, to: STAGE_COPY, label: '回退文案', condition: 'rollback' },
    { from: STAGE_REVIEW, to: STAGE_MAIN_IMAGE, label: '回退主图', condition: 'rollback' },
    { from: STAGE_REVIEW, to: STAGE_DETAIL_IMAGE, label: '回退详情图', condition: 'rollback' },
  ],
};

/** 校对可回退的目标节点（发现问题按归属回退） */
export const REVIEW_ROLLBACK_TARGETS = [STAGE_COPY, STAGE_MAIN_IMAGE, STAGE_DETAIL_IMAGE];

/** 默认图片并行分组（与图定义 parallelGroups 对应） */
export const DEFAULT_IMAGE_CHANNELS = ['img-1', 'img-2'];
