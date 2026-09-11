/**
 * Vault 只读接入层（design.md D2 / 坑5 + 坑3）：
 * - 配置来源：设置表 `knowledgeVault`（设置面板写入）→ 环境变量 `WORKBENCH_VAULT_ROOT` 兜底
 * - 索引范围：目录白名单（includeDirs）+ 排除目录（excludeDirs），避免对 Vault 全盘托出
 * - 只读边界：所有文件访问经本模块封装，任何写/删/移动/建目录操作一律被拒绝（assertVaultReadOnly）
 *
 * 说明：`settings` 表是工作台的共享配置基础设施（design.md D2 明确 Vault 配置复用现有设置路由/面板），
 * 不属于板块 A 的业务状态；板块 B 不读写板块 A 的业务表（tasks/deliverables/task_events 等）。
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { get, run, sqlite } from '../db/client.ts';

/** 设置表中 Vault 配置的键名 */
export const VAULT_SETTINGS_KEY = 'knowledgeVault';

/** 环境变量兜底名 */
export const VAULT_ENV_KEY = 'WORKBENCH_VAULT_ROOT';

/** 默认排除目录（Obsidian / 版本库 / 依赖 / 回收站） */
export const DEFAULT_EXCLUDE_DIRS = ['.git', '.obsidian', '.trash', 'node_modules', '.pnpm-store', 'dist', '.DS_Store'];

/** 只读边界被违反时抛出 */
export class VaultReadOnlyError extends Error {
  constructor(op: VaultOp, target: string) {
    super(`Vault 为只读接入，禁止 ${op} 操作：${target}`);
    this.name = 'VaultReadOnlyError';
  }
}

/** Vault 路径不存在/越界时抛出 */
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultPathError';
  }
}

export type VaultOp = 'read' | 'write' | 'delete' | 'move' | 'mkdir';

/**
 * 只读边界守卫：Vault 是用户的 Obsidian 目录，工作台只读取、绝不写入。
 * 除 'read' 外的任何操作一律拒绝（由单测覆盖 write/delete/move/mkdir 均被拒绝）。
 */
export function assertVaultReadOnly(op: VaultOp, target: string): void {
  if (op !== 'read') throw new VaultReadOnlyError(op, target);
}

export interface VaultConfig {
  /** 生效的 Vault 根目录绝对路径（未配置为 null） */
  root: string | null;
  includeDirs: string[];
  excludeDirs: string[];
  /** settings 设置面板 / env 环境变量 / none 未配置 */
  source: 'settings' | 'env' | 'none';
  /** 未连接原因（中文，source=none 或路径无效时） */
  reason?: string;
}

/** 设置表中存的形状 */
interface VaultSettingsValue {
  root?: unknown;
  includeDirs?: unknown;
  excludeDirs?: unknown;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter(Boolean);
}

/** 归一化相对路径：统一 / 分隔、去掉首尾斜杠与 ./ 前缀 */
export function normalizeRel(input: string): string {
  let s = String(input ?? '').replace(/\\/g, '/').trim();
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s;
}

/** 读取设置表中的 Vault 配置原始值（无则 null；settings 表缺失时按未配置处理） */
function readSettingsValue(): VaultSettingsValue | null {
  let row: { value: string } | undefined;
  try {
    row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [VAULT_SETTINGS_KEY]);
  } catch {
    return null; // settings 表尚未建立（板块 A 未初始化）→ 视为未配置
  }
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as VaultSettingsValue) : null;
  } catch {
    return null;
  }
}

/** 解析生效的 Vault 配置（设置面板优先，环境变量兜底） */
export function resolveVaultConfig(): VaultConfig {
  const settings = readSettingsValue();
  const settingsRoot = typeof settings?.root === 'string' ? settings.root.trim() : '';
  const envRoot = (process.env[VAULT_ENV_KEY] ?? '').trim();
  const includeDirs = asStringArray(settings?.includeDirs).map(normalizeRel).filter(Boolean);
  const excludeDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS, ...asStringArray(settings?.excludeDirs).map(normalizeRel).filter(Boolean)])];

  const rawRoot = settingsRoot || envRoot;
  const source: VaultConfig['source'] = settingsRoot ? 'settings' : envRoot ? 'env' : 'none';
  if (!rawRoot) {
    return { root: null, includeDirs, excludeDirs, source: 'none', reason: '未配置 Vault 路径（设置面板或环境变量 WORKBENCH_VAULT_ROOT）' };
  }

  const abs = resolve(rawRoot);
  if (!existsSync(abs)) {
    return { root: null, includeDirs, excludeDirs, source, reason: `Vault 目录不存在：${abs}` };
  }
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return { root: null, includeDirs, excludeDirs, source, reason: `Vault 目录不可读：${abs}` };
  }
  if (!statSync(real).isDirectory()) {
    return { root: null, includeDirs, excludeDirs, source, reason: `Vault 路径不是目录：${real}` };
  }
  return { root: real, includeDirs, excludeDirs, source };
}

