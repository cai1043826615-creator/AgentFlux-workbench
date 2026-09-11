import type { CopyPackage, ImageItem, Task, WorkflowParallelGroup } from '@workbench/shared';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runParallelGroups } from '../engine/parallel.ts';
import { createPlaceholderImage } from '../utils/placeholder.ts';
import { get } from '../db/client.ts';
import type { AgentRow } from '../db/schema.ts';
import { generateImage, ImageChannelUnavailableError } from './imagegen.ts';
import { callLlm, LlmChannelUnavailableError } from './llm.ts';
import { MockProducer, type ReviewIssue, type ReviewReport, type StageProducer, setProducer } from './producer.ts';
import { readFileContent, readSkillContent } from './skills.ts';
import { buildKnowledgeContext } from '../knowledge/refs.ts';
import * as delivery from '../delivery/store.ts';

/** 上传目录（与 routes/tasks.ts UPLOAD_DIR 一致） */
const UPLOAD_DIR = join(import.meta.dirname, '..', '..', 'data', 'uploads');

/**
 * 参考图 → dataURL（生图/视觉审阅要求 dataURL 或可公网访问 URL）：
 * - data: → 原样
 * - /uploads/xxx → 读本地文件转 dataURL
 * - http(s) → 原样（若用于图生图，imagegen 会因无法解析而退化文生图）
 */
async function toDataUrl(ref: string): Promise<string | undefined> {
  if (ref.startsWith('data:')) return ref;
  if (ref.startsWith('/uploads/')) {
    const name = ref.slice('/uploads/'.length);
    try {
      const buf = await readFile(join(UPLOAD_DIR, name));
      const ext = name.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return undefined;
    }
  }
  return ref;
}

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
 * 参考图基准（返回 dataURL）：
 * - 有上传参考图 → 返回它（主图/详情图都基于上传图生成）
 * - 无上传参考图 → 返回已产出的「主图1」（详情图以其为基准，保证全链路产品一致）
 */
async function resolveReferenceImage(task: Task, isMain: boolean): Promise<string | undefined> {
  if (task.referenceImage) return toDataUrl(task.referenceImage);
  if (isMain) return undefined; // 主图无上传图 → 纯文生图
  const d = delivery.getDeliverable(task.id, 'main-image', 'image');
  if (!d) return undefined;
  try {
    const items = JSON.parse(d.content) as ImageItem[];
    const main = items.find((i) => i.kind === 'main' || i.id === '主图1') ?? items[0];
    return main?.url && main.url.startsWith('data:') ? main.url : undefined;
  } catch {
    return undefined;
  }
}

