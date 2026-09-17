/**
 * 知识库文档导入（上传 pdf / docx / doc / txt / md → 解析为 Markdown → 落盘 Vault → 重建索引）。
 *
 * 边界说明：
 * - Vault 的「只读承诺」针对的是**不擅自改动用户既有文件**；导入是用户显式动作，
 *   只**新增**文件到收件箱目录（绝不覆盖/删除/移动既有文件），不违背只读语义。
 * - 落盘目录复用既有常量 UPLOAD_DIR_REL（'知识库/收件箱'，见 agents/skills.ts），
 *   保证与应用内既有上传落点一致，且天然在 Vault 索引范围内。
 * - .doc（二进制老格式）mammoth 不支持，明确返回中文错误，不静默产出空笔记。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { KnowledgeImportExt, KnowledgeImportResult } from '@workbench/shared';
import { KB_IMPORT_MAX_BYTES } from '@workbench/shared';
import { UPLOAD_DIR_REL } from '../agents/skills.ts';
import { rebuildIndexInBackground } from './indexer.ts';
import { resolveVaultConfig, vaultAbsPath } from './vault.ts';

/** 类型白名单（小写扩展名 → 解析方式） */
const EXT_KIND: Record<string, 'pdf' | 'docx' | 'text'> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'docx',
  '.txt': 'text',
  '.md': 'text',
};

/** 导入失败（面向用户的中文原因，路由层一律 400 返回） */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * 文件名安全化：去掉目录分隔符与路径穿越段、控制字符与 Windows 保留字符，
 * 长度上限 80（保留扩展名）。空结果回退 '未命名'。
 */
export function safeFileName(raw: string): string {
  const ext = extname(raw ?? '').toLowerCase();
  const base = String(raw ?? '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\\/]/g, '_')
    .replace(/[<>:*"|?\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  const stem = (extname(base) ? base.slice(0, -extname(base).length) : base).trim();
  const cleaned = (stem || '未命名').slice(0, 80).trim();
  return `${cleaned}${ext}`;
}

/** 目标文件已存在时加序号后缀（-2、-3…），保证只新增、不覆盖 */
async function uniqueRelPath(root: string, dirRel: string, fileName: string): Promise<string> {
  const { existsSync } = await import('node:fs');
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let i = 1; i < 500; i++) {
    const name = i === 1 ? fileName : `${stem}-${i}${ext}`;
    const rel = `${dirRel}/${name}`;
    if (!existsSync(vaultAbsPath(root, rel))) return rel;
  }
  throw new ImportError('同目录下同名文件过多，请清理收件箱后重试');
}

/**
 * 包装为带 frontmatter 的 Markdown（来源/时间/类型）。
 * 只在正文首行不是 H1 时补一个 H1——pdf/docx 解析出的纯文本没有标题结构，需要它；
 * md/txt 原文往往自带 H1，再补一次会重复（实测暴露，已修）。
 */
function buildMarkdown(opts: {
  title: string;
  sourceName: string;
  sourceType: 'pdf' | 'docx' | 'text';
  body: string;
  extraFrontmatter?: string[];
}): string {
  const now = new Date().toISOString();
  const fm = [
    '---',
    `title: ${opts.title.replace(/\r?\n/g, ' ').trim()}`,
    'tags: [收件箱, 导入]',
    `来源: ${opts.sourceName.replace(/\r?\n/g, ' ').trim()}`,
    `类型: ${opts.sourceType}`,
    `导入时间: ${now}`,
    ...(opts.extraFrontmatter ?? []),
    '---',
    '',
  ].join('\n');
  const body = opts.body.trim();
  const hasH1 = /^\s{0,3}#\s+\S/m.test(body.slice(0, 200));
  const head = hasH1 ? '' : `# ${opts.title.replace(/\r?\n/g, ' ').trim()}\n\n`;
  return `${fm}\n${head}${body}\n`;
}

/** pdf → 纯文本（pdf-parse：new PDFParse({data}).getText()） */
async function extractPdf(buf: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) } as never);
    try {
      const res = (await parser.getText()) as { text?: string; pages?: { text?: string }[] };
      const text = (res?.text ?? '').trim();
      if (text) return text;
      // 部分 pdf-parse 版本不聚合 text，回退逐页拼接
      return (res?.pages ?? []).map((p) => p?.text ?? '').join('\n').trim();
    } finally {
      await (parser as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
    }
  } catch (err) {
    throw new ImportError(`PDF 解析失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * docx → 纯文本（mammoth.extractRawText）。
 * 不转 Markdown：docx 的「样式」在知识库里无意义，纯文本入索引更干净（标题另由文件名/frontmatter 承载）。
 * .doc（老二进制格式）mammoth 无法解析 → 显式提示另存为 .docx。
 */
async function extractDocx(buf: Buffer, sourceName: string): Promise<string> {
  let text = '';
  try {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer: buf });
    text = (res?.value ?? '').trim();
  } catch (err) {
    throw new ImportError(`Word 文档解析失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!text) {
    throw new ImportError(
      extname(sourceName).toLowerCase() === '.doc'
        ? '未能解析出内容：.doc 为旧版二进制格式，请另存为 .docx 后重新上传'
        : '未能解析出内容：文档可能是空的或受保护',
    );
  }
  return text;
}

