/**
 * 小红书内容拆解 → 知识库 Markdown（参考 ob-Plugin：Xiaohongshu Importer Plus）。
 *
 * 两条输入路径：
 * ① 粘贴分享文本（App「分享」复制出的整段文案）→ 解析标题/正文/话题/图片与视频链接；
 * ② 粘贴笔记链接（xhslink.com 短链 / xiaohongshu.com 长链）→ 取出链接；有 Cookie 时联网补全，
 *    无 Cookie 时**降级**：以链接为来源生成占位笔记（标题=链接尾巴），并在 degraded 里说明。
 *
 * Cookie 状态：读取 settings 键 `xhsCookie` 或环境变量 WORKBENCH_XHS_COOKIE。
 * 未配置时**绝不崩溃**——按粘贴文本能解析多少就解析多少，并给出明确中文降级提示。
 * 本轮不做真实联网抓取（用户暂无 Cookie）：`fetchNoteByUrl` 只在有 Cookie 时调用，
 * 未配置时直接返回降级信息，Cookie 到位后补上抓取实现即可启用。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { XhsImportResult } from '@workbench/shared';
import { get } from '../db/client.ts';
import { rebuildIndexInBackground } from './indexer.ts';
import { resolveVaultConfig, vaultAbsPath } from './vault.ts';

/** 小红书导入落盘目录（Vault 相对） */
export const XHS_DIR_REL = '知识库/收件箱/小红书';

/** settings 表中 Cookie 的键名 */
export const XHS_COOKIE_SETTINGS_KEY = 'xhsCookie';

/** 环境变量兜底名 */
export const XHS_COOKIE_ENV_KEY = 'WORKBENCH_XHS_COOKIE';

/** 拆解失败（面向用户的中文原因） */
export class XhsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XhsImportError';
  }
}

/** 小红书链接形态：短链 xhslink.com / 长链 xiaohongshu.com（explore 或 discovery 路径） */
const URL_RE = /https?:\/\/(?:www\.)?(?:xhslink\.com\/[A-Za-z0-9\-_/?.=%]+|xiaohongshu\.com\/(?:explore|discovery\/item|search\/result)\/[A-Za-z0-9\-_?=.]+)/gi;

/** 图片/视频链接：小红书 CDN 域名 */
const IMG_RE = /https?:\/\/[^\s"'）)]*?(?:xhscdn\.com|xiaohongshu\.com)[^\s"'）)]*?\.(?:jpg|jpeg|png|webp|gif)/gi;
const VIDEO_RE = /https?:\/\/[^\s"'）)]*?(?:xhscdn\.com|xiaohongshu\.com)[^\s"'）)]*?\.(?:mp4|mov|m3u8)/gi;

/** 分享文本里的固定噪声行（App 复制文案的常见首尾） */
const NOISE_RE =
  /^(?:复制本条信息|打开小红书|【小红书】|发布于|编辑于|关注|点赞|收藏|评论|分享|举报|复制链接|http.*$)/;

/** 话题标签：#xxx#（小红书正文里话题用双 # 包裹）或行尾 #xxx */
const TOPIC_RE = /#([^#\s][^#\n]{0,29})#?/g;

/** 已配置的 Cookie（settings 优先，环境变量兜底；未配置返回 ''） */
export function xhsCookie(): string {
  const env = (process.env[XHS_COOKIE_ENV_KEY] ?? '').trim();
  let settings = '';
  try {
    const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [XHS_COOKIE_SETTINGS_KEY]);
    const raw = row?.value ?? '';
    // 兼容两种存法：纯字符串 / JSON 字符串
    settings = raw.trim().startsWith('"') ? (JSON.parse(raw) as string) : raw;
  } catch {
    /* settings 表缺失或值非 JSON：按未配置处理 */
  }
  return (settings || env).trim();
}

/** 是否已配置 Cookie（供前端提示与降级判断） */
export function xhsCookieConfigured(): boolean {
  return xhsCookie().length > 0;
}

/**
 * 联网抓取笔记详情（Cookie 到位后的落点）。
 * 本轮未接入真实抓取：无 Cookie 直接抛降级，有 Cookie 时的抓取实现待 Cookie 到位后补齐。
 */
async function fetchNoteByUrl(url: string): Promise<{ title: string; body: string; images: string[]; videos: string[] } | null> {
  if (!xhsCookieConfigured()) return null; // 降级：仅按粘贴文本解析
  // TODO(Cookie 到位后启用)：带 Cookie 请求 url → 解析 __INITIAL_STATE__ 取 noteDetailMap
  void url;
  return null;
}

/** 解析分享文本：去掉噪声行，首行非空作标题，其余作正文；抽取话题/图片/视频/链接 */
export function parseSharedText(raw: string): {
  title: string;
  body: string;
  topics: string[];
  images: string[];
  videos: string[];
  urls: string[];
} {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  const urls = [...text.matchAll(URL_RE)].map((m) => m[0]);
  const images = [...new Set([...text.matchAll(IMG_RE)].map((m) => m[0]))];
  const videos = [...new Set([...text.matchAll(VIDEO_RE)].map((m) => m[0]))];

  const topics = [...new Set([...text.matchAll(TOPIC_RE)].map((m) => m[1].trim()).filter((t) => t && t.length <= 30))];

  // 正文：剔除纯链接行与噪声行，保留真段落
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOISE_RE.test(l) && !/^https?:\/\/\S+$/i.test(l));

  const title = (lines[0] ?? '').slice(0, 60) || '小红书笔记';
  const body = lines.slice(1).join('\n').trim() || lines.join('\n').trim();
  return { title, body, topics, images, videos, urls };
}

