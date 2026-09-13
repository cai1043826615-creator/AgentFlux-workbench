/**
 * 知识库小助理「依依」执行链（P2·F3）。
 *
 * 设计（design.md 决策 3）：走既有 Agent 执行基建——callLlm 调用 + logExecution 记录
 * （agent_id = agent-assistant，Agent 状态页统计自动工作），产出一律写入草稿区（drafts.ts）。
 *
 * 铁律：对 Vault 严格只读。本文件的全部数据来源是知识库索引表（knowledge_docs 等，只读查询）
 * 与热点缓存，绝不触碰 Vault 文件系统。
 *
 * 三个能力（kb-assistant spec「三个整理能力」）：
 *   doc   提交文档 → 结构化 md（保留关键事实与来源路径）
 *   hot   每日热点素材 → 灵感库方向选题素材卡
 *   audit 知识库体检 → 整理建议清单（重复主题 / 缺失标签 / 可互链孤岛），不自动改文档
 */
import { all, get } from '../db/client.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';
import { createDraft } from './drafts.ts';
import { callLlm, LlmChannelUnavailableError } from '../agents/llm.ts';
import { logExecution } from '../agents/execution-logger.ts';
import { islandDocPaths } from './health.ts';

export type AssistantKind = 'doc' | 'hot' | 'audit';

export interface AssistantRequest {
  kind: AssistantKind;
  /** doc：知识库文档相对路径；hot：留空（条目由 item 传入）；audit：留空 */
  ref?: string;
  /** hot：前端从热点面板拿到的完整条目（避免后端反序列化热点缓存实现细节） */
  item?: { id?: string; title?: string; summary?: string; sourceName?: string; source?: string; url?: string };
  /** 用户的补充要求（可选） */
  note?: string;
}

const ASSISTANT_ID = 'agent-assistant';

/** 知识库文档行（只取需要的列） */
interface DocLite {
  path: string;
  title: string;
  tags: string;
  body: string;
}

function loadDoc(path: string): DocLite | null {
  return get<DocLite>(`SELECT path, title, tags, body FROM ${KT.docs} WHERE path = ?`, [path]) ?? null;
}

/** 热点素材：直接用前端传入的条目（热点缓存的 payload 结构是实现细节，不在此反序列化） */
function loadHotItem(item: AssistantRequest['item']): { id: string; title: string; summary: string; source: string } | null {
  if (!item || !item.title) return null;
  return {
    id: item.id ?? '',
    title: item.title,
    summary: item.summary ?? '',
    source: item.sourceName ?? item.source ?? '未知来源',
  };
}

/** 孤岛文档（体检用，与 health.ts 同一口径） */
function loadIslands(): { path: string; title: string }[] {
  const islands = new Set(islandDocPaths());
  if (islands.size === 0) return [];
  return all<{ path: string; title: string }>(`SELECT path, title FROM ${KT.docs}`)
    .filter((d) => islands.has(d.path));
}

/** 全部文档的标题与标签（体检用：重复主题 / 缺失标签） */
function loadDocIndex(): { path: string; title: string; tags: string[] }[] {
  return all<{ path: string; title: string; tags: string }>(`SELECT path, title, tags FROM ${KT.docs}`).map((d) => {
    let tags: string[] = [];
    try {
      const parsed = JSON.parse(d.tags) as unknown;
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      /* 容错为空 */
    }
    return { path: d.path, title: d.title, tags };
  });
}

/** 组装各能力的用户提示词（数据在提示词里给全，LLM 不需要任何外部访问） */
function buildUserPrompt(kind: AssistantKind, req: AssistantRequest): { user: string; sourceRef: string; fallbackTitle: string } | null {
  if (kind === 'doc') {
    const doc = req.ref ? loadDoc(req.ref) : null;
    if (!doc) return null;
    const user = [
      '请把以下产品资料整理成结构化 Markdown（保留关键事实、参数与来源，不要编造资料中不存在的信息）：',
      `来源路径：${doc.path}`,
      `标题：${doc.title}`,
      '--- 原文开始 ---',
      doc.body.slice(0, 6000),
      '--- 原文结束 ---',
      req.note ? `用户补充要求：${req.note}` : '',
    ].filter(Boolean).join('\n');
    return { user, sourceRef: doc.path, fallbackTitle: `${doc.title} · 整理` };
  }
  if (kind === 'hot') {
    const item = loadHotItem(req.item);
    if (!item) return null;
    const user = [
      '请把以下每日热点素材整理成一张「灵感库选题素材卡」（Markdown：选题角度 / 可借用的内容要点 / 适配的品类或场景 / 来源），不要编造素材中不存在的数据：',
      `素材标题：${item.title}`,
      `来源：${item.source}`,
      `摘要：${item.summary.slice(0, 2000)}`,
      req.note ? `用户补充要求：${req.note}` : '',
    ].filter(Boolean).join('\n');
    return { user, sourceRef: item.id, fallbackTitle: `${item.title} · 素材卡` };
  }
  if (kind === 'audit') {
    const docs = loadDocIndex();
    const islands = loadIslands();
    const user = [
      '请对以下知识库文档清单做一次体检，产出「整理建议」清单（Markdown），只给建议、不要改写任何文档。重点：',
      '① 疑似重复/高度相近的主题；② 完全没有标签的文档及建议补充的标签；③ 可通过 [[wiki链接]] 互相引用的孤立文档配对建议。',
      `文档清单（path | title | tags）：`,
      ...docs.map((d) => `- ${d.path} | ${d.title} | ${d.tags.join('、') || '（无标签）'}`),
      islands.length > 0 ? `当前孤岛文档：${islands.map((d) => d.path).join('、')}` : '当前无孤岛文档。',
    ].join('\n');
    return { user, sourceRef: '', fallbackTitle: '知识库体检 · 整理建议' };
  }
  return null;
}

