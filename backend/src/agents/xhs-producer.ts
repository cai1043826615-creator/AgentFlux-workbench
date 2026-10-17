import type { ComplianceReport, NotePackage, Task, TopicOption, WorkflowParallelGroup, XhsNote } from '@workbench/shared';
import { XHS_STAGE_COVER } from '@workbench/shared';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runParallelGroups } from '../engine/parallel.ts';
import { createPlaceholderImage } from '../utils/placeholder.ts';
import * as delivery from '../delivery/store.ts';
import { generateImage, ImageChannelUnavailableError } from './imagegen.ts';
import { callLlm, LlmChannelUnavailableError } from './llm.ts';
import { buildProducerSystemPrompt } from './smart-producer.ts';

/** 上传目录（与 routes/tasks.ts UPLOAD_DIR 一致），视觉审核时把 /uploads 转 dataURL */
const UPLOAD_DIR = join(import.meta.dirname, '..', '..', 'data', 'uploads');

/**
 * 小红书种草笔记生产者（独立于电商 SmartProducer）。
 *
 * 为什么独立：两个工作流的产出语义与 prompt 完全不同，各自持有自己的 system prompt 与解析契约，
 * 互不干扰——这才是「专人专岗」的实际落点（复用三个 Agent，但 prompt 按工作流隔离）。
 */

const AGENT_IDS: Record<string, string> = {
  文案: 'agent-copy',
  设计师: 'agent-design',
  主管: 'agent-supervisor',
};

/** 无渠道时的内置降级选题（保证链路可跑通，不抛异常） */
function mockTopics(task: Task): TopicOption[] {
  const base = task.title || '本产品';
  return [
    { angle: '场景痛点种草', desc: `从「${base}」的高频使用场景切入痛点，情绪化表达`, anchors: ['#好物分享', '#日常必备'] },
    { angle: '成分/参数实测', desc: `以实测口吻拆解核心参数与成分，理性说服`, anchors: ['#测评', '#理性种草'] },
    { angle: '平价替代对比', desc: `对标同类大牌做平替对比，突出性价比`, anchors: ['#平价好物', '#省钱攻略'] },
  ];
}

function mockNote(task: Task): XhsNote {
  const name = task.title || '本产品';
  return {
    title: `${name}｜真实体验分享`,
    body: `入手「${name}」有一段时间了，今天来交一份真实作业📝\n\n先说结论：日常使用真的顺手，细节处理比预期到位，这个价位能打成这样我觉得可以冲。\n\n✅ 使用感受：上手没有学习成本，开箱即用；做工在同类里算扎实的，没有廉价感。\n✅ 日常体验：响应速度快，连续用下来也很稳，没有出现掉链子的情况。\n⚠️ 小缺点：包装偏简单，送人自用建议自己配个收纳。\n\n💰 性价比方面，对比之前用过的几款，它属于「不花冤枉钱」的类型：核心体验都在，溢价不高。\n\n👩‍🎓 适合人群：学生党、租房党、想提升日常幸福感的上班族都合适；追求极致参数的硬核玩家可能会觉得普通。\n\n总结：如果你最近正好在犹豫要不要入手，我的建议是——预算够就冲，早买早享受；还在观望的可以先收藏，蹲一个好价再上车也不迟～`,
    tags: ['#好物分享', '#真实体验', '#日常必备'],
  };
}

function mockCompliance(): ComplianceReport {
  return {
    report: '合规检查通过：无绝对化用语、无医疗宣称。',
    checks: [
      { passed: true, label: '无「最」「第一」等绝对化用语' },
      { passed: true, label: '功效描述无医疗宣称' },
    ],
    issues: [],
  };
}

/** 视觉审核用的图片条目 */
interface NoteImage {
  id: string;
  url: string;
}

/** 取配图阶段最新一批图片（跳过生成失败的），供视觉审核；覆盖首图段与内页段 */
function newestNoteImages(task: Task): NoteImage[] {
  const out: NoteImage[] = [];
  for (const stage of ['xhs-cover', 'xhs-inner', 'xhs-image']) {
    const d = delivery.getDeliverable(task.id, stage, 'image');
    if (!d) continue;
    try {
      const items = JSON.parse(d.content) as { id: string; url?: string; status?: string }[];
      for (const i of items) {
        if (i.status !== 'failed' && i.url) out.push({ id: i.id, url: String(i.url) });
      }
    } catch {
      /* 单阶段解析失败不影响其余阶段 */
    }
  }
  return out;
}

