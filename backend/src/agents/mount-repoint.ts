/**
 * 挂载引用自愈：改名 / 移动的识别与静默跟随（OpenSpec change `mount-rename-follow`）。
 *
 * 问题：挂载是**按定位符引用**的（技能 id = 文件名，文件 id = Vault 相对路径），
 * 所以「改内容」「新增」都不影响挂载，**只有改名或移动位置会让引用落空**。
 *
 * 解法：索引重建时以「重建前的目录快照」为基线比对新目录——某引用消失、而当前目录中
 * **恰好一个**条目与其旧内容指纹相同时，认定为改名/移动，把挂载静默改写到新引用。
 * 详见 design.md 决策 3。
 *
 * 三条不可动摇的边界：
 * 1) 只有唯一匹配才跟随；歧义（多个同指纹候选）、无候选（删除或内容已变）、无基线（首次升级）
 *    一律不跟随——宁可漏（保持失效、用户手动重挂），绝不误指（挂载内容会真实进 prompt）。
 * 2) 只认内容指纹，不做名称相似度 / mtime / 目录邻近等模糊匹配。
 * 3) 全程静默：只写后端日志，不加任何用户面控件、提示或开关。
 */
import { createHash } from 'node:crypto';
import { all, run, tx } from '../db/client.ts';
import { parseList, parseParts, unionOfParts } from '../db/agent-mounts.ts';

/** 快照类别（两个命名空间互不干扰：引用形态与所在列都不同） */
export const SNAPSHOT_DOCS = 'docs';
export const SNAPSHOT_SKILLS = 'skills';
export type SnapshotKind = typeof SNAPSHOT_DOCS | typeof SNAPSHOT_SKILLS;

/** 目录条目：ref = 引用（技能 id 或 Vault 相对路径），hash = 内容指纹 */
export interface CatalogEntry {
  ref: string;
  hash: string;
}

/** 一次改名/移动：旧引用 → 新引用 */
export interface CatalogRename {
  from: string;
  to: string;
}

/** agents 行（只取挂载相关列） */
interface MountRow {
  id: string;
  skills: string;
  files: string;
  workflow_skills: string;
  workflow_files: string;
}

