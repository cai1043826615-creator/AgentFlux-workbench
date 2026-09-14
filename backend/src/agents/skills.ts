/**
 * 技能挂载模块：扫描知识库 Vault 内的技能目录 <技能库>/**\/*.md，提供可挂载技能列表与内容读取；
 * 同时提供挂载文件能力——二轮验收返工后（用户确认）：挂载文件 = 引用知识库 Vault 内任意 Markdown
 * 文档（agents.files 存 Vault 相对路径），不再有专用「挂载文件」文件夹；应用内上传统一落到
 * 「知识库/收件箱/」，上传即可挂载、即入知识库索引范围。
 *
 * 存放位置：技能默认 <repo>/docs/示例Vault/技能库；环境变量 WORKBENCH_SKILLS_ROOT 可覆盖（测试/自定义部署用）。
 *
 * 分类约定（目录即分类）：<技能库>/<分类目录>/*.md，目录名与展示名见 CATEGORY_LABEL
 * （中文目录名 电商/小红书/通用 原样即展示名）；根目录平铺的 *.md 归入「通用」；
 * 技能文件头「> 分类：xxx」可覆盖目录值，未识别的分类值原样保留展示（不强行归并）。
 * 技能 id = 文件名（不含 .md），与历史行为一致——agents.skills 存的是展示名/id，因此
 * 移动文件目录位置不影响已存挂载。首部元数据：# 标题 + > 描述：xxx（+ 可选 > 分类：xxx）。
 * 文件 id = 完整文件名（含扩展名），name = 展示名（不含扩展名）；仅支持 .md/.txt/.json。
 */
import { open, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSkillInfo } from '@workbench/shared';
import { listVaultMarkdown, resolveVaultConfig, vaultAbsPath } from '../knowledge/vault.ts';

/** 后端根目录 backend（src/agents 或 dist/agents 上溯两级；再上溯一级即 repo 根，与 Vault 目录 docs/ 同层） */
const BACKEND_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 技能目录：环境变量 WORKBENCH_SKILLS_ROOT 优先，默认 Vault 内 技能库/（每次调用解析，测试可在 import 后改 env 再 reset 索引） */
export function resolveSkillsDir(): string {
  const env = (process.env.WORKBENCH_SKILLS_ROOT ?? '').trim();
  if (env) return resolve(env);
  return resolve(BACKEND_ROOT, '..', 'docs', '示例Vault', '技能库');
}

/** 应用内上传挂载文件的落点（Vault 相对目录；用户确认：上传保留并指向知识库） */
export const UPLOAD_DIR_REL = '知识库/收件箱';

/** 生效的 Vault 根（未连接返回 null；挂载文件全部以 Vault 为真相来源） */
function vaultRootOrNull(): string | null {
  return resolveVaultConfig().root;
}

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

