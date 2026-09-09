/**
 * 技能挂载模块：扫描本地技能目录 backend/skills/*.md，提供可挂载技能列表与内容读取；
 * 同时提供 backend/files/ 下挂载文件的全文读取（Agent.files 引用）。
 * 技能 id = 文件名（不含 .md）；首部约定元数据：# 标题 + > 描述：xxx。
 */
import { readFile, readdir } from 'node:fs/promises';
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
