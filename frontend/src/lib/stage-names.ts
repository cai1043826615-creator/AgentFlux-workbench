import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';

/**
 * 阶段显示名别名表（D-12 / D-13）：
 * 内部阶段 id（如 xhs-image）SHALL NOT 直接暴露在界面，统一经本表映射为用户可见阶段名。
 * 优先级：共享 WORKFLOW_STAGE_LABELS（当前工作流阶段）→ 本别名表（历史废弃阶段等）→ 原样兜底。
 *
 * 背景：
 * - D-12：界面曾直接暴露内部阶段 id（xhs-image）→ 走别名表后不再出现；
 * - D-13：「封面配图 / 首图设计」两个叫法 → 统一为「首图设计」。
 */
const STAGE_ALIAS_NAMES: Record<string, string> = {
  // 历史任务可能停在结构变更前的废弃阶段（封面配图 / 发布包装），统一给用户可见名
  'xhs-image': '首图设计（旧）',
  'xhs-package': '发布包装（旧）',
};

/** 取阶段的用户可见显示名：优先共享标签，其次别名表，最后原样兜底 */
export function stageDisplayName(stage: string): string {
  return WORKFLOW_STAGE_LABELS[stage] ?? STAGE_ALIAS_NAMES[stage] ?? stage;
}
