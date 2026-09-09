import type { CopyPackage, ImageItem, Task, WorkflowParallelGroup } from '@workbench/shared';
import { createPlaceholderImage } from '../utils/placeholder.ts';

/**
 * Stage Producer 契约：各阶段 Agent 产出（组 3 由 subagent 接入真实 LLM / dsh-imagegen 渠道；
 * 未配置渠道时自动降级为下方内置 mock 输出 —— design.md D9 mock 降级开关）。
 */
export interface ReviewIssue {
  targetStage: string;
  note: string;
}
export interface ReviewReport {
  report: string;
  issues: ReviewIssue[];
}

export interface StageProducer {
  produceRequirement(task: Task): Promise<{ summary: string }>;
  produceCopy(task: Task): Promise<CopyPackage>;
  produceImages(task: Task, groups: WorkflowParallelGroup[], onEach: (itemId: string, ok: boolean, dataUrl?: string) => void): Promise<{ ok: boolean; itemId: string; dataUrl?: string; error?: string }[]>;
  produceReview(task: Task): Promise<ReviewReport>;
  produceDeliverable(task: Task): Promise<{ packName: string; entries: string[] }>;
}

/** 内置 mock 示例（真实渠道未配置时的降级输出） */
export const mockCopyPackage: CopyPackage = {
  title: '便携榨汁杯 Pro · 无线随行 10 秒出汁',
  points: [
    '10 秒快榨：4000 转高速电机，果汁细腻免滤渣',
    '无线随行：Type-C 快充，一次充电可榨 12 杯',
    '轻巧便携：380g 净重，一杯刚好装进通勤包',
    '安全材质：食品级 Tritan 杯体 + 304 不锈钢刀头',
    '一键清洗：可拆卸杯组，冲水即净',
  ],
  outline: '痛点开篇（外食果汁贵且糖高）→ 产品 5 大卖点分层 → 使用场景（通勤/健身/居家）→ 参数与售后',
  keywords: ['便携榨汁杯', '无线榨汁机', '迷你榨汁杯', '随行杯', 'Type-C 充电', '食品级材质'],
};

export class MockProducer implements StageProducer {
  async produceRequirement(task: Task): Promise<{ summary: string }> {
    return {
      summary: `上架需求单已生成：品名「${task.title}」· 目标平台「${task.platform}」· 卖点素材池与视觉风格参考已整理（mock 模式，接入真实 LLM 后由文案 Agent 生成）。`,
    };
  }

  async produceCopy(task: Task): Promise<CopyPackage> {
    // 基于任务标题动态生成（mock）
    const title = task.title || '新品上架';
    return {
      title: `${title} · 旗舰升级款`,
      points: mockCopyPackage.points,
      outline: mockCopyPackage.outline,
      keywords: mockCopyPackage.keywords,
    };
  }

  async produceImages(
    task: Task,
    groups: WorkflowParallelGroup[],
    onEach: (itemId: string, ok: boolean, dataUrl?: string) => void,
  ): Promise<{ ok: boolean; itemId: string; dataUrl?: string; error?: string }[]> {
    const results: { ok: boolean; itemId: string; dataUrl?: string; error?: string }[] = [];
    const palette = ['#7C3AED', '#0EA5E9', '#10B981', '#F59E0B'];
    for (const group of groups) {
      for (const itemId of group.items) {
        const color = palette[Math.floor(Math.random() * palette.length)];
        const dataUrl = createPlaceholderImage(itemId, color);
        results.push({ ok: true, itemId, dataUrl });
        onEach(itemId, true, dataUrl);
      }
    }
    return results;
  }

  async produceReview(task: Task): Promise<ReviewReport> {
    // mock：默认无问题放行（可通过环境变量注入问题演示回退）
    const injectIssue = process.env.WORKBENCH_REVIEW_ISSUE;
    if (injectIssue) {
      return {
        report: `校对报告（mock）：发现「${injectIssue}」问题，已回退对应阶段返工。`,
        issues: [{ targetStage: injectIssue, note: `主图信息与文案不一致（${injectIssue}），请返工` }],
      };
    }
    return {
      report: '校对报告（mock）：标题/关键词/卖点与图片信息一致，平台规格完整，无待修改项，准予放行。',
      issues: [],
    };
  }

  async produceDeliverable(task: Task): Promise<{ packName: string; entries: string[] }> {
    return {
      packName: `${task.title}_上架资料包`,
      entries: ['商品标题', '关键词清单', '卖点文案包', '主图组（1 主图 + 3 副图）', '详情长图', '多平台规格对照表'],
    };
  }
}

/** 运行时选择的 producer：真实渠道由组 3 注入；默认 mock */
let activeProducer: StageProducer | null = null;
export function setProducer(p: StageProducer): void {
  activeProducer = p;
}
export function getProducer(): StageProducer {
  return activeProducer ?? new MockProducer();
}