/** 保存 Vault 配置到设置表（设置面板调用；root 为空表示断开连接） */
export function saveVaultConfig(input: { root?: string; includeDirs?: string[]; excludeDirs?: string[] }): void {
  const value = {
    root: String(input.root ?? '').trim(),
    includeDirs: asStringArray(input.includeDirs).map(normalizeRel).filter(Boolean),
    excludeDirs: asStringArray(input.excludeDirs).map(normalizeRel).filter(Boolean),
  };
  const json = JSON.stringify(value);
  let exists: { key: string } | undefined;
  try {
    exists = get<{ key: string }>('SELECT key FROM settings WHERE key = ?', [VAULT_SETTINGS_KEY]);
  } catch {
    // settings 表缺失：由板块 A 的 ensureSchema 建立，这里显式兜底建表（共享配置基础设施）
    sqlite.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  }
  if (exists) run('UPDATE settings SET value = ? WHERE key = ?', [json, VAULT_SETTINGS_KEY]);
  else run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [VAULT_SETTINGS_KEY, json]);
}

/**
 * 判断相对路径是否落在索引范围内：
 * - 排除目录（含默认）优先剔除
 * - 配置了白名单时，只保留白名单目录下（含其子目录）的文件
 */
export function inIndexRange(relPath: string, cfg: VaultConfig): boolean {
  const rel = normalizeRel(relPath);
  if (!rel) return false;
  const segments = rel.split('/');
  const dirs = segments.slice(0, -1); // 该文件所在目录链（不含文件名）

  for (const ex of cfg.excludeDirs) {
    const exSeg = ex.split('/').filter(Boolean);
    if (exSeg.length === 0) continue;
    // 排除匹配：目录链中任意前缀等于排除目录
    for (let i = 0; i + exSeg.length <= dirs.length; i++) {
      if (exSeg.every((s, k) => dirs[i + k] === s)) return false;
    }
  }

  if (cfg.includeDirs.length === 0) return true;
  return cfg.includeDirs.some((inc) => {
    const incSeg = inc.split('/').filter(Boolean);
    if (incSeg.length === 0) return false;
    return incSeg.every((s, i) => dirs[i] === s);
  });
}

/** 相对路径 → Vault 内绝对路径（防路径逃逸：不接受绝对路径与 .. 段） */
export function vaultAbsPath(root: string, relPath: string): string {
  const rel = normalizeRel(relPath);
  if (!rel) throw new VaultPathError('空路径');
  if (isAbsolute(relPath)) throw new VaultPathError(`不接受绝对路径：${relPath}`);
  if (rel.split('/').some((s) => s === '..')) throw new VaultPathError(`路径不允许包含 ..：${relPath}`);
  const abs = resolve(join(root, rel));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) throw new VaultPathError(`路径越出 Vault 范围：${relPath}`);
  return abs;
}

/** Vault 内 Markdown 文件条目（扫描结果，不含内容） */
export interface VaultFileEntry {
  /** 相对 Vault 根路径（/ 分隔） */
  path: string;
  mtime: string;
  size: number;
}

/**
 * 递归扫描 Vault 内 `.md` 文件（只读）。
 * - 跳过符号链接（防越界）、排除目录与白名单外的目录
 * - 不读取文件内容，仅取 mtime/size，供索引阶段按 hash 增量判断
 */
export async function listVaultMarkdown(cfg: VaultConfig): Promise<VaultFileEntry[]> {
  assertVaultReadOnly('read', cfg.root ?? '(unset)');
  if (!cfg.root) return [];
  const out: VaultFileEntry[] = [];

  async function walk(dirAbs: string, dirRel: string): Promise<void> {
    let entries: Dirent<string>[];
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return; // 不可读目录跳过，不中断整体扫描
    }
    for (const entry of entries) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue; // 不跟随符号链接
      if (entry.isDirectory()) {
        if (!inIndexRange(`${rel}/__probe__.md`, cfg)) continue;
        await walk(join(dirAbs, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      if (!inIndexRange(rel, cfg)) continue;
      try {
        const st = await stat(join(dirAbs, entry.name));
        out.push({ path: rel, mtime: st.mtime.toISOString(), size: st.size });
      } catch {
        /* 文件在扫描期间消失：跳过 */
      }
    }
  }

  await walk(cfg.root, '');
  out.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
  return out;
}

/** 读取 Vault 内文档原文（只读；文件不存在返回 null） */
export async function readVaultFile(cfg: VaultConfig, relPath: string): Promise<{ content: string; mtime: string; size: number } | null> {
  assertVaultReadOnly('read', relPath);
  if (!cfg.root) return null;
  let abs: string;
  try {
    abs = vaultAbsPath(cfg.root, relPath);
  } catch {
    return null;
  }
  try {
    const [content, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
    return { content, mtime: st.mtime.toISOString(), size: st.size };
  } catch {
    return null;
  }
}

/** 判断 Vault 内文件当前是否存在（关联资料失效标记用） */
export function vaultFileExists(cfg: VaultConfig, relPath: string): boolean {
  if (!cfg.root) return false;
  try {
    return existsSync(vaultAbsPath(cfg.root, relPath));
  } catch {
    return false;
  }
}

/** 计算相对目录（'' 表示根目录） */
export function dirOf(relPath: string): string {
  const rel = normalizeRel(relPath);
  const idx = rel.lastIndexOf('/');
  return idx < 0 ? '' : rel.slice(0, idx);
}

/** 供调试/展示：Vault 根相对路径（不暴露绝对路径以外信息） */
export function relativeToRoot(root: string, abs: string): string {
  return normalizeRel(relative(root, abs));
}
