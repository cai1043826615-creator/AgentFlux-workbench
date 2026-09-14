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
import { buildHotContext, buildKnowledgeContext } from '../knowledge/refs.ts';
import { assembleReworkText, getPendingRework } from '../engine/rework.ts';
import * as delivery from '../delivery/store.ts';

/** 上传目录（与 routes/tasks.ts UPLOAD_DIR 一致） */
const UPLOAD_DIR = join(import.meta.dirname, '..', '..', 'data', 'uploads');

/** 单张图片累计生图尝试上限（含自动重试与手动重试；B11 规格：不超过 3 次，抽为常量供测试断言） */
export const MAX_IMAGE_ATTEMPTS = 3;

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
 *
 * skill-workflow-isolation（二轮定案）：传入 workflowId 时注入**该工作流的挂载份**
 * （agents.workflow_skills[workflowId]，挂什么用什么）；分份缺失（旧数据/未分份）回退
 * 全局 skills（等价「每份初始值 = 旧全局挂载」）；未传 workflowId（非 producer 调用点）
 * 回退全局。分类过滤逻辑已废弃——隔离由分份存储本身实现。
 * 工作流专属技能（WORKFLOW_SKILLS）为独立机制，不经过本通道。
 */
export async function buildSystemPrompt(agentId: string, base: string, workflowId?: string): Promise<string> {
  const row = get<Pick<AgentRow, 'skills' | 'files' | 'workflow_skills'>>('SELECT skills, files, workflow_skills FROM agents WHERE id = ?', [agentId]);
  if (!row) return base;

  // 该任务工作流的挂载份：workflow_skills 有值用之，否则回退全局 skills（读时兜底，零迁移）
  let mountedSkills = parseList(row.skills);
  if (workflowId) {
    try {
      const parts_map = row.workflow_skills ? (JSON.parse(row.workflow_skills) as Record<string, string[]>) : null;
      const part = parts_map?.[workflowId];
      if (part) mountedSkills = part;
    } catch {
      /* JSON 坏行 → 回退全局（与既有容错语义一致） */
    }
  }

  const parts: string[] = [];

  const skillBlocks: string[] = [];
  for (const skillId of mountedSkills) {
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
 * 工作流专属技能：按 workflowId 注入，不占用 Agent 的个人技能位。
 * 场景：同一 Agent 服务多条工作流（如美美既写电商文案又写小红书笔记），
 * 工作流红线（如《小红书合规违禁词清单》）只应出现在对应工作流的 prompt 里。
 * 键为技能 id，值为适用的工作流 id 列表；未列出任何工作流技能时本函数不产生任何内容。
 */
const WORKFLOW_SKILLS: Record<string, string[]> = {
  小红书合规违禁词清单: ['xhs-note'],
};

/** 收集适用于某工作流的工作流专属技能段（无则返回空串，prompt 与既有完全一致） */
async function workflowSkillBlock(workflowId?: string): Promise<string> {
  if (!workflowId) return '';
  const blocks: string[] = [];
  for (const [skillId, wfIds] of Object.entries(WORKFLOW_SKILLS)) {
    if (!wfIds.includes(workflowId)) continue;
    const content = await readSkillContent(skillId);
    if (content) blocks.push(`## 工作流专属技能：${skillId}\n${content}`);
  }
  return blocks.length > 0 ? `【工作流专属技能】\n\n${blocks.join('\n\n')}` : '';
}

/**
 * 组装 producer 最终 system prompt：基础 system + 挂载技能/文件 + 工作流专属技能 + 关联知识库资料 + 任务背景·外部环境情报 + 上次返工意见。
 * 段序固定：base → 【挂载技能】→【挂载文件】→【工作流专属技能】→【关联知识库资料】→【任务背景 · 外部环境情报】→【上次返工意见】。
 * - 知识库段为既有一级通道（不改既有段序与行为）；
 * - 工作流专属技能段按 workflowId 注入：电商任务无此段，最终 prompt 与既有完全一致（板块独立性）；
 * - 热点段为 hot-intel 追加：仅当任务挂了热点背景时才出现，标题「【任务背景 · 外部环境情报】」，
 *   含「不得作为产品品类/主体/功能规格依据」约束；持久化快照注入，不依赖热点面板当前状态（源不可用时仍可用）。
 * - taskId 无关联资料 / 无热点背景 / 无待处理返工意见时对应段为空，最终 prompt 与既有完全一致（板块独立性）。
 */
export async function buildProducerSystemPrompt(agentId: string, base: string, taskId?: number, workflowId?: string): Promise<string> {
  const withMounts = await buildSystemPrompt(agentId, base, workflowId);
  const wfSkills = await workflowSkillBlock(workflowId);
  const kb = await buildKnowledgeContext(taskId);
  const hot = buildHotContext(taskId); // 同步只读快照表；异常内部降级为空串
  const parts: string[] = [withMounts];
  if (wfSkills) parts.push(wfSkills);
  if (kb) parts.push(kb);
  if (hot) parts.push(hot); // hot-intel D2：热点段在「关联知识库资料」段之后追加
  if (taskId != null) {
    const pending = getPendingRework(taskId);
    if (pending.latest) {
      parts.push(assembleReworkText(pending.latest.stage, pending.stageCount, pending.latest.note));
    }
  }
  return parts.join('\n\n');
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
    workflowId?: string,
  ): Promise<T> {
    try {
      const finalSystem = await buildProducerSystemPrompt(agentId, system, taskId, workflowId);
      const { content: text } = await callLlm({ agentId, system: finalSystem, user });
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
      task.workflowId,
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
      task.workflowId,
    );
  }

  async produceImages(
    task: Task,
    groups: WorkflowParallelGroup[],
    onEach: (itemId: string, ok: boolean, dataUrl?: string) => void,
  ): Promise<{ ok: boolean; itemId: string; dataUrl?: string; error?: string; attempts?: number }[]> {
    const isMain = task.stage === 'main-image';
    const basePrompt = isMain
      ? `电商产品主图（白底图），产品：${task.title}，突出核心卖点，干净专业电商摄影构图，方形 1:1，高质感`
      : `电商详情页长图分区，产品：${task.title}，卖点/细节/参数清晰呈现，图文排版专业`;

    // 参考图基准（修复：上传图从未作为参考图提交 → 主图/详情图均以参考图为基础生成；详情图无上传图时以主图1为基准）
    const refImage = await resolveReferenceImage(task, isMain);
    const refSuffix = refImage ? '。必须严格基于参考图生成：产品外观、颜色、造型、LOGO/标识与参考图完全一致，仅变换角度/场景/构图，不得更换产品' : '';

    const results = await runParallelGroups<{ dataUrl: string; attempts: number }>(
      groups.map((g) => ({ channel: g.channel, items: g.items })),
      async (itemId) => {
        // 生图自动重试（上限 MAX_IMAGE_ATTEMPTS，指数退避）：参考图 edits / 文生图偶发抖动或上游限流时自动重试
        let lastErr: unknown;
        for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt++) {
          try {
            // 真实生图：有参考图走 /images/edits 图生图，无参考图走 /images/generations 文生图
            const dataUrl = await generateImage(`${basePrompt} —— 分区/子图：${itemId}${refSuffix}`, '1024x1024', refImage);
            return { dataUrl, attempts: attempt };
          } catch (err) {
            // 仅「无渠道配置」属于 mock 降级：返回 svg 占位图（前端识别 dataURL 标注「模拟占位」）
            if (err instanceof ImageChannelUnavailableError) {
              return { dataUrl: createPlaceholderImage(itemId, '#7C3AED'), attempts: attempt };
            }
            lastErr = err;
            if (attempt < MAX_IMAGE_ATTEMPTS) {
              console.warn(`[producer] 生图第 ${attempt} 次失败（${itemId}）: ${err instanceof Error ? err.message : err}，${1500 * attempt}ms 后重试`);
              await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
          }
        }
        // MAX_IMAGE_ATTEMPTS 次均失败：真实渠道报错，抛给 runParallelGroups 记为失败（ok=false）→ 上层落 status='failed'，
        // 绝不把 svg 占位图当作成品图入库
        console.warn(`[producer] 生图 ${MAX_IMAGE_ATTEMPTS} 次重试均失败（${itemId}）: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
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
      // 3 次均失败时 attempts 记满（失败路径在 worker 内 throw，attempts 无法从 value 带出，统一记上限）
      attempts: r.ok ? r.value?.attempts : MAX_IMAGE_ATTEMPTS,
    }));
  }

  /**
   * 单张图片重试（B11 · 4.8）：只重新生成指定 imageId 一张。
   * 累计尝试上限由 service 层按 ImageItem.attempts 拦截；此处为单次生图尝试（无嵌套自动重试）。
   */
  async retryImage(task: Task, imageId: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
    const isMain = task.stage === 'main-image';
    const basePrompt = isMain
      ? `电商产品主图（白底图），产品：${task.title}，突出核心卖点，干净专业电商摄影构图，方形 1:1，高质感`
      : `电商详情页长图分区，产品：${task.title}，卖点/细节/参数清晰呈现，图文排版专业`;
    const refImage = await resolveReferenceImage(task, isMain);
    const refSuffix = refImage ? '。必须严格基于参考图生成：产品外观、颜色、造型、LOGO/标识与参考图完全一致，仅变换角度/场景/构图，不得更换产品' : '';
    try {
      const dataUrl = await generateImage(`${basePrompt} —— 分区/子图：${imageId}${refSuffix}`, '1024x1024', refImage);
      return { ok: true, dataUrl };
    } catch (err) {
      // 无渠道配置 → 与既有 produceImages 一致：mock 占位图作为可决策结果
      if (err instanceof ImageChannelUnavailableError) {
        return { ok: true, dataUrl: createPlaceholderImage(imageId, '#7C3AED') };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
        task.workflowId,
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
    const { content: text } = await callLlm({ agentId, system, user, images: [baselineUrl, targetUrl], temperature: 0.2, maxTokens: 200 });
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
      task.workflowId,
    );
  }
}

export function installSmartProducer(): void {
  setProducer(new SmartProducer());
}
