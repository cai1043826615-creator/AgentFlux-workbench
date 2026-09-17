/**
 * 小助理 RAG 轻量检索层（FTS5 版，零新增依赖）。
 *
 * 定位（用户定案）：RAG 只挂在小助理「依依」的对话场景，不做工作流/单任务级；
 * 本轮为轻量版——检索层复用既有 knowledge/search.ts 的 FTS5 trigram + LIKE 兜底，
 * 不引入向量库与 embedding 模型（无 key 且用户要「简单」）；向量版作为后续增强。
 *
 * 职责：把「用户问题」变成「知识库全库文档中的相关段落」：
 *   ① 调 searchDocs 拿候选文档（全库范围，不局限于挂载文件）；
 *   ② 取每篇文档正文，按标题章节切分，选出命中查询词最多的一个章节（段落级，不整篇塞入）；
 *   ③ 按「片段数 + 单片段字符 + 总字符」三重上限裁剪，避免 prompt 爆炸；
 *   ④ 组装成可注入 prompt 的「知识库参考资料」文本块。
 *
 * 降级原则（任何一环不满足就返回空块，调用方行为与未接 RAG 完全一致）：
 *   - 知识库未连接（Vault 未配置/不可读）
 *   - 索引为空、检索无命中、或片段全部 0 分
 *   - 读取正文抛异常（Vault 文件被删等）
 * 本模块不抛错给上层：retrieveKnowledge 内部全 try/catch。
 */
import { get } from '../db/client.ts';
import { knowledgeStatus, readDoc } from './docs.ts';
import { parseFrontmatter, parseSections } from './markdown.ts';
import { searchDocs } from './search.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';

/** 单条检索片段 */
export interface RagChunk {
  /** 文档相对路径（引用来源用） */
  path: string;
  /** 文档标题 */
  title: string;
  /** 命中的章节锚点（如「品牌视觉规范 / 一、配色」）；无标题文档为 undefined */
  anchor?: string;
  /** 片段正文（已按长度上限裁剪） */
  content: string;
}

/** 检索结果：片段列表 + 可直接注入 prompt 的参考资料块 */
export interface RagResult {
  chunks: RagChunk[];
  /** 注入 prompt 的文本块；无命中时为 ''（调用方据此跳过注入） */
  promptBlock: string;
  /** 未注入的原因（降级说明，供日志/排查） */
  reason?: string;
}

/** 检索参数（均可按需覆盖，默认值为轻量版定档） */
export interface RagOptions {
  /** 候选文档数与最终片段数上限（默认 5） */
  maxChunks?: number;
  /** 单个片段字符上限（默认 900） */
  maxChunkChars?: number;
  /** 全部片段总字符上限（默认 3500） */
  maxTotalChars?: number;
}

const DEFAULT_MAX_CHUNKS = 5;
const DEFAULT_MAX_CHUNK_CHARS = 900;
const DEFAULT_MAX_TOTAL_CHARS = 3_500;

/** 子词召回的取样上限（放大以保证 DF 稀释拿到真实命中面） */
const CANDIDATE_SAMPLE = 50;

/** 无标题文档回退：围绕命中位置取的行窗口半径（行） */
const WINDOW_RADIUS = 12;

/** 一篇文档的正文（Vault 实时优先，取不到回退索引内正文） */
interface DocContent {
  path: string;
  title: string;
  content: string;
}

/**
 * 取文档正文：优先 Vault 实时原文（与 Obsidian 中一致），
 * Vault 不可读/文件缺失时回退索引内 body（索引是本地副本，仍可检索引用）。
 */
async function loadContent(path: string, fallbackTitle: string): Promise<DocContent | null> {
  const doc = await readDoc(path).catch(() => null);
  if (doc) return { path: doc.path, title: doc.title || fallbackTitle, content: doc.content || '' };
  const row = get<{ path: string; title: string; body: string }>(`SELECT path, title, body FROM ${KT.docs} WHERE path = ?`, [path]);
  if (!row) return null;
  return { path: row.path, title: row.title || fallbackTitle, content: parseFrontmatter(row.body).body };
}

/**
 * 候选文档召回：整句先按原样检索，无命中再退化为「子词」逐条检索合并。
 * 原因（实测）：用户问的是整句（「视觉规范里关于配色的要求」），而 searchDocs 按空格分词——
 * 整句作为一个词必然 0 命中；中文又无空格，必须自行切 2-gram 子词召回。
 * 子词数量设上限，避免超长问题触发过多检索。
 */