/** 由文件绝对路径推导默认分类展示名：根目录平铺 → 通用；一级子目录按映射（中文目录名原样即展示名），未知目录名原样保留 */
function categoryOfPath(filePath: string): string {
  const rel = relative(resolveSkillsDir(), filePath);
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
  const skillsDir = resolveSkillsDir();
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
  await addDir(skillsDir); // 根目录平铺（兼容历史结构）
  let subs: string[] = [];
  try {
    subs = (await readdir(skillsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return index; // 根目录本身缺失 → 空索引
  }
  for (const sub of subs.sort()) await addDir(join(skillsDir, sub));
  return index;
}

/** 供测试注入重置（正常业务代码不要调用） */
export function resetSkillIndexForTest(): void {
  indexPromise = null;
}

/** 使技能索引失效（上传新技能后调用，保证下一次 listSkills/readSkillContent 能扫到） */
export function invalidateSkillIndex(): void {
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
  return readFile(join(resolveSkillsDir(), `${skillId}.md`), 'utf8').catch(() => '');
}

/**
 * 查询单个技能的分类（skill-workflow-isolation）：
 * 与 listSkills 完全同一套解析链（索引 → categoryOfPath → parseSkillMeta，文件头可覆盖），
 * 保证「展示徽标」与「注入过滤」口径一致。未命中（目录中不存在）返回 null。
 */
export async function skillCategoryOf(skillId: string): Promise<string | null> {
  if (!skillId || skillId.includes('\0') || skillId.includes('..')) return null;
  const index = await ensureIndex();
  const fp = index.get(skillId);
  if (!fp) return null;
  const head = await readHead(fp).catch(() => '');
  return parseSkillMeta(skillId, head, categoryOfPath(fp)).category;
}

/**
 * 读取挂载文件全文（二轮验收返工后：agents.files 存 Vault 相对路径，如「知识库/品牌规范/品牌手册.md」）。
 * 解析顺序：① Vault 相对路径（现行为）→ ② 历史裸文件名兜底（迁移前旧库：Vault 挂载文件/ 与旧 backend/files/）。
 * 文件不存在/越界返回空字符串（既有降级语义）。
 */
export async function readFileContent(fileRef: string): Promise<string> {
  if (!fileRef || fileRef.includes('\0')) return '';
  const root = vaultRootOrNull();
  if (root && !fileRef.includes('\\')) {
    try {
      return await readFile(vaultAbsPath(root, fileRef), 'utf8');
    } catch {
      /* 落到历史兜底 */
    }
  }
  const name = basename(fileRef);
  if (!name || name === '.' || name === '..') return '';
  const legacyDirs = [root ? join(root, '挂载文件') : null, resolve(BACKEND_ROOT, 'files')];
  for (const dir of legacyDirs) {
    if (!dir) continue;
    const content = await readFile(join(dir, name), 'utf8').catch(() => null);
    if (content !== null) return content;
  }
  return '';
}

/** 挂载文件条目：id = Vault 相对路径（Agent.files 引用，兼容 readFileContent）；name = 同 id（展示即来源路径，杜绝同名歧义） */
export interface MountedFileInfo {
  id: string;
  name: string;
}

/** 挂载文件扩展名白名单 */
const FILE_EXT_RE = /\.(md|txt|json)$/i;

/**
 * 可挂载文件列表 = 知识库 Vault 内全部 Markdown（用户确认：挂载 = 从知识库挑文档，不再有专用文件夹）。
 * 排除「技能库/」——技能已在 SKILL 区按分类挂载，避免同一文件被双重挂载为 FILE。
 * Vault 未连接时返回空数组（前端已有降级提示）。
 */
export async function listFiles(): Promise<MountedFileInfo[]> {
  const cfg = resolveVaultConfig();
  if (!cfg.root) return [];
  const root = cfg.root;
  const skillRel = relative(root, resolveSkillsDir()).replace(/\\/g, '/');
  const entries = await listVaultMarkdown({ ...cfg, root }).catch(() => []);
  return entries
    .filter((e) => !(skillRel && (e.path === skillRel || e.path.startsWith(`${skillRel}/`))))
    .map((e) => ({ id: e.path, name: e.path }))
    .sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
}

/**
 * 保存上传的技能：写入技能库/<分类目录>/<文件名>.md（分类由调用方给定，默认「通用」）。
 * 技能 id = 文件名（不含 .md），与目录扫描口径一致；写完使索引失效，立即可挂载。
 * 校验：仅 .md；只允许文件名（不含路径分隔符），basename 归一化后必须等于原值防路径逃逸。
 */
export async function saveSkillContent(name: string, content: string, category = CATEGORY_LABEL.common): Promise<string> {
  if (!name || name.includes('\0')) throw new Error('技能文件名不能为空');
  const safe = basename(name);
  if (safe !== name || safe === '.' || safe === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法文件名（仅允许文件名，不允许路径）：${name}`);
  }
  if (!/\.md$/i.test(safe)) throw new Error(`技能仅支持 .md 文件：${name}`);
  // 分类目录名 = 中文展示名本身（磁盘上是 电商/小红书/通用 中文目录，与 categoryOfPath 对称）；
  // 兼容调用方传英文 key（CATEGORY_LABEL 的值查得到就归一为中文目录名）。
  const dirName = CATEGORY_LABEL[category] ?? category;
  const dir = join(resolveSkillsDir(), dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, safe), content, 'utf8');
  invalidateSkillIndex();
  return safe.slice(0, -'.md'.length);
}

/**
 * 把上传内容写入知识库（固定落点 Vault 内「知识库/收件箱/」，上传即可挂载、即入知识库索引范围）。
 * 校验：仅允许 .md/.txt/.json；只允许文件名（不含路径分隔符），basename 归一化后必须等于原值防路径逃逸。
 * Vault 未连接时抛错（路由层转 4xx/5xx）。
 */
export async function saveFileContent(name: string, content: string): Promise<string> {
  if (!name || name.includes('\0')) throw new Error('文件名不能为空');
  const safe = basename(name);
  if (safe !== name || safe === '.' || safe === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`非法文件名（仅允许文件名，不允许路径）：${name}`);
  }
  if (!FILE_EXT_RE.test(safe)) throw new Error(`仅支持 .md/.txt/.json 文件：${name}`);
  const root = vaultRootOrNull();
  if (!root) throw new Error('知识库 Vault 未连接，无法保存（请先在知识库页连接 Vault）');
  const rel = `${UPLOAD_DIR_REL}/${safe}`;
  const abs = vaultAbsPath(root, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  return rel;
}
