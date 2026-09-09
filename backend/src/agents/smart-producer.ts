import type { CopyPackage, ImageItem, Task, WorkflowParallelGroup } from '@workbench/shared';
import { runParallelGroups } from '../engine/parallel.ts';
import { createPlaceholderImage } from '../utils/placeholder.ts';
import { get } from '../db/client.ts';
import type { AgentRow } from '../db/schema.ts';
import { generateImage, ImageChannelUnavailableError } from './imagegen.ts';
import { callLlm, LlmChannelUnavailableError } from './llm.ts';
import { MockProducer, type ReviewReport, type StageProducer, setProducer } from './producer.ts';
import { readFileContent, readSkillContent } from './skills.ts';

const AGENT_IDS: Record<string, string> = {
  '文案': 'agent-copy',
  '设计师': 'agent-design',
  '主管': 'agent-supervisor',
};

/** 从 LLM 输出中宽松提取 JSON */
function extractJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * 解析 agents 表 skills/files 列（JSON 数组，坏 JSON 容错为空数组）
 */
function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 构建 LLM system prompt：在基础 system 后追加【挂载技能】与【挂载文件】段。
 * 查 agents 表取该 agent 的 skills/files 数组，逐项读取本地技能/文件内容注入；
 * 内容为空则跳过对应段，全部为空时原样返回 base。
 */
export async function buildSystemPrompt(agentId: string, base: string): Promise<string> {
  const row = get<Pick<AgentRow, 'skills' | 'files'>>('SELECT skills, files FROM agents WHERE id = ?', [agentId]);
  if (!row) return base;

  const parts: string[] = [];

  const skillBlocks: string[] = [];
  for (const skillId of parseList(row.skills)) {
    const content = await readSkillContent(skillId);
    if (content) skillBlocks.push(`## 技能：${skillId}\n${content}`);
  }
  if (skillBlocks.length > 0) parts.push(`【挂载技能】\n\n${skillBlocks.join('\n\n')}`);

  const fileBlocks: string[] = [];
  for (const fileRef of parseList(row.files)) {
    const content = await readFileContent(fileRef);
    if (content) fileBlocks.push(`## 文件：${fileRef}\n${content}`);
  }
  if (fileBlocks.length > 0) parts.push(`【挂载文件】\n\n${fileBlocks.join('\n\n')}`);

  if (parts.length === 0) return base;
  return `${base}\n\n${parts.join('\n\n')}`;
}

/**
 * 智能 Producer：真实 LLM / 生图渠道优先，不可用或失败时自动降级为内置 mock
 * （design.md D9 mock 降级开关；渠道来自 .env.local 默认或设置面板）。
 */
export class SmartProducer implements StageProducer {
  private mock = new MockProducer();

  private async withLlm<T>(agentId: string, system: string, user: string, fallback: () => Promise<T>, parser: (text: string) => T | null): Promise<T> {
    try {
      const finalSystem = await buildSystemPrompt(agentId, system);
      const text = await callLlm({ agentId, system: finalSystem, user });
      const parsed = parser(text);
      if (parsed) return parsed;
      return fallback();
    } catch (err) {
      if (err instanceof LlmChannelUnavailableError) return fallback();
      console.warn(`[producer] LLM 调用失败，降级 mock: ${err instanceof Error ? err.message : err}`);
      return fallback();
    }
  }

  async produceRequirement(task: Task): Promise<{ summary: string }> {
    const agentId = AGENT_IDS['文案'];
    return this.withLlm(
      agentId,
      '你是电商上架需求整理专员，输出简洁的上架需求单摘要（150字内，中文）。',
      `产品资料：${task.description || task.title}\n目标平台：${task.platform || '未指定'}\n请输出上架需求单摘要（结构化产品信息 + 卖点素材池 + 视觉风格参考要点）。`,
      () => this.mock.produceRequirement(task),
      (text) => ({ summary: text.trim().slice(0, 300) }),
    );
  }

