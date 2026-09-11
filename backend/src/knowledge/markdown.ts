/**
 * Markdown 解析（纯函数，无 IO，便于单测）：
 * - frontmatter（title/tags）
 * - 标题层级锚点（坑4：片段粒度 = 标题到下一同级标题）
 * - 链接提取（[[wiki链接]] / 相对路径链接）→ 知识星图边
 * - 命中片段截取（搜索结果展示）
 */
import { normalizeRel } from './vault.ts';

export interface Frontmatter {
  /** frontmatter 解析出的原始键值（值统一为字符串或字符串数组） */
  data: Record<string, string | string[]>;
  /** frontmatter 之后的正文 */
  body: string;
}

/** 解析 YAML 风格 frontmatter（仅支持扁平键值 + 行内数组 + 短横线列表，够用且零依赖） */
export function parseFrontmatter(raw: string): Frontmatter {
  const text = String(raw ?? '').replace(/^\uFEFF/, '');
  if (!text.startsWith('---')) return { data: {}, body: text };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { data: {}, body: text };

  const data: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  for (const line of match[1].split(/\r?\n/)) {
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const prev = data[currentKey];
      const arr = Array.isArray(prev) ? prev : prev ? [prev] : [];
      arr.push(unquote(listItem[1].trim()));
      data[currentKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z0-9_\-\u4e00-\u9fa5]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    currentKey = kv[1].trim();
    const value = kv[2].trim();
    if (value === '') {
      data[currentKey] = [];
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      data[currentKey] = value
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      continue;
    }
    data[currentKey] = unquote(value);
  }
  return { data, body: text.slice(match[0].length) };
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

/** 提取标签：frontmatter tags（数组/逗号/空格分隔）+ 正文 #tag（排除 # 标题行） */
export function extractTags(fm: Frontmatter): string[] {
  const tags = new Set<string>();
  const rawTags = fm.data.tags ?? fm.data.tag;
  const push = (v: string) => {
    const t = v.replace(/^#/, '').trim();
    // 排除形如色值/纯十六进制的伪标签（如品牌规范里的 #7C3AED）
    if (!t || /^[0-9A-Fa-f]{3,8}$/.test(t)) return;
    tags.add(t);
  };
  if (Array.isArray(rawTags)) rawTags.forEach(push);
  else if (typeof rawTags === 'string') rawTags.split(/[,，\s]+/).forEach(push);

  for (const line of fm.body.split(/\r?\n/)) {
    if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // 标题行不算标签
    // 行内标签字符集：中日韩文字 + 字母数字 + - _ /（Obsidian 标签允许的字符）；
    // 显式排除中文标点，避免把「#7C3AED，文案语气…」整段吞成标签
    const re = /(^|\s)#([\u4e00-\u9fa5A-Za-z0-9_][\u4e00-\u9fa5A-Za-z0-9_\-/]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) push(m[2]);
  }
  return [...tags].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 文档标题：frontmatter title > 首个 H1 > 文件名 */
export function extractTitle(fm: Frontmatter, relPath: string): string {
  const fmTitle = fm.data.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  if (Array.isArray(fmTitle) && fmTitle[0]) return String(fmTitle[0]).trim();
  const h1 = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(fm.body);
  if (h1) return h1[1].trim();
  const name = normalizeRel(relPath).split('/').pop() ?? relPath;
  return name.replace(/\.md$/i, '');
}

/** 章节锚点（含行范围，供片段截取） */
export interface MarkdownSection {
  /** 锚点标识：标题层级路径，如「产品规格 / 电池」 */
  anchor: string;
  level: number;
  title: string;
  /** 标题行索引（0-based，基于正文 body 的行号） */
  startLine: number;
  /** 本章节结束行索引（不含；下一个同级或更高级标题之前） */
  endLine: number;
}

/**
 * 按标题层级解析章节锚点：
 * 章节范围 = 该标题行 → 下一个层级 ≤ 自身的标题行（或文末），与 design.md D6 一致。
 */
export function parseSections(body: string): MarkdownSection[] {
  const lines = String(body ?? '').split(/\r?\n/);
  interface Head {
    level: number;
    title: string;
    line: number;
  }
  const heads: Head[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    heads.push({ level: m[1].length, title: m[2].trim(), line: i });
  }
  const out: MarkdownSection[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    // 层级路径：向上找最近的低层级标题链
    const stack: Head[] = [];
    for (let j = i - 1; j >= 0; j--) {
      if (heads[j].level < h.level && !stack.some((s) => s.level <= heads[j].level)) stack.unshift(heads[j]);
      if (heads[j].level === 1) break;
    }
    // 结束行：下一个 level <= 自身的标题
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].line;
        break;
      }
    }
    out.push({
      anchor: [...stack.map((s) => s.title), h.title].join(' / '),
      level: h.level,
      title: h.title,
      startLine: h.line,
      endLine: end,
    });
  }
  return out;
}