async function recallCandidates(q: string, limit: number): Promise<{ path: string; votes: number }[]> {
  const direct = searchDocs(q, limit).hits.map((h) => ({ path: h.path, votes: Number.MAX_SAFE_INTEGER }));
  if (direct.length > 0) return direct;

  // 子词按「累计票数」排序，不按召回先后。票数 = Σ(子词长度² / 该词全库命中文档数)。
  // 取样上限放大（CANDIDATE_SAMPLE）是必需的：DF 稀释依赖真实命中面，
  // 若沿用 maxChunks=5 的小上限，泛词与精确词的命中数都被截断为 5，稀释失效。
  const votes = new Map<string, number>();
  for (const t of subTermsOf(q)) {
    const paths = searchDocs(t, CANDIDATE_SAMPLE).hits.map((h) => h.path);
    if (paths.length === 0) continue;
    const weight = ([...t].length ** 2) / paths.length;
    for (const p of paths) votes.set(p, (votes.get(p) ?? 0) + weight);
  }
  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 4)
    .map(([path, v]) => ({ path, votes: v }));
}

/**
 * 子词生成：空格分词 + 中文 2-gram（长串再补 3-gram）。
 * 2-gram 覆盖「配色」这类关键短词（走 searchDocs 的 LIKE 兜底），3-gram 帮助 FTS 命中。
 */
function subTermsOf(query: string): string[] {
  const parts = String(query ?? '').split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) out.push(p);
  for (const p of parts) {
    const chars = [...p];
    for (let i = 0; i + 2 <= chars.length; i++) out.push(chars.slice(i, i + 2).join(''));
    for (let i = 0; i + 3 <= chars.length; i++) out.push(chars.slice(i, i + 3).join(''));
  }
  return [...new Set(out)].filter((t) => [...t].length >= 2).slice(0, 24);
}

/**
 * 查询词切分（用于片段打分）：空格分词 + 中文 2-gram 补充。
 * 中文问题常是整句，不做 2-gram 切分就定位不到「配色」这类短词所在章节。
 */
function termsOf(query: string): string[] {
  const parts = String(query ?? '').split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    out.push(p);
    const chars = [...p];
    if (chars.length >= 2) {
      for (let i = 0; i + 2 <= chars.length; i++) out.push(chars.slice(i, i + 2).join(''));
    }
  }
  return [...new Set(out)].filter((t) => [...t].length >= 2);
}

/** 文本对查询词的命中得分：命中次数 × 词长（长词权重更高） */
function scoreOf(text: string, terms: string[]): number {
  if (!text) return 0;
  let score = 0;
  for (const t of terms) {
    let idx = text.indexOf(t);
    let count = 0;
    while (idx >= 0) {
      count++;
      idx = text.indexOf(t, idx + t.length);
    }
    if (count > 0) score += count * [...t].length;
  }
  return score;
}

/** 候选块（章节或行窗口） */
interface Block {
  text: string;
  anchor?: string;
  score: number;
  /** 章节层级（1-6）；行窗口回退为 0 —— 排序时按「最深层优先」避免选中 H1 整篇 */
  level: number;
}

/** 把一篇文档切成候选块：有标题按章节，无标题按命中位置取行窗口 */
function blocksOf(content: string, terms: string[]): Block[] {
  const lines = content.split(/\r?\n/);
  const sections = parseSections(content);
  if (sections.length > 0) {
    const blocks: Block[] = [];
    for (const s of sections) {
      const text = lines.slice(s.startLine, s.endLine).join('\n').trim();
      if (!text) continue;
      // 排序键 = 命中密度 + 标题命中 + 层级×100。
      // 层级权重大是必需的：H1 章节正文含全部子章节，命中词天然不比 H2 少，
      // 只有「越深的层级越优先」才能选中「一、配色」而不是整篇 H1 大章。
      const density = (scoreOf(text, terms) / Math.max(1, text.length)) * 100;
      const score = s.level * 100 + density + scoreOf(s.title, terms) * 3;
      blocks.push({ text, anchor: s.anchor, score, level: s.level });
    }
    if (blocks.length > 0) return blocks;
  }
  // 无标题文档：围绕首个命中词取一个行窗口（避免注入整篇）
  const hitLine = lines.findIndex((l) => scoreOf(l, terms) > 0);
  const center = hitLine >= 0 ? hitLine : 0;
  const text = lines.slice(Math.max(0, center - WINDOW_RADIUS), center + WINDOW_RADIUS + 1).join('\n').trim();
  return text ? [{ text, score: scoreOf(text, terms), level: 0 }] : [];
}