/** 内容指纹（sha1，与知识库索引同一算法口径） */
export function contentHash(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

/** 读取某类别的目录快照（基线）。表缺失/未就绪返回空数组——空基线即「本轮不跟随」，不阻断索引 */
export function readCatalogSnapshot(kind: SnapshotKind): CatalogEntry[] {
  try {
    return all<CatalogEntry>('SELECT ref, hash FROM catalog_snapshot WHERE kind = ?', [kind]);
  } catch {
    return [];
  }
}

/** 覆盖式写入快照（同 kind 先删后插，事务内保证原子）；失败只告警，不影响索引本身 */
export function saveCatalogSnapshot(kind: SnapshotKind, entries: CatalogEntry[]): void {
  try {
    tx(() => {
      run('DELETE FROM catalog_snapshot WHERE kind = ?', [kind]);
      const insert = 'INSERT OR REPLACE INTO catalog_snapshot (kind, ref, hash) VALUES (?,?,?)';
      for (const e of entries) {
        if (!e.hash) continue; // 无指纹的条目不入基线，避免下一轮用它做错误的同指纹匹配
        run(insert, [kind, e.ref, e.hash]);
      }
    });
  } catch (err) {
    console.warn(`[mount-repoint] 目录快照写入失败（${kind}）：${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 比对新旧目录，推出「旧引用 → 新引用」的改名/移动映射。
 *
 * 认定条件（全部满足才认定）：
 *  1. 旧引用在当前目录中已消失；
 *  2. 旧引用在基线里有指纹记录；
 *  3. 当前目录中**恰好一个**条目与该旧指纹相同；
 *  4. 该新引用没有被另一个同样消失的旧引用同时认领（防两份同内容文件互相错认）。
 *
 * 任一条不满足即跳过：视为删除、内容已变更，或存在歧义。
 */
export function diffCatalog(oldEntries: CatalogEntry[], nextEntries: CatalogEntry[]): CatalogRename[] {
  if (oldEntries.length === 0) return []; // 无基线（首次升级 / 未连接）→ 本轮不跟随

  const nextRefs = new Set(nextEntries.map((e) => e.ref));
  const byHash = new Map<string, string[]>();
  for (const e of nextEntries) {
    if (!e.hash) continue;
    const list = byHash.get(e.hash);
    if (list) list.push(e.ref);
    else byHash.set(e.hash, [e.ref]);
  }

  const candidates: CatalogRename[] = [];
  for (const old of oldEntries) {
    if (!old.hash) continue;
    if (nextRefs.has(old.ref)) continue; // 引用仍在 → 无需跟随
    const matches = byHash.get(old.hash) ?? [];
    if (matches.length !== 1) continue; // 歧义（>1）或无候选（0）→ 不认定
    candidates.push({ from: old.ref, to: matches[0]! });
  }

  // 防串认：同一个新引用被多个旧引用认领时，全部丢弃（无法判断谁才是它原来的身份）
  const claims = new Map<string, number>();
  for (const c of candidates) claims.set(c.to, (claims.get(c.to) ?? 0) + 1);
  return candidates.filter((c) => claims.get(c.to) === 1);
}

/** 按映射改写引用列表，并去重（同一处不出现重复引用） */
function remapList(list: string[], map: Map<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of list) {
    const next = map.get(ref) ?? ref;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/** 按映射改写各工作流分份 */
function remapParts(parts: Record<string, string[]>, map: Map<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [workflowId, list] of Object.entries(parts)) out[workflowId] = remapList(list, map);
  return out;
}

/**
 * 把改名映射落到 Agent 挂载上（静默改写）。
 *
 * 命名空间隔离：技能类只动 `skills` / `workflow_skills`，文件类只动 `files` / `workflow_files`。
 * 分份与并集必须一起改（有分份的 Agent 按各份重算并集，与 PUT 路由同口径），
 * 否则 `skills` / `files` 会残留旧引用，表现为并集里多一个失效项。
 *
 * @returns 被改写的 Agent 数（0 表示无变化）
 */
export function repointMounts(kind: SnapshotKind, renames: CatalogRename[]): number {
  if (renames.length === 0) return 0;
  const map = new Map(renames.map((r) => [r.from, r.to]));
  const isSkills = kind === SNAPSHOT_SKILLS;

  let rows: MountRow[] = [];
  try {
    rows = all<MountRow>('SELECT id, skills, files, workflow_skills, workflow_files FROM agents');
  } catch {
    return 0; // 表未建好等异常：不阻断索引，下一轮再试
  }

  let touched = 0;
  for (const row of rows) {
    const partsRaw = isSkills ? row.workflow_skills : row.workflow_files;
    const globalRaw = isSkills ? row.skills : row.files;
    const parts = parseParts(partsRaw);

    if (Object.keys(parts).length > 0) {
      // 有分份：改各份 + 重算并集（两个字段同一 UPDATE，避免只改一处）
      const nextParts = remapParts(parts, map);
      const partsJson = JSON.stringify(nextParts);
      const unionJson = JSON.stringify(unionOfParts(nextParts));
      if (partsJson === partsRaw && unionJson === globalRaw) continue;
      run(
        isSkills
          ? 'UPDATE agents SET workflow_skills = ?, skills = ? WHERE id = ?'
          : 'UPDATE agents SET workflow_files = ?, files = ? WHERE id = ?',
        [partsJson, unionJson, row.id],
      );
    } else {
      // 无分份（通用岗）：全局值即权威值，直接改写
      const json = JSON.stringify(remapList(parseList(globalRaw), map));
      if (json === globalRaw) continue;
      run(isSkills ? 'UPDATE agents SET skills = ? WHERE id = ?' : 'UPDATE agents SET files = ? WHERE id = ?', [json, row.id]);
    }
    touched++;
  }

  if (touched > 0) {
    const detail = renames.map((r) => `${r.from} → ${r.to}`).join('；');
    console.warn(`[mount-repoint] ${isSkills ? '技能' : '文件'}改名/移动已静默更新挂载（${touched} 个 Agent）：${detail}`);
  }
  return touched;
}

/**
 * 一次完整的跟随流程：比对基线 → 改写挂载。调用方负责在索引**成功**后落新快照。
 * @returns 本次认定的改名映射（便于测试与日志）
 */
export function followCatalogChanges(
  kind: SnapshotKind,
  baseline: CatalogEntry[],
  nextEntries: CatalogEntry[],
): CatalogRename[] {
  const renames = diffCatalog(baseline, nextEntries);
  if (renames.length > 0) repointMounts(kind, renames);
  return renames;
}
