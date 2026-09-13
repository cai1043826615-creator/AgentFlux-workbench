/**
 * 技能挂载模块：扫描本地技能目录 backend/skills/**\/*.md，提供可挂载技能列表与内容读取；
 * 同时提供 backend/files/ 下挂载文件（Agent.files 引用）的目录列表、全文读取与新增保存（上传）。
 *
 * 分类约定（目录即分类）：backend/skills/<分类目录>/*.md，目录 key 与展示名见 CATEGORY_LABEL；
 * 根目录平铺的 *.md 归入「通用」（兼容历史扁平结构）；技能文件头「> 分类：xxx」可覆盖目录值，
 * 未识别的分类值原样保留展示（不强行归并，让写错分类可见）。
 * 技能 id = 文件名（不含 .md），与历史行为一致——agents.skills 存的是展示名/id，因此
 * 移动文件目录位置不影响已存挂载。首部元数据：# 标题 + > 描述：xxx（+ 可选 > 分类：xxx）。
 * 文件 id = 完整文件名（含扩展名），name = 展示名（不含扩展名）；仅支持 .md/.txt/.json。
 */
import { open, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSkillInfo } from '@workbench/shared';

/** 技能目录：backend/skills（相对本文件定位，src 与 dist 均正确） */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
/** 挂载文件目录：backend/files */
const FILES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'files');

/** 分类展示顺序（目录 key）；未列出的目录排在已知分类之后 */
const CATEGORY_ORDER = ['ecommerce', 'xhs', 'common'];
/** 目录 key → 中文展示名 */
const CATEGORY_LABEL: Record<string, string> = {
  ecommerce: '电商',
  xhs: '小红书',
  common: '通用',
};

/** 分类排序权重：按 CATEGORY_ORDER（电商 → 小红书 → 通用），未知分类排最后（design D2/D4） */
export function categoryRank(category: string): number {
  const key = Object.keys(CATEGORY_LABEL).find((k) => CATEGORY_LABEL[k] === category);
  const i = key ? CATEGORY_ORDER.indexOf(key) : -1;
  return i < 0 ? CATEGORY_ORDER.length : i;
}

/** 由文件绝对路径推导默认分类展示名：根目录平铺 → 通用；一级子目录按映射，未知目录名原样保留 */
function categoryOfPath(filePath: string): string {
  const rel = relative(SKILLS_DIR, filePath);
  const i = rel.indexOf(sep);
  if (i < 0) return CATEGORY_LABEL.common;
  const top = rel.slice(0, i);
  return CATEGORY_LABEL[top] ?? top;
}

/**
 * 从技能全文（或头部片段）解析首部元数据：# 标题 / > 描述：xxx / > 分类：xxx。
 * category 为调用方给定的默认分类（来自所在目录的展示名），文件头「> 分类：」可覆盖；
 * 未识别的分类值原样保留——静默归并会让分类错误不可见（design D2）。
 */
export function parseSkillMeta(id: string, content: string, category = CATEGORY_LABEL.common): AgentSkillInfo {
  const nameMatch = /^#\s+(.+)$/m.exec(content);
  const descMatch = /^>\s*描述\s*[：:]\s*(.+)$/m.exec(content);
  const catMatch = /^>\s*分类\s*[：:]\s*(.+)$/m.exec(content);
  return {
    id,
    name: (nameMatch?.[1] ?? id).trim(),
    description: (descMatch?.[1] ?? '（无描述）').trim(),
    category: (catMatch?.[1] ?? category).trim() || CATEGORY_LABEL.common,
  };
}

/** 只读文件头部若干字节解析元数据（元数据约定在首部，避免为取标题读整个技能全文） */
async function readHead(path: string, bytes = 4096): Promise<string> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

/**
 * 技能 id → 绝对路径 索引（懒加载 Promise，进程内缓存；技能文件变更属开发期行为，重启即刷新）。
 * 自构建是关键：工作流执行路径（buildProducerSystemPrompt → readSkillContent）不经过 listSkills，
 * 若索引不自动建立，子目录技能会在重启后静默注入为空（design D3 修的正是这个静默失效）。
 */
let indexPromise: Promise<Map<string, string>> | null = null;

function ensureIndex(): Promise<Map<string, string>> {
  if (!indexPromise) indexPromise = scanIndex();
  return indexPromise;
}