/** 按锚点截取片段正文；锚点不存在返回 null（调用方降级为整篇注入并标记） */
export function sliceSection(body: string, anchor: string): { content: string; section: MarkdownSection } | null {
  const sections = parseSections(body);
  const found = sections.find((s) => s.anchor === anchor) ?? sections.find((s) => s.title === anchor);
  if (!found) return null;
  const lines = String(body ?? '').split(/\r?\n/);
  return { content: lines.slice(found.startLine, found.endLine).join('\n').trim(), section: found };
}

/** 提取的链接 */
export interface ExtractedLink {
  /** 原始目标文本 */
  raw: string;
  /** wiki = [[...]]；md = [text](path) */
  kind: 'wiki' | 'md';
}

/** 提取正文中的 wiki 链接与 Markdown 相对路径链接（忽略 http(s) 外链与锚点） */
export function extractLinks(body: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();
  const push = (raw: string, kind: ExtractedLink['kind']) => {
    const key = `${kind}:${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ raw, kind });
  };

  const wikiRe = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = wikiRe.exec(body)) !== null) push(m[1].trim(), 'wiki');

  const mdRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = mdRe.exec(body)) !== null) {
    const target = m[1].trim();
    if (/^(https?:|mailto:|data:|#)/i.test(target)) continue;
    if (!/\.md$/i.test(target.split('#')[0])) continue;
    push(target, 'md');
  }
  return out;
}

/**
 * 把链接目标解析为索引内文档相对路径；无法对应到已索引文档时返回 null。
 * 依次尝试：同目录相对路径 → 根相对路径 → 全库 basename 唯一匹配（Obsidian 习惯）。
 */
export function resolveLinkTarget(link: ExtractedLink, sourcePath: string, indexed: Set<string>): string | null {
  const clean = normalizeRel(link.raw.split('#')[0].replace(/^<|>$/g, ''));
  if (!clean) return null;
  const withMd = /\.md$/i.test(clean) ? clean : `${clean}.md`;
  const sourceDir = normalizeRel(sourcePath).includes('/') ? normalizeRel(sourcePath).slice(0, normalizeRel(sourcePath).lastIndexOf('/')) : '';

  const candidates: string[] = [];
  if (sourceDir) candidates.push(normalizeRel(`${sourceDir}/${withMd}`));
  candidates.push(withMd);

  for (const c of candidates) {
    if (indexed.has(c)) return c;
  }

  // basename 唯一匹配（Obsidian [[Note]] 全库寻址）
  const base = withMd.split('/').pop() ?? withMd;
  const matches = [...indexed].filter((p) => p.split('/').pop() === base);
  return matches.length === 1 ? matches[0] : null;
}

/** 生成命中片段：围绕首个命中词前后截取上下文 */
export function makeSnippet(body: string, query: string, radius = 60): string {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim();
  const q = String(query ?? '').trim();
  if (!q) return text.slice(0, radius * 2);
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + q.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}