/**
 * 转成视觉模型可读的 URL：
 * - data: / http(s): 原样返回
 * - /uploads/xxx → 读本地文件转 dataURL
 * - 取不到 → undefined（调用方跳过该图，不误判）
 */
async function toVisionUrl(raw: string): Promise<string | undefined> {
  if (!raw) return undefined;
  if (raw.startsWith('data:') || /^https?:\/\//.test(raw)) return raw;
  if (raw.startsWith('/uploads/')) {
    const name = raw.slice('/uploads/'.length);
    try {
      const buf = await readFile(join(UPLOAD_DIR, name));
      const ext = name.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

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

/** 上一阶段已采纳的笔记文案（发布包装与合规审核的输入） */
function latestNote(task: Task): XhsNote | undefined {
  const d = delivery.getDeliverable(task.id, 'xhs-copy', 'copy');
  if (!d) return undefined;
  try {
    const c = JSON.parse(d.content) as { title?: string; outline?: string; keywords?: string[] };
    if (!c.title) return undefined;
    return { title: c.title, body: c.outline ?? '', tags: c.keywords ?? [] };
  } catch {
    return undefined;
  }
}

  /**
 * XHS 配图 prompt（种草笔记风，不是电商商品海报）。
 * 依据 01-内容创作/cover-design 与 seeding-copywriting：真人生活场景 + 自然光 + 手机随拍质感；
 * 明确排除电商视觉（白底图 / 精修棚拍 / 大字报 / 促销角标 / 详情图排版）。
 * 生图与重试共用此函数，避免两处 prompt 改漏（评审 2.3 同类问题）。
 */
function noteImagePrompt(task: Task, itemId: string, note?: XhsNote | null, refLocked = false): string {
  const topic = task.title;
  const hook = note?.title ? note.title.replace(/[（(].*?[)）]/g, '').slice(0, 20) : '';
  const style =
    '小红书种草笔记配图，真人生活化场景，手机随拍质感，自然光，柔和低饱和色调，' +
    '画面有真实使用痕迹与生活道具，构图随意自然，竖版 3:4；' +
    '禁止：白底商品图、电商主图、精修棚拍、促销大字报、价格标签、详情图排版、' +
    '过度磨皮、塑料感、生硬摆拍、乱码文字';
  // 有参考图基准时追加一致性硬约束（与电商 refSuffix 同口径，仅措辞适配小红书风格）
  const refSuffix = refLocked
    ? '。必须严格基于参考图生成：产品外观、颜色、造型、材质、LOGO／标识与参考图完全一致，仅允许变换取景角度、场景与构图，不得更换产品或自行发挥造型'
    : '';
  if (itemId.includes('首图')) {
    return (
      `${style}。这是封面首图，需要一眼抓人：主体是「${topic}」在真实使用场景中的样子，` +
      '画面留白处可有一句简短手写体中文标题' +
      (hook ? `（参考情绪：${hook}）` : '') +
      `，文字要小、像手写笔记，不要做成广告横幅${refSuffix}`
    );
  }
  const idx = /(\d)/.exec(itemId)?.[1] ?? '';
  const focus = idx === '1' ? '展示使用过程与步骤，体现真实体验' : '展示细节质感或前后对比，突出个人感受';
  return `${style}。这是内页配图${idx ? ` 第 ${idx} 张` : ''}：${focus}；主体「${topic}」，像朋友随手拍的分享照，不要商业广告感${refSuffix}`;
}

/**
 * 参考图基准（返回 dataURL）——与电商 resolveReferenceImage 同构，修复小红书配图从不参考上传图的问题：
 * - 首图（xhs-cover）：用户上传参考图；无上传图 → 纯文生图（与电商主图一致）
 * - 内页图（xhs-inner）：已产出的**首图**（保证整组图主体/风格统一）；
 *   首图缺失或生成失败 → 回退用户上传参考图 → 都无则文生图
 * 任一来源都统一转 dataURL（generateImage 只认 dataURL，否则静默退化为文生图）。
 */
async function resolveNoteReferenceImage(task: Task): Promise<string | undefined> {
  const coverStage = XHS_STAGE_COVER;
  if (task.stage !== coverStage) {
    const cover = await firstProducedImageUrl(task.id, coverStage);
    if (cover) return cover;
  }
  return task.referenceImage ? await toVisionUrl(task.referenceImage) : undefined;
}

/** 取某阶段已产出图片的首张可用 url（转 dataURL）；无/失败/占位 → undefined */
async function firstProducedImageUrl(taskId: number, stage: string): Promise<string | undefined> {
  const d = delivery.getDeliverable(taskId, stage, 'image');
  if (!d) return undefined;
  try {
    const items = JSON.parse(d.content) as { id: string; url?: string; status?: string }[];
    const first = items.find((i) => i.status !== 'failed' && i.url && !i.url.startsWith('data:image/svg'));
    return first?.url ? await toVisionUrl(first.url) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 视觉渠道调用自动重试上限（与电商 MAX_IMAGE_ATTEMPTS 同口径=3）。
 * 覆盖两类调用：生图（generateImage）与视觉审核（callLlm 多模态）——
 * 两者都打同一个上游视觉渠道，抖动特征一致，统一用一套重试口径。
 */
const MAX_NOTE_IMAGE_ATTEMPTS = 3;

/** 生图尺寸 */
const IMG_SIZE = '1024x1024';
/**
 * 单张生图超时（毫秒）：与电商工作流（淘宝链路）保持一致，不传自定义值走
 * generateImage 的默认 180s——两条工作流生图口径统一（用户定案 2026-09-14）。
 * 失败可见化由 runStage / 前端 toast 承担，不靠缩短超时。
 */
const IMG_TIMEOUT_MS = 180_000;

class XhsProducer {
  private async withLlm<T>(
    agentId: string,
    system: string,
    user: string,
    fallback: () => T,
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
      console.warn(`[xhs-producer] LLM 调用失败，降级内置内容: ${err instanceof Error ? err.message : err}`);
      return fallback();
    }
  }

  /** 选题策划：3 个选题方向 */
  async produceTopic(task: Task): Promise<TopicOption[]> {
    const agentId = AGENT_IDS['文案'];
    return this.withLlm<TopicOption[]>(
      agentId,
      '你是小红书选题策划。严格输出 JSON（不要多余文字）：{"topics":[{"angle":"切入角度","desc":"方向描述（40字内）","anchors":["#话题1","#话题2"]}...]}\n要求：3 个方向必须角度互斥（如场景痛点 / 成分实测 / 平替对比），anchors 为 2-3 个小红书话题标签。',
      `产品/主题：${task.title}\n资料：${task.description || '（无）'}\n请给出 3 个选题方向。`,
      () => mockTopics(task),
      (text) => {
        const parsed = extractJson<{ topics?: Partial<TopicOption>[] }>(text);
        if (!parsed || !Array.isArray(parsed.topics) || parsed.topics.length === 0) return null;
        const list = parsed.topics
          .slice(0, 3)
          .map((t) => ({
            angle: String(t.angle ?? '').trim(),
            desc: String(t.desc ?? '').trim(),
            anchors: Array.isArray(t.anchors) ? t.anchors.map(String) : [],
          }))
          .filter((t) => t.angle);
        return list.length > 0 ? list : null;
      },
      task.id,
      task.workflowId,
    );
  }

  /** 笔记撰写：标题（≤20 字含 emoji）+ 正文（300-500 字小红书体）+ 话题标签 */
  async produceNote(task: Task): Promise<XhsNote> {
    const agentId = AGENT_IDS['文案'];
    return this.withLlm<XhsNote>(
      agentId,
      '你是资深小红书博主，写真实体验向的种草笔记。严格输出 JSON（不要多余文字）：{"title":"标题（含 1 个 emoji，总长度不超过 20 个字符）","body":"正文","tags":["#话题1","#话题2","#话题3"]}\n\n正文要求（逐条遵守）：\n1. 长度 300-500 字（硬性区间，少于 300 字不合格）；\n2. 小红书调性：第一人称真实体验感，口语化、有情绪、像朋友聊天；\n3. 结构：开头 1-2 句抓眼球（体验结论/场景痛点）→ 中间分点或分段讲 2-4 个真实细节（使用感受/优点，可带 1 个小缺点增加可信度）→ 结尾 1-2 句总结 + 行动引导；\n4. 排版：分 3-5 个自然段，段间空行；可用 1-2 个 emoji 做段首点缀（如 ✅👉💤），不要堆砌；\n5. 语言：多用「真的」「谁懂」「亲测」「闭眼冲」这类小红书口语（不违反广告法的前提下），避免书面腔与广告腔；\n6. 合规：无绝对化用语（最/第一/国家级），无医疗功效宣称。\n输出前自查字数：正文（不含标签）必须 ≥300 字。',
      `产品/主题：${task.title}\n资料：${task.description || '（无）'}\n${task.brief?.audience ? `目标人群：${task.brief.audience}\n` : ''}${task.brief?.product ? `产品：${task.brief.product}\n` : ''}${task.brief?.contentType ? `内容类型：${task.brief.contentType}\n` : ''}请撰写 300-500 字的小红书种草笔记。`,
      () => mockNote(task),
      (text) => {
        const parsed = extractJson<Partial<XhsNote>>(text);
        if (!parsed || !parsed.title || !parsed.body) return null;
        return {
          title: String(parsed.title).slice(0, 40),
          body: String(parsed.body),
          tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
        };
      },
      task.id,
      task.workflowId,
    );
  }


/** 封面配图：首图 ×1 + 内页图 ×2（并行组，逐张上报） */
  async produceNoteImages(
    task: Task,
    groups: WorkflowParallelGroup[],
    onEach: (itemId: string, ok: boolean, dataUrl?: string) => void,
  ): Promise<{ ok: boolean; itemId: string; dataUrl?: string; error?: string; attempts?: number }[]> {
    const note = latestNote(task);
    // 基准图每次调用解析一次：同一组内所有子图共用同一基准，保证组内与参考图双重一致
    const refImage = await resolveNoteReferenceImage(task);
    const results = await runParallelGroups<{ dataUrl: string; attempts: number }>(
      groups.map((g) => ({ channel: g.channel, items: g.items })),
      async (itemId) => {
        // 生图自动重试（上限 MAX_NOTE_IMAGE_ATTEMPTS，指数退避）：与电商同口径
        let lastErr: unknown;
        for (let attempt = 1; attempt <= MAX_NOTE_IMAGE_ATTEMPTS; attempt++) {
          try {
            const dataUrl = await generateImage(
              noteImagePrompt(task, itemId, note, Boolean(refImage)),
              IMG_SIZE,
              refImage,
              IMG_TIMEOUT_MS,
            );
            return { dataUrl, attempts: attempt };
          } catch (err) {
            // 无渠道配置 → 占位图作为可决策结果（与电商一致，前端标注「模拟占位」）
            if (err instanceof ImageChannelUnavailableError) {
              return { dataUrl: createPlaceholderImage(itemId, '#7C3AED'), attempts: attempt };
            }
            lastErr = err;
            if (attempt < MAX_NOTE_IMAGE_ATTEMPTS) {
              console.warn(
                `[xhs-producer] 生图第 ${attempt} 次失败（${itemId}）: ${err instanceof Error ? err.message : err}，${1500 * attempt}ms 后重试`,
              );
              await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
          }
        }
        // 重试耗尽：真实渠道报错 → 抛给 runParallelGroups 记 failed，绝不把占位图当成品入库
        console.warn(`[xhs-producer] 生图 ${MAX_NOTE_IMAGE_ATTEMPTS} 次重试均失败（${itemId}）: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
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
      // 失败路径 worker 内 throw，attempts 无法带出 → 记满上限（与电商口径一致）
      attempts: r.ok ? r.value?.attempts : MAX_NOTE_IMAGE_ATTEMPTS,
    }));
  }

  /** 单张配图重试（prompt 与基准图解析均与 produceNoteImages 同源，避免两处改漏） */
  async retryImage(task: Task, imageId: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
    try {
      const refImage = await resolveNoteReferenceImage(task);
      const dataUrl = await generateImage(
        noteImagePrompt(task, imageId, latestNote(task), Boolean(refImage)),
        IMG_SIZE,
        refImage,
        IMG_TIMEOUT_MS,
      );
      return { ok: true, dataUrl };
    } catch (err) {
      if (err instanceof ImageChannelUnavailableError) {
        return { ok: true, dataUrl: createPlaceholderImage(imageId, '#7C3AED') };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 合规审核（自动节点）：文本合规 + **视觉审核**（与电商 produceReview 对齐）。
   *
   * 视觉审核补的是原来的缺口：只审文本时，配图与参考图不一致（生成的产品和上传的不是一个东西）
   * 检不出来，用户要自己肉眼发现。这里按两条标准检查：
   *   ① 有参考图 → 逐张比对「生成图 vs 参考图」是否同一主体（品类/颜色/造型/关键特征）
   *   ② 无参考图 → 检查「文案描述 vs 图片内容」是否对得上（如文案说白瓶、图是黑瓶）
   * 检出不一致 → targetStage: 'xhs-image' 打回配图阶段。
   */
  async produceCompliance(task: Task): Promise<ComplianceReport> {
    const agentId = AGENT_IDS['主管'];
    const note = latestNote(task);

    // ① 文本合规检查（原逻辑保留）
    const textReport = await this.textCompliance(agentId, task, note);

    // ② 视觉审核（新增）：找出待审图片与基准图
    const imgs = newestNoteImages(task);
    if (imgs.length === 0) {
      // 无图可审（早退：还没生成配图）→ 仅文本结论
      return textReport;
    }
    // 基准图与生图口径同源（上传参考图优先，缺失时以已产出首图为基准）：
    // 审核基准与生成基准必须一致，否则会出现「按 A 生成、按 B 判不一致」的必然误判
    const baseline = await resolveNoteReferenceImage({ ...task, stage: XHS_STAGE_COVER });
    const baselineName = task.referenceImage ? '上传参考图' : 'AI 生成首图';
    const visual = await this.visualReview(agentId, task, note, baseline, imgs, baselineName);

    // 合并：视觉问题优先（图片是返工成本最高的），文本问题其次
    const issues = [...visual.issues, ...textReport.issues].slice(0, 3);
    const checks = [...visual.checks, ...textReport.checks];
    const report = [textReport.report, visual.summary].filter(Boolean).join(' ');
    return { report, checks, issues };
  }

  /** 文本合规审核（违禁词 / 医疗宣称） */
  private async textCompliance(agentId: string, task: Task, note: XhsNote | undefined): Promise<ComplianceReport> {
    const source = note ? `标题：${note.title}\n正文：${note.body}\n标签：${note.tags.join(' ')}` : `产品/主题：${task.title}`;
    return this.withLlm<ComplianceReport>(
      agentId,
      '你是内容合规审核员（小红书平台）。严格输出 JSON（不要多余文字）：{"report":"审核结论（60字内）","checks":[{"passed":true,"label":"检查项","note":"说明"}...],"issues":[{"targetStage":"xhs-copy 或 xhs-image","note":"问题与修改建议"}...]}\n检查项固定为两类：绝对化/违禁用语、医疗功效宣称。\n判定尺度（避免误报）：\n1. 只标注明确违规词；行业通用描述（如「不酸」「温和」「舒缓」）不算医疗宣称；\n2. 医疗宣称 = 声称治疗/治愈/修复疾病或生理问题；单纯描述使用体验不属于；\n3. 每个未通过项必须在 note 里引用原文词句并给出改写建议；给不出原文词句的项不得标记为未通过；\n4. 疑似但拿不准 → 通过并在 note 里标注「建议复核」，不进 issues。\n无问题时 issues 为空数组。',
      `待审核内容：\n${source}\n请给出合规审核结论。`,
      () => mockCompliance(),
      (text) => {
        const parsed = extractJson<Partial<ComplianceReport>>(text);
        if (!parsed || !parsed.report) return null;
        return {
          report: String(parsed.report),
          checks: Array.isArray(parsed.checks)
            ? parsed.checks.slice(0, 5).map((c) => ({ passed: c.passed === true, label: String(c.label ?? ''), note: c.note ? String(c.note) : undefined }))
            : [],
          issues: Array.isArray(parsed.issues)
            ? parsed.issues.slice(0, 3).map((i) => ({
                targetStage: i.targetStage === 'xhs-image' ? ('xhs-image' as const) : ('xhs-copy' as const),
                note: String(i.note ?? ''),
              }))
            : [],
        };
      },
      task.id,
      task.workflowId,
    );
  }

  /**
   * 视觉审核：逐张检查配图。有基准图 → 判「是否同一主体」；无基准图 → 判「与文案是否相符」。
   * 视觉渠道不可用或图片取不到 → 静默跳过（不阻塞流程，宁可不审也不误判）。
   */
  private async visualReview(
    agentId: string,
    task: Task,
    note: XhsNote | undefined,
    baseline: string | undefined,
    imgs: NoteImage[],
    baselineName: string,
  ): Promise<{ summary: string; checks: ComplianceReport['checks']; issues: ComplianceReport['issues'] }> {
    const issues: ComplianceReport['issues'] = [];
    const descText = note ? `标题「${note.title}」正文「${note.body.slice(0, 120)}」` : `主题「${task.title}」`;
    let checked = 0;
    let skipped = 0;

    for (const img of imgs) {
      const url = await toVisionUrl(img.url);
      if (!url) {
        skipped++;
        continue;
      }
      try {
        const r = await this.visualCheck(agentId, task, baseline, url, baseline ? baselineName : undefined, descText);
        checked++;
        if (!r.ok) issues.push({ targetStage: 'xhs-image', note: `「${img.id}」${r.reason}` });
      } catch (err) {
        skipped++;
        console.warn(`[xhs-producer] 视觉审核跳过（${img.id}）: ${err instanceof Error ? err.message : err}`);
      }
    }

    const basis = baseline ? `以${baselineName}为基准比对主体一致性` : '比对图片与文案描述是否相符';
    const summary = checked === 0
      ? `视觉审核未执行（${skipped} 张图片不可读取，已跳过）。`
      : issues.length > 0
        ? `视觉审核（${basis}）：${checked} 张中 ${issues.length} 张不一致${skipped ? `，${skipped} 张跳过` : ''}，已打回配图返工。`
        : `视觉审核（${basis}）：${checked} 张一致${skipped ? `（${skipped} 张跳过）` : ''}。`;
    const checks: ComplianceReport['checks'] = [
      { passed: issues.length === 0, label: baseline ? '配图与参考图主体一致' : '配图与文案描述相符', note: skipped ? `${skipped} 张无法读取已跳过` : undefined },
    ];
    return { summary, checks, issues };
  }

  /** 单张视觉检查：有基准图比主体一致性；无基准图比文案与图片相符度 */
  private async visualCheck(
    agentId: string,
    task: Task,
    baselineUrl: string | undefined,
    targetUrl: string,
    baselineName: string | undefined,
    descText: string,
  ): Promise<{ ok: boolean; reason: string }> {
    const images = baselineUrl ? [baselineUrl, targetUrl] : [targetUrl];
    const system = baselineUrl
      ? '你是小红书内容质检主管（视觉审核）。对比两张图，判断第二张（AI 生成图）与第一张（用户提供的参考图）是否为同一主体：品类、颜色、造型、LOGO/标识、核心特征一致即视为同一主体；角度、光线、背景、构图、渲染质感差异不影响判定。严格输出 JSON：{"ok":true或false,"reason":"不一致时的具体原因（40字内）；一致则空字符串"}'
      : '你是小红书内容质检主管（视觉审核）。判断这张 AI 生成配图与给定文案描述是否相符（如文案提到颜色/材质/场景，图中是否体现；有无明显矛盾）。严格输出 JSON：{"ok":true或false,"reason":"不符时的具体原因（40字内）；相符则空字符串"}';
    const user = baselineUrl
      ? `任务「${task.title}」。第一张是用户提供的参考图（${baselineName}），第二张是 AI 生成的配图。请判断第二张与第一张是否为同一主体。`
      : `任务「${task.title}」。文案描述：${descText}。请判断图中内容与文案是否相符。`;
    // 视觉渠道偶发抖动（实测首图连续 2 次 fetch failed 后第 3 次成功）→ 与生图同口径自动重试，
    // 避免抖动被误记为「跳过」。只重试网络/渠道类失败；模型返回内容但解析不出 JSON 属确定性结果，不重试。
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_NOTE_IMAGE_ATTEMPTS; attempt++) {
      try {
        const { content: text } = await callLlm({ agentId, system, user, images, temperature: 0.2, maxTokens: 200 });
        const parsed = extractJson<{ ok?: unknown; reason?: string }>(text);
        return { ok: parsed?.ok === true || parsed?.ok === 'true', reason: String(parsed?.reason ?? '') };
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_NOTE_IMAGE_ATTEMPTS) {
          console.warn(
            `[xhs-producer] 视觉审核第 ${attempt} 次失败（${task.stage}）: ${err instanceof Error ? err.message : err}，${1500 * attempt}ms 后重试`,
          );
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }
    throw lastErr;
  }
}

export const xhsProducer = new XhsProducer();