/**
 * 导入一个文件到知识库。
 * @param file 上传文件名与二进制内容
 * @returns 落盘路径等信息（调用方负责触发重建索引以外的响应封装；此处已触发后台重建）
 */
export async function importDocumentFile(file: { filename: string; buffer: Buffer }): Promise<KnowledgeImportResult> {
  const ext = extname(file.filename ?? '').toLowerCase() as KnowledgeImportExt;
  const kind = EXT_KIND[ext];
  if (!kind) {
    throw new ImportError(`不支持的文件类型 ${ext || '（无扩展名）'}，仅支持 pdf / docx / doc / txt / md`);
  }
  const size = file.buffer?.byteLength ?? 0;
  if (size === 0) throw new ImportError('文件内容为空');
  if (size > KB_IMPORT_MAX_BYTES) {
    throw new ImportError(`文件过大（${(size / 1024 / 1024).toFixed(1)}MB），上限 ${KB_IMPORT_MAX_BYTES / 1024 / 1024}MB`);
  }

  const cfg = resolveVaultConfig();
  if (!cfg.root) throw new ImportError('知识库未连接：请先在知识库设置里连接 Vault 目录');
  const root = cfg.root;

  const safe = safeFileName(file.filename); // 已安全化的 `<stem>.<ext>`
  const title = extname(safe) ? safe.slice(0, safe.length - extname(safe).length) : safe;
  let body: string;
  if (kind === 'pdf') body = await extractPdf(file.buffer);
  else if (kind === 'docx') body = await extractDocx(file.buffer, file.filename);
  else body = file.buffer.toString('utf8').replace(/^\uFEFF/, '');

  if (!body.trim()) throw new ImportError('未能解析出任何文本内容');

  // 一律以 .md 落盘（知识库只索引 Markdown）；标题沿用原文件名主干
  const markdown = buildMarkdown({ title, sourceName: file.filename, sourceType: kind, body });
  const relPath = await uniqueRelPath(root, UPLOAD_DIR_REL, `${title}.md`);

  const abs = vaultAbsPath(root, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, markdown, 'utf8');

  const reindexStarted = rebuildIndexInBackground();
  return {
    ok: true,
    path: relPath,
    title,
    sourceName: file.filename,
    sourceType: kind,
    charCount: markdown.length,
    reindexStarted,
  };
}

/** 收件箱目录（供路由/测试断言用） */
export const IMPORT_DIR_REL = UPLOAD_DIR_REL;

/** 供测试：把 Vault 相对路径拼成绝对路径（复用 vault 的安全校验） */
export function importAbsPath(root: string, rel: string): string {
  return join(vaultAbsPath(root, rel));
}