/** 生成带 frontmatter 的 Markdown 笔记 */
function buildNote(opts: {
  title: string;
  body: string;
  topics: string[];
  images: string[];
  videos: string[];
  sourceUrl: string | null;
  degraded: string | null;
}): string {
  const now = new Date().toISOString();
  const tags = ['小红书', '收件箱', ...opts.topics].slice(0, 12);
  const fm = [
    '---',
    `title: ${opts.title.replace(/\r?\n/g, ' ').trim()}`,
    `tags: [${tags.join(', ')}]`,
    '来源: 小红书',
    `链接: ${opts.sourceUrl ?? ''}`,
    `拆解时间: ${now}`,
    ...(opts.degraded ? [`降级说明: ${opts.degraded}`] : []),
    '---',
    '',
  ].join('\n');

  const blocks = [`# ${opts.title.replace(/\r?\n/g, ' ').trim()}`, ''];
  if (opts.body) blocks.push(opts.body, '');
  if (opts.images.length) {
    blocks.push('## 图片', '', ...opts.images.map((u) => `![](${u})`), '');
  }
  if (opts.videos.length) {
    blocks.push('## 视频', '', ...opts.videos.map((u) => `- ${u}`), '');
  }
  if (opts.sourceUrl) blocks.push('## 原文', '', opts.sourceUrl, '');
  return `${fm}\n${blocks.join('\n').trim()}\n`;
}

/** 标题 → 安全文件名（复用语义：去分隔符/控制字符，限长 60） */
function toFileName(title: string): string {
  const stem =
    title
      .replace(/[\r\n\t]/g, ' ')
      .replace(/[\\/]/g, '_')
      .replace(/[<>:*"|?\x00-\x1f]/g, '')
      .trim()
      .slice(0, 60) || '小红书笔记';
  return `${stem}.md`;
}

/**
 * 拆解一条小红书内容并写入知识库。
 * @param input.text 用户粘贴的分享文本或笔记链接
 */
export async function importXhsNote(input: { text: string }): Promise<XhsImportResult> {
  const raw = String(input?.text ?? '').trim();
  if (!raw) throw new XhsImportError('请粘贴小红书分享文本或笔记链接');

  const cfg = resolveVaultConfig();
  if (!cfg.root) throw new XhsImportError('知识库未连接：请先在知识库设置里连接 Vault 目录');
  const root = cfg.root;

  const parsed = parseSharedText(raw);
  const sourceUrl = parsed.urls[0] ?? null;

  // 只有链接、没有可解析正文时，尝试联网补全（无 Cookie → 降级）
  let title = parsed.title;
  let body = parsed.body;
  let images = parsed.images;
  let videos = parsed.videos;
  let degraded: string | null = null;

  const fetched = sourceUrl ? await fetchNoteByUrl(sourceUrl) : null;
  if (fetched) {
    title = fetched.title || title;
    body = fetched.body || body;
    images = fetched.images.length ? fetched.images : images;
    videos = fetched.videos.length ? fetched.videos : videos;
  } else if (sourceUrl) {
    degraded = xhsCookieConfigured()
      ? '已配置 Cookie，但联网抓取尚未启用：本次仅按粘贴文本拆解'
      : '未配置小红书 Cookie：本次仅按粘贴内容拆解，正文与图片以粘贴文本为准（配置 Cookie 后可自动补全正文与图片）';
  } else if (!xhsCookieConfigured()) {
    degraded = '未配置小红书 Cookie：本次仅按粘贴文本拆解（不影响文本解析；配置后可支持按链接自动抓取）';
  }

  if (title === '小红书笔记' && !body && sourceUrl) title = `小红书笔记 ${sourceUrl.split('/').pop()?.slice(0, 24) ?? ''}`.trim();

  const markdown = buildNote({ title, body, topics: parsed.topics, images, videos, sourceUrl, degraded });
  const fileName = toFileName(title);
  const relPath = await uniquePath(root, fileName);

  const abs = vaultAbsPath(root, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, markdown, 'utf8');

  return {
    ok: true,
    path: relPath,
    title,
    images,
    videos,
    sourceUrl,
    degraded,
    reindexStarted: rebuildIndexInBackground(),
  };
}

/** 同名递增（-2/-3…），只新增不覆盖 */
async function uniquePath(root: string, fileName: string): Promise<string> {
  const { existsSync } = await import('node:fs');
  const ext = '.md';
  const stem = fileName.slice(0, -ext.length);
  for (let i = 1; i < 500; i++) {
    const name = i === 1 ? fileName : `${stem}-${i}${ext}`;
    const rel = `${XHS_DIR_REL}/${name}`;
    if (!existsSync(vaultAbsPath(root, rel))) return rel;
  }
  throw new XhsImportError('同目录下同名笔记过多，请清理后重试');
}