/** 收集任务已产出的全部图片（主图 + 详情图，跳过 failed），供波波视觉审阅 */
function collectStageImages(taskId: number): { stage: 'main-image' | 'detail-image'; name: string; url: string }[] {
  const out: { stage: 'main-image' | 'detail-image'; name: string; url: string }[] = [];
  for (const stage of ['main-image', 'detail-image'] as const) {
    const d = delivery.getDeliverable(taskId, stage, 'image');
    if (!d) continue;
    try {
      const items = JSON.parse(d.content) as ImageItem[];
      for (const it of items) {
        if (it.url && it.url.startsWith('data:') && it.status !== 'failed') out.push({ stage, name: it.name || it.id, url: it.url });
      }
    } catch {
      /* ignore */
    }
  }
  return out;
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
 * 组装 producer 最终 system prompt：基础 system + 挂载技能/文件 + 关联知识库资料。
 * taskId 无关联资料时知识库段为空串，最终 prompt 与既有完全一致（板块独立性）。
 */
export async function buildProducerSystemPrompt(agentId: string, base: string, taskId?: number): Promise<string> {
  const withMounts = await buildSystemPrompt(agentId, base);
  const kb = await buildKnowledgeContext(taskId);
  return kb ? `${withMounts}\n\n${kb}` : withMounts;
}

/**
 * 智能 Producer：真实 LLM / 生图渠道优先，不可用或失败时自动降级为内置 mock
 * （design.md D9 mock 降级开关；渠道来自 .env.local 默认或设置面板）。
 */
export class SmartProducer implements StageProducer {
  private mock = new MockProducer();

  private async withLlm<T>(
    agentId: string,
    system: string,
    user: string,
    fallback: () => Promise<T>,
    parser: (text: string) => T | null,
    taskId?: number,
  ): Promise<T> {
    try {
      const finalSystem = await buildProducerSystemPrompt(agentId, system, taskId);
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
      task.id,
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
      task.id,
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

    // 参考图基准（修复：上传图从未作为参考图提交 → 主图/详情图均以参考图为基础生成；详情图无上传图时以主图1为基准）
    const refImage = await resolveReferenceImage(task, isMain);
    const refSuffix = refImage ? '。必须严格基于参考图生成：产品外观、颜色、造型、LOGO/标识与参考图完全一致，仅变换角度/场景/构图，不得更换产品' : '';

    const results = await runParallelGroups<{ dataUrl: string }>(
      groups.map((g) => ({ channel: g.channel, items: g.items })),
      async (itemId) => {
        // 生图重试（最多 3 次，指数退避）：参考图 edits / 文生图偶发抖动或上游限流时自动重试
        let lastErr: unknown;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            // 真实生图：有参考图走 /images/edits 图生图，无参考图走 /images/generations 文生图
            const dataUrl = await generateImage(`${basePrompt} —— 分区/子图：${itemId}${refSuffix}`, '1024x1024', refImage);
            return { dataUrl };
          } catch (err) {
            // 仅「无渠道配置」属于 mock 降级：返回 svg 占位图（前端识别 dataURL 标注「模拟占位」）
            if (err instanceof ImageChannelUnavailableError) {
              return { dataUrl: createPlaceholderImage(itemId, '#7C3AED') };
            }
            lastErr = err;
            if (attempt < 3) {
              console.warn(`[producer] 生图第 ${attempt} 次失败（${itemId}）: ${err instanceof Error ? err.message : err}，${1500 * attempt}ms 后重试`);
              await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
          }
        }
        // 3 次均失败：真实渠道报错，抛给 runParallelGroups 记为失败（ok=false）→ 上层落 status='failed'，
        // 绝不把 svg 占位图当作成品图入库
        console.warn(`[producer] 生图 3 次重试均失败（${itemId}）: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
        throw lastErr;
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

  /**
   * 波波视觉一致性审阅（基准：上传参考图，无则主图1）。
   * 逐张对比「基准图 vs 生成图」判断是否同一产品；不一致 → issues 打回对应阶段；
   * 无图可审或视觉渠道不可用 → 降级为原文本校对。
   */
  async produceReview(task: Task): Promise<ReviewReport> {
    const agentId = AGENT_IDS['主管'];
    const fallbackTextReview = () =>
      this.withLlm<ReviewReport>(
        agentId,
        '你是电商质检主管，做跨产出物一致性校对（文案与图片信息一致、规格完整、平台合规）。严格输出 JSON：{"report":"校对报告（中文，200字内）","issues":[{"targetStage":"copy|main-image|detail-image","note":"问题描述"}...]}，无问题则 issues 为空数组。',
        `任务：${task.title}（当前待校对全部产出）\n请给出校对报告与问题清单（targetStage 只能是 copy / main-image / detail-image）。`,
        () => this.mock.produceReview(task),
        (text) => {
          const parsed = extractJson<Partial<ReviewReport>>(text);
          if (!parsed || !parsed.report) return null;
          return {
            report: parsed.report,
            issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 3).map((i) => ({ targetStage: String(i.targetStage ?? 'main-image'), note: String(i.note ?? '') })) : [],
          };
        },
        task.id,
      );

    const baseline = (await resolveReferenceImage(task, false)) || (await resolveReferenceImage(task, true)) || task.referenceImage;
    const targets = collectStageImages(task.id);
    if (!baseline || targets.length === 0) {
      // 无图可审（纯文案链路或图片缺失）→ 文本校对
      return fallbackTextReview();
    }

    const baselineName = task.referenceImage ? '上传参考图' : '主图1';
    const issues: ReviewIssue[] = [];
    let checked = 0;
    let failed = 0;
    try {
      for (const t of targets) {
        try {
          const v = await this.visualConsistency(agentId, task, baseline, t.url);
          checked++;
          if (!v.consistent) issues.push({ targetStage: t.stage, note: `「${t.name}」与基准图（${baselineName}）产品不一致：${v.reason}` });
        } catch (err) {
          if (err instanceof LlmChannelUnavailableError) throw err;
          failed++; // 单图检查失败跳过，不中断
          console.warn(`[producer] 视觉审阅失败（${t.stage}/${t.name}）: ${err instanceof Error ? err.message : err}`);
        }
      }
    } catch (err) {
      // 视觉渠道不可用 → 降级文本校对
      console.warn(`[producer] 视觉审阅渠道不可用，降级文本校对: ${err instanceof Error ? err.message : err}`);
      return fallbackTextReview();
    }

    return {
      report: issues.length
        ? `视觉一致性校对（基准：${baselineName}）：发现 ${issues.length} 处图片与基准产品不一致${failed ? `；${failed} 张检查失败已跳过` : ''}，已打回对应阶段返工。`
        : `视觉一致性校对（基准：${baselineName}）：${checked} 张图片与基准产品一致${failed ? `（${failed} 张检查失败已跳过）` : ''}，无问题，准予放行。`,
      issues,
    };
  }

  /** 波波视觉审阅单张图：基准图 vs 生成图，是否同一产品 */
  private async visualConsistency(
    agentId: string,
    task: Task,
    baselineUrl: string,
    targetUrl: string,
  ): Promise<{ consistent: boolean; reason: string }> {
    const system =
      '你是电商质检主管（视觉审阅）。对比两张产品图，判断核心产品是否为同一件：品类、颜色、造型、LOGO/标识、核心特征一致即视为同一件；角度、光线、背景、构图、渲染质感、材质细节等差异不影响判定。严格输出 JSON：{"consistent":true或false,"reason":"不一致时的具体原因（30字内）；一致则空字符串"}，不要输出任何多余文字。';
    const user = `任务「${task.title}」。第一张是基准产品图，第二张是生成图。请判断第二张与第一张是否为同一件产品。`;
    const text = await callLlm({ agentId, system, user, images: [baselineUrl, targetUrl], temperature: 0.2, maxTokens: 200 });
    const parsed = extractJson<{ consistent?: unknown; reason?: string }>(text);
    return { consistent: parsed?.consistent === true || parsed?.consistent === 'true', reason: String(parsed?.reason ?? '') };
  }

  async produceDeliverable(task: Task): Promise<{ packName: string; entries: string[] }> {
    const agentId = AGENT_IDS['主管'];
    return this.withLlm<{ packName: string; entries: string[] }>(
      agentId,
      '你是电商交付完成专员。输出上架资料包清单。严格输出 JSON：{"packName":"资料包名称","entries":["标题","关键词","文案","主图","详情图",...]}',
      `任务：${task.title}，请生成交付完成资料包文件清单（6-8 项）。`,
      () => this.mock.produceDeliverable(task),
      (text) => {
        const parsed = extractJson<{ packName?: string; entries?: string[] }>(text);
        if (!parsed?.packName || !Array.isArray(parsed.entries)) return null;
        return { packName: parsed.packName, entries: parsed.entries };
      },
      task.id,
    );
  }
}

export function installSmartProducer(): void {
  setProducer(new SmartProducer());
}