/** 扫描根目录 + 各一级分类子目录；跨目录同名技能保留先扫到的并告警（design D4） */
async function scanIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const addDir = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return; // 目录不存在则跳过，不中断整体
    }
    for (const entry of entries.filter((e) => e.endsWith('.md')).sort()) {
      const id = entry.slice(0, -'.md'.length);
      const fp = join(dir, entry);
      if (index.has(id)) {
        console.warn(`[skills] 技能 id 重复，已忽略后者：${fp}（保留 ${index.get(id)}）`);
        continue;
      }
      index.set(id, fp);
    }
  };
  await addDir(SKILLS_DIR); // 根目录平铺（兼容历史结构）
  let subs: string[] = [];
  try {
    subs = (await readdir(SKILLS_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return index; // 根目录本身缺失 → 空索引
  }
  for (const sub of subs.sort()) await addDir(join(SKILLS_DIR, sub));
  return index;
}

/** 供测试注入重置（正常业务代码不要调用） */
export function resetSkillIndexForTest(): void {
  indexPromise = null;
}

/** 扫描技能目录，返回按分类归好的可挂载技能列表（目录缺失时返回空数组） */
export async function listSkills(): Promise<AgentSkillInfo[]> {
  const index = await ensureIndex();
  const skills: AgentSkillInfo[] = [];
  for (const [id, fp] of index) {
    const head = await readHead(fp).catch(() => '');
    skills.push(parseSkillMeta(id, head, categoryOfPath(fp)));
  }
  return skills.sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category) || a.id.localeCompare(b.id, 'zh-CN'),
  );
}

/**
 * 读取技能全文（任何调用路径都先经自构建索引，保证分类子目录中的技能可被找到；
 * 索引未命中再回退根目录扁平查找；不存在返回空字符串）。
 */
export async function readSkillContent(skillId: string): Promise<string> {
  if (!skillId || skillId.includes('\0') || skillId.includes('..')) return '';
  const index = await ensureIndex();
  const fp = index.get(skillId);
  if (fp) return readFile(fp, 'utf8').catch(() => '');
  // 回退：极新文件尚未入索引时按根目录扁平查找；含路径分隔符的 id 只信索引，防目录穿越。
  if (skillId.includes('/') || skillId.includes('\\')) return '';
  return readFile(join(SKILLS_DIR, `${skillId}.md`), 'utf8').catch(() => '');
}

/** 读取挂载文件全文（backend/files 下；文件名归一化防路径逃逸，文件不存在返回空字符串） */
export async function readFileContent(fileRef: string): Promise<string> {
  if (!fileRef || fileRef.includes('\0')) return '';
  const name = basename(fileRef);
  if (!name || name === '.' || name === '..') return '';
  return readFile(join(FILES_DIR, name), 'utf8').catch(() => '');
}

/** 挂载文件目录信息：id = 完整文件名（Agent.files 引用，兼容 readFileContent）；name = 展示名（不含扩展名） */
export interface MountedFileInfo {
  id: string;
  name: string;
}

/** 挂载文件扩展名白名单 */
const FILE_EXT_RE = /\.(md|txt|json)$/i;

/**
 * 扫描挂载文件目录 backend/files/*.{md,txt,json}，返回可挂载文件列表（目录缺失时返回空数组）。
 */
export async function listFiles(): Promise<MountedFileInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(FILES_DIR);
  } catch {
    return [];
  }
  const files: MountedFileInfo[] = [];
  for (const entry of entries) {
    const m = FILE_EXT_RE.exec(entry);
    if (!m) continue;
    files.push({ id: entry, name: entry.slice(0, -(m[1].length + 1)) });
  }
  return files.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
}

/**
 * 把挂载文件写入 backend/files/，返回写入后的完整文件名（id）。
 * 校验：仅允许 .md/.txt/.json；只允许文件名（不含路径分隔符），basename 归一化后必须等于原值防路径逃逸。
 * 非法输入抛 Error，由调用方（路由层）转 4xx/5xx。
 */
export async function saveFileContent(name: string, content: string): Promise<string> {
  if (!name || name.includes('\0')) throw new Error('文件名不能为空');
  const safe = basename(name);
  if (safe !== name || safe === '.' || safe === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法文件名（仅允许文件名，不允许路径）：${name}`);
  }
  if (!FILE_EXT_RE.test(safe)) throw new Error(`仅支持 .md/.txt/.json 文件：${name}`);
  await mkdir(FILES_DIR, { recursive: true });
  await writeFile(join(FILES_DIR, safe), content, 'utf8');
  return safe;
}