/** 从一篇文档中挑出最佳片段（每篇只取 1 段，避免单篇霸占预算）；0 分返回 null */
function bestChunkOf(doc: DocContent, terms: string[], maxChars: number): RagChunk | null {
  const blocks = blocksOf(doc.content, terms);
  const best = blocks.filter((b) => b.score > 0).sort((a, b) => b.score - a.score)[0];
  if (!best) return null;
  const text = best.text;
  const content = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  return { path: doc.path, title: doc.title, anchor: best.anchor, content };
}

/** 组装注入 prompt 的参考资料块（带编号、来源路径与引用要求） */
function buildPromptBlock(chunks: RagChunk[]): string {
  if (chunks.length === 0) return '';
  const head = '【知识库参考资料】以下段落来自知识库全库检索，可能与用户问题相关：';
  const body = chunks
    .map((c, i) => `[${i + 1}] 来源：${c.path}${c.title ? `（${c.title}）` : ''}${c.anchor ? ` · 章节：${c.anchor}` : ''}\n${c.content}`)
    .join('\n\n');
  const tail = '【使用要求】优先依据上述资料回答，并在引用到的结论后标注来源文档路径；资料未覆盖的内容不要编造，可说明「知识库中未找到」。';
  return `${head}\n\n${body}\n\n${tail}`;
}

/**
 * 按用户问题检索知识库相关段落（小助理 RAG 入口）。
 * 返回的 promptBlock 可直接拼进 system prompt；无命中时为 ''（调用方跳过注入即可）。
 */
export async function retrieveKnowledge(query: string, options: RagOptions = {}): Promise<RagResult> {
  const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);
  const maxChunkChars = Math.max(100, options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS);
  const maxTotalChars = Math.max(200, options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS);

  try {
    ensureKnowledgeSchema();

    // 降级①：知识库未连接 → 不注入（行为与未接 RAG 一致）
    if (knowledgeStatus().state !== 'connected') {
      return { chunks: [], promptBlock: '', reason: '知识库未连接' };
    }
    // 降级②：空问题
    const q = String(query ?? '').trim();
    if (!q) return { chunks: [], promptBlock: '', reason: '问题为空' };

    const candidates = await recallCandidates(q, maxChunks);
    if (candidates.length === 0) {
      return { chunks: [], promptBlock: '', reason: `全库未命中「${q}」` };
    }

    const terms = termsOf(q);
    // 每篇候选取最佳段落；候选顺序由召回票数决定，片段分只在同票数内作次序，
    // 不再把两者相加——相加会让「收件箱长文档」的高命中分盖过票数，又把排序打回泛词优先。
    const scored: { chunk: RagChunk; votes: number; score: number }[] = [];
    for (const { path, votes } of candidates) {
      const doc = await loadContent(path, '');
      if (!doc) continue;
      const chunk = bestChunkOf(doc, terms, maxChunkChars);
      if (!chunk) continue;
      scored.push({ chunk, votes, score: scoreOf(chunk.content, terms) });
    }
    scored.sort((a, b) => b.votes - a.votes || b.score - a.score);

    const chunks: RagChunk[] = [];
    let total = 0;
    for (const { chunk } of scored) {
      if (chunks.length >= maxChunks) break;
      // 总长上限：剩余额度不足则裁剪本条后停止（保证总量不爆）
      const remain = maxTotalChars - total;
      if (remain <= 0) break;
      if (chunk.content.length > remain) {
        chunks.push({ ...chunk, content: `${chunk.content.slice(0, remain)}…` });
        total = maxTotalChars;
        break;
      }
      chunks.push(chunk);
      total += chunk.content.length;
    }

    if (chunks.length === 0) {
      return { chunks: [], promptBlock: '', reason: '命中文档但正文无相关段落' };
    }
    return { chunks, promptBlock: buildPromptBlock(chunks) };
  } catch (err) {
    // 降级③：任何异常都不抛给对话链路
    return { chunks: [], promptBlock: '', reason: `检索异常：${err instanceof Error ? err.message : String(err)}` };
  }
}
