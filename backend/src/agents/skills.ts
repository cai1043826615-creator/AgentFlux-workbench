/**
 * 技能挂载模块：扫描本地技能目录 backend/skills/*.md，提供可挂载技能列表与内容读取；
 * 同时提供 backend/files/ 下挂载文件（Agent.files 引用）的目录列表、全文读取与新增保存（上传）。
 * 技能 id = 文件名（不含 .md）；首部约定元数据：# 标题 + > 描述：xxx。
 * 文件 id = 完整文件名（含扩展名），name = 展示名（不含扩展名）；仅支持 .md/.txt/.json。
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSkillInfo } from '@workbench/shared';

/** 技能目录：backend/skills（相对本文件定位，src 与 dist 均正确） */
const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');
/** 挂载文件目录：backend/files */
const FILES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'files');

/** 从技能全文解析首部元数据：# 标题 / > 描述：xxx，缺省时回退 id 与占位描述 */
export function parseSkillMeta(id: string, content: string): AgentSkillInfo {
  const nameMatch = /^#\s+(.+)$/m.exec(content);
  const descMatch = /^>\s*描述\s*[：:]\s*(.+)$/m.exec(content);
  return {
    id,
    name: (nameMatch?.[1] ?? id).trim(),
    description: (descMatch?.[1] ?? '（无描述）').trim(),
    category: '文案',
  };
}

/** 扫描技能目录，返回可挂载技能列表（目录缺失时返回空数组） */
export async function listSkills(): Promise<AgentSkillInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(SKILLS_DIR);
  } catch {
    return [];
  }
  const skills: AgentSkillInfo[] = [];
  for (const entry of entries.filter((e) => e.endsWith('.md'))) {
    const id = entry.slice(0, -'.md'.length);
    const content = await readFile(join(SKILLS_DIR, entry), 'utf8').catch(() => '');
    skills.push(parseSkillMeta(id, content));
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'));
}

/** 读取技能全文（技能不存在返回空字符串） */
export async function readSkillContent(skillId: string): Promise<string> {
  if (!skillId || skillId.includes('\0')) return '';
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