  async produceCopy(task: Task): Promise<CopyPackage> {
    const agentId = AGENT_IDS['文案'];
    const fallback = () => this.mock.produceCopy(task);
    return this.withLlm<CopyPackage>(
      agentId,
      '你是资深电商文案专家（产品文案）。严格输出 JSON（不要任何多余文字）：{"title":"商品标题（含平台关键词优化）","points":["核心卖点1",...,"核心卖点5"],"outline":"详情页文案大纲（一句话概述结构）","keywords":["搜索关键词",...]}',
      `产品资料：${task.description || task.title}\n目标平台：${task.platform || '未指定'}\n输出 5 条核心卖点、标题、详情大纲与 8 个搜索关键词。`,
      fallback,
      (text) => {
        const parsed = extractJson<Partial<CopyPackage>>(text);
        if (!parsed || !parsed.title || !Array.isArray(parsed.points) || parsed.points.length === 0) return null;
        return {
          title: parsed.title,
          points: parsed.points.slice(0, 5),
          outline: parsed.outline ?? '',
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        };
      },
    );
  }

  async produceImages(
    task: Task,
    groups: WorkflowParallelGroup[],
    onEach: (itemId: string, ok: boolean, dataUrl?: string) => void,
  ): Promise<{ ok: boolean; itemId: string; dataUrl?: string; error?: string }[]> {
    const isMain = task.stage === 'main-image';
    const basePrompt = isMain
      ? `电商产品主图（白底图），产品：${task.title}，突出核心卖点，干净专业电商摄影构图，方形 1:1，高质感`
      : `电商详情页长图分区，产品：${task.title}，卖点/细节/参数清晰呈现，图文排版专业`;

    const results = await runParallelGroups<{ dataUrl: string }>(
      groups.map((g) => ({ channel: g.channel, items: g.items })),
      async (itemId) => {
        try {
          // 真实生图（img-api.apinebula.ai / gpt-image-2）
          const dataUrl = await generateImage(`${basePrompt} —— 分区/子图：${itemId}`);
          return { dataUrl };
        } catch (err) {
          // 仅「无渠道配置」属于 mock 降级：返回 svg 占位图（前端识别 dataURL 标注「模拟占位」）
          if (err instanceof ImageChannelUnavailableError) {
            return { dataUrl: createPlaceholderImage(itemId, '#7C3AED') };
          }
          // 真实渠道报错：抛给 runParallelGroups 记为失败（ok=false）→ 上层落 status='failed'，
          // 绝不把 svg 占位图当作成品图入库
          throw err;
        }
      },
      (itemId, ok, value) => {
        onEach(itemId, ok, value?.dataUrl);
      },
    );

    return results.map((r) => ({
      ok: r.ok,
      itemId: r.item.id,
      dataUrl: r.value?.dataUrl,
      error: r.error,
    }));
  }

  async produceReview(task: Task): Promise<ReviewReport> {
    const agentId = AGENT_IDS['主管'];
    const fallback = () => this.mock.produceReview(task);
    return this.withLlm<ReviewReport>(
      agentId,
      '你是电商质检主管，做跨产出物一致性校对（文案与图片信息一致、规格完整、平台合规）。严格输出 JSON：{"report":"校对报告（中文，200字内）","issues":[{"targetStage":"copy|main-image|detail-image","note":"问题描述"}...]}，无问题则 issues 为空数组。',
      `任务：${task.title}（当前待校对全部产出）\n请给出校对报告与问题清单（targetStage 只能是 copy / main-image / detail-image）。`,
      fallback,
      (text) => {
        const parsed = extractJson<Partial<ReviewReport>>(text);
        if (!parsed || !parsed.report) return null;
        return {
          report: parsed.report,
          issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 3).map((i) => ({ targetStage: String(i.targetStage ?? 'main-image'), note: String(i.note ?? '') })) : [],
        };
      },
    );
  }

  async produceDeliverable(task: Task): Promise<{ packName: string; entries: string[] }> {
    const agentId = AGENT_IDS['主管'];
    return this.withLlm<{ packName: string; entries: string[] }>(
      agentId,
      '你是电商交付归档专员。输出上架资料包清单。严格输出 JSON：{"packName":"资料包名称","entries":["标题","关键词","文案","主图","详情图",...]}',
      `任务：${task.title}，请生成交付归档资料包文件清单（6-8 项）。`,
      () => this.mock.produceDeliverable(task),
      (text) => {
        const parsed = extractJson<{ packName?: string; entries?: string[] }>(text);
        if (!parsed?.packName || !Array.isArray(parsed.entries)) return null;
        return { packName: parsed.packName, entries: parsed.entries };
      },
    );
  }
}

export function installSmartProducer(): void {
  setProducer(new SmartProducer());
}
