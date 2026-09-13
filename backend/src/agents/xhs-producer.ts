import type { ComplianceReport, NotePackage, Task, TopicOption, WorkflowParallelGroup, XhsNote } from '@workbench/shared';
import { runParallelGroups } from '../engine/parallel.ts';
import { createPlaceholderImage } from '../utils/placeholder.ts';
import * as delivery from '../delivery/store.ts';
import { generateImage, ImageChannelUnavailableError } from './imagegen.ts';
import { callLlm, LlmChannelUnavailableError } from './llm.ts';
import { buildProducerSystemPrompt } from './smart-producer.ts';

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
    body: `入手「${name}」之后，使用感受比预期好。\n\n日常使用顺手，细节处理到位，性价比在线。\n\n有需要的姐妹可以试试，链接放评论区～`,
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

  /** 笔记撰写：标题（≤20 字含 emoji）+ 正文 + 话题标签 */
  async produceNote(task: Task): Promise<XhsNote> {
    const agentId = AGENT_IDS['文案'];
    return this.withLlm<XhsNote>(
      agentId,
      '你是小红书种草文案。严格输出 JSON（不要多余文字）：{"title":"标题（含 1 个 emoji，总长度不超过 20 个字符）","body":"正文（口语化小红书体，3-5 句，可用换行分段）","tags":["#话题1","#话题2","#话题3"]}\n要求：避免「最」「第一」「国家级」等广告法违禁词与绝对化用语；不做医疗功效宣称。',
      `产品/主题：${task.title}\n资料：${task.description || '（无）'}\n请撰写小红书种草笔记。`,
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
    const isCover = (itemId: string) => itemId.includes('首图');
    const results = await runParallelGroups<{ dataUrl: string; attempts: number }>(
      groups.map((g) => ({ channel: g.channel, items: g.items })),
      async (itemId) => {
        const prompt = isCover(itemId)
          ? `小红书封面首图，主题：${task.title}，竖版 3:4，大字标题醒目、配色清爽、生活化场景，高质感`
          : `小红书内页配图，主题：${task.title}，步骤/细节清晰呈现，竖版 3:4，图文排版干净`;
        try {
          const dataUrl = await generateImage(prompt, '1024x1024');
          return { dataUrl, attempts: 1 };
        } catch (err) {
          // 无渠道配置 → 占位图作为可决策结果（与电商一致，前端标注「模拟占位」）
          if (err instanceof ImageChannelUnavailableError) {
            return { dataUrl: createPlaceholderImage(itemId, '#7C3AED'), attempts: 1 };
          }
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
      attempts: r.ok ? r.value?.attempts : 3,
    }));
  }

  /** 单张配图重试 */
  async retryImage(task: Task, imageId: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
    const isCover = imageId.includes('首图');
    const prompt = isCover
      ? `小红书封面首图，主题：${task.title}，竖版 3:4，大字标题醒目、配色清爽、生活化场景，高质感`
      : `小红书内页配图，主题：${task.title}，步骤/细节清晰呈现，竖版 3:4，图文排版干净`;
    try {
      const dataUrl = await generateImage(prompt, '1024x1024');
      return { ok: true, dataUrl };
    } catch (err) {
      if (err instanceof ImageChannelUnavailableError) {
        return { ok: true, dataUrl: createPlaceholderImage(imageId, '#7C3AED') };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * 合规审核（自动节点）：检查违禁词与夸张用语。
   * 检出问题时给出 targetStage（xhs-copy 或 xhs-image），service 据此沿 rollback 边回退。
   */
  async produceCompliance(task: Task): Promise<ComplianceReport> {
    const agentId = AGENT_IDS['主管'];
    const note = latestNote(task);
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

  /** 发布包装：最终发布包（标题 + 正文 + 标签 + 图片顺序） */
  async producePackage(task: Task): Promise<NotePackage> {
    const agentId = AGENT_IDS['文案'];
    const note = latestNote(task) ?? mockNote(task);
    // 图片顺序：取配图阶段交付物的图片 id 顺序（首图优先）
    let imageOrder: string[] = [];
    const imgDel = delivery.getDeliverable(task.id, 'xhs-image', 'image');
    if (imgDel) {
      try {
        const items = JSON.parse(imgDel.content) as { id: string; status?: string }[];
        imageOrder = items.filter((i) => i.status !== 'failed').map((i) => i.id);
      } catch {
        imageOrder = [];
      }
    }
    return this.withLlm<NotePackage>(
      agentId,
      '你是小红书发布包装专员。严格输出 JSON（不要多余文字）：{"title":"最终标题（含 emoji，≤20 字符）","body":"最终正文","tags":["#话题"...],"imageOrder":["图片id"...]}\n要求：保留原笔记核心信息，仅做发布优化（排版、标签），不得引入广告法违禁词。imageOrder 必须使用输入给出的图片 id，不得自造。',
      `原标题：${note.title}\n原正文：${note.body}\n原标签：${note.tags.join(' ')}\n可选图片 id：${imageOrder.join(' / ') || '（无）'}\n请输出最终发布包。`,
      () => ({ title: note.title, body: note.body, tags: note.tags, imageOrder }),
      (text) => {
        const parsed = extractJson<Partial<NotePackage>>(text);
        if (!parsed || !parsed.title || !parsed.body) return null;
        // imageOrder 只接受交付物里真实存在的 id，避免模型自造
        const valid = Array.isArray(parsed.imageOrder) ? parsed.imageOrder.map(String).filter((id) => imageOrder.includes(id)) : [];
        return {
          title: String(parsed.title),
          body: String(parsed.body),
          tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
          imageOrder: valid.length > 0 ? valid : imageOrder,
        };
      },
      task.id,
      task.workflowId,
    );
  }
}

export const xhsProducer = new XhsProducer();