/** LLM 输出的轻结构化：提取首个「# 标题」作为草稿标题（没有就回退 fallbackTitle） */
function pickTitle(output: string, fallback: string): string {
  const m = output.match(/^\s*#\s+(.+)$/m);
  const t = (m?.[1] ?? '').trim();
  return t ? t.slice(0, 60) : fallback;
}

/** 保守清洗：剥掉常见围栏包裹，正文保持 LLM 原文语义 */
function cleanContent(output: string): string {
  const fence = output.match(/^\s*```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/);
  return (fence ? fence[1] : output).trim();
}

/**
 * 执行一次小助理整理。全程不触碰 Vault；失败不抛给调用方（返回 ok:false + 中文原因），
 * 执行记录写 agent_executions（Agent 状态页统计自动工作）。
 */
export async function runAssistant(req: AssistantRequest): Promise<
  | { ok: true; draftId: number; title: string; structured: boolean }
  | { ok: false; error: string }
> {
  ensureKnowledgeSchema();
  const started = Date.now();
  const assistant = get<{ id: string; name: string; model: string }>('SELECT id, name, model FROM agents WHERE id = ?', [ASSISTANT_ID]);
  if (!assistant) return { ok: false, error: '小助理实体不存在（seed 未初始化）' };

  const prompt = buildUserPrompt(req.kind, req);
  if (!prompt) {
    return { ok: false, error: req.kind === 'doc' ? '未找到指定的知识库文档' : req.kind === 'hot' ? '未找到指定的热点素材' : '体检请求不合法' };
  }

  const system = [
    `你是${assistant.name}（知识库整理助理）。你的产出只会被保存为草稿，供用户预览后自行处理。`,
    '要求：输出结构化 Markdown；严格基于给定的资料，不编造不存在的事实与数据；涉及来源时保留原路径或来源名。',
    '你只有只读权限：即使用户要求，也不要表示会修改任何 Vault 文件。',
  ].join('\n');

  let output = '';
  let failed: string | null = null;
  try {
    const result = await callLlm({ agentId: ASSISTANT_ID, system, user: prompt.user });
    output = result.content.trim();
  } catch (err) {
    failed = err instanceof Error ? err.message : String(err);
    if (!(err instanceof LlmChannelUnavailableError)) {
      console.warn(`[kb-assistant] LLM 调用失败: ${failed}`);
    }
  }

  const durationMs = Date.now() - started;

  // LLM 失败 → 记 failed 执行，返回中文原因（不产生空草稿）
  if (!output) {
    logExecution({
      agentId: ASSISTANT_ID,
      taskId: null,
      stage: null,
      model: assistant.model,
      status: 'failed',
      inputSummary: `[${req.kind}] ${req.ref ?? '体检'}`,
      outputSummary: '',
      error: failed ?? 'LLM 无返回',
      durationMs,
    });
    return { ok: false, error: `依依暂时无法完成整理（${failed ?? '模型无返回'}），请稍后重试` };
  }

  // 输出解析保守处理：结构化失败不丢内容——整篇存为 raw 草稿
  const looksStructured = /^#\s+/m.test(output) || output.length > 80;
  const draft = createDraft({
    title: pickTitle(output, prompt.fallbackTitle),
    sourceKind: looksStructured ? req.kind : 'raw',
    sourceRef: prompt.sourceRef,
    agentId: ASSISTANT_ID,
    structured: looksStructured,
    content: cleanContent(output),
  });

  logExecution({
    agentId: ASSISTANT_ID,
    taskId: null,
    stage: null,
    model: assistant.model,
    status: 'success',
    inputSummary: `[${req.kind}] ${req.ref || '体检'}`,
    outputSummary: draft.title,
    durationMs,
  });

  return { ok: true, draftId: draft.id, title: draft.title, structured: draft.structured };
}
