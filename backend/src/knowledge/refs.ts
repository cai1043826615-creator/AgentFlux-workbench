/**
 * 任务关联资料（design.md D6）—— 板块 A ↔ 板块 B 的唯一耦合点。
 *
 * - 存储在独立的 task_kb_refs 表（不含入板块 A 状态机）
 * - 粒度支持「整篇 / 章节片段」（坑4：存「路径 + 章节标题」，避免字节偏移漂移）
 * - 注入：阶段执行前读取关联 → 按片段截取 → 并入 producer 上下文（与既有 skills/files 通道一致）
 * - 降级：文件缺失/锚点漂移 → 注入「资料缺失」提示并标记失效，任务照常执行
 * - 边界：板块 A 对知识库内容只读消费，不写回 Vault
 */
import { KB_REF_LIMIT, type TaskKbRef, type TaskKbRefInput } from '@workbench/shared';
import { all, get, run, tx } from '../db/client.ts';
import { readDoc } from './docs.ts';
import { sliceSection } from './markdown.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';
import { normalizeRel, resolveVaultConfig, vaultFileExists } from './vault.ts';
import type { TaskKbRefRow } from './schema.ts';

export { KB_REF_LIMIT };

/** 关联数量超限时抛出（路由层转 400） */
export class KbRefLimitError extends Error {
  constructor(limit: number) {
    super(`关联知识库资料最多 ${limit} 份`);
    this.name = 'KbRefLimitError';
  }
}

/** 关联资料不存在/不在索引范围时抛出 */
export class KbRefInvalidError extends Error {
  constructor(docPath: string) {
    super(`知识库中不存在该资料（未索引或不在索引范围）：${docPath}`);
    this.name = 'KbRefInvalidError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 行 → 共享类型（valid 由调用方按当前 Vault/索引判定） */
function toRef(row: TaskKbRefRow, valid: boolean): TaskKbRef {
  return {
    id: row.id,
    taskId: row.task_id,
    docPath: row.doc_path,
    title: row.title,
    anchor: row.anchor && row.anchor.trim() ? row.anchor : null,
    note: row.note || undefined,
    createdAt: row.created_at,
    valid,
  };
}

/** 文档当前是否可用（索引内存在，或 Vault 中实际存在） */
function isDocAvailable(docPath: string): boolean {
  const path = normalizeRel(docPath);
  const indexed = get<{ path: string }>(`SELECT path FROM ${KT.docs} WHERE path = ?`, [path]);
  if (indexed) return true;
  return vaultFileExists(resolveVaultConfig(), path);
}

/** 归一化并校验关联资料（不改库；超限/资料不存在时抛出） */
function normalizeRefs(refs: TaskKbRefInput[]): { docPath: string; title: string; anchor: string | null; note: string }[] {
  const input = Array.isArray(refs) ? refs : [];
  if (input.length > KB_REF_LIMIT) throw new KbRefLimitError(KB_REF_LIMIT);

  const seen = new Set<string>();
  const normalized: { docPath: string; title: string; anchor: string | null; note: string }[] = [];
  for (const r of input) {
    const docPath = normalizeRel(r?.docPath ?? '');
    if (!docPath) continue;
    const anchor = r.anchor && String(r.anchor).trim() ? String(r.anchor).trim() : null;
    const key = `${docPath}#${anchor ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isDocAvailable(docPath)) throw new KbRefInvalidError(docPath);
    const row = get<{ title: string }>(`SELECT title FROM ${KT.docs} WHERE path = ?`, [docPath]);
    normalized.push({ docPath, title: row?.title ?? docPath.replace(/\.md$/i, ''), anchor, note: String(r.note ?? '') });
  }
  return normalized;
}

/**
 * 仅校验关联资料（新建任务前调用：先校验再建任务，避免产生关联失败的半成品任务）。
 * 超限或资料不在知识库时抛出 KbRefLimitError / KbRefInvalidError。
 */
export function validateTaskKbRefs(refs: TaskKbRefInput[]): void {
  ensureKnowledgeSchema();
  normalizeRefs(refs);
}

/**
 * 写入任务的关联资料（新建任务时调用）。
 * - 超过 6 份抛 KbRefLimitError
 * - 资料不在知识库（未索引且 Vault 中不存在）抛 KbRefInvalidError
 * - 同一文档同一片段去重
 */
export function setTaskKbRefs(taskId: number, refs: TaskKbRefInput[]): TaskKbRef[] {
  ensureKnowledgeSchema();
  const normalized = normalizeRefs(refs);

  tx(() => {
    run(`DELETE FROM ${KT.taskRefs} WHERE task_id = ?`, [taskId]);
    for (const n of normalized) {
      run(`INSERT INTO ${KT.taskRefs} (task_id,doc_path,title,anchor,note,created_at) VALUES (?,?,?,?,?,?)`, [
        taskId,
        n.docPath,
        n.title,
        n.anchor,
        n.note,
        nowIso(),
      ]);
    }
  });

  return listTaskKbRefs(taskId);
}

/** 读取任务的关联资料（含失效标记：文档已从 Vault/索引消失时为 false） */
export function listTaskKbRefs(taskId: number): TaskKbRef[] {
  ensureKnowledgeSchema();
  const rows = all<TaskKbRefRow>(`SELECT * FROM ${KT.taskRefs} WHERE task_id = ? ORDER BY id ASC`, [taskId]);
  return rows.map((r) => toRef(r, isDocAvailable(r.doc_path)));
}

/** 清除任务的全部关联资料（任务删除等场景；板块 A 无删除入口，保留供维护使用） */
export function clearTaskKbRefs(taskId: number): void {
  ensureKnowledgeSchema();
  run(`DELETE FROM ${KT.taskRefs} WHERE task_id = ?`, [taskId]);
}

/** 任务是否有任何关联资料（注入前快速判断，避免无谓读盘） */
export function hasTaskKbRefs(taskId: number): boolean {
  ensureKnowledgeSchema();
  const row = get<{ c: number }>(`SELECT count(*) c FROM ${KT.taskRefs} WHERE task_id = ?`, [taskId]);
  return Number(row?.c ?? 0) > 0;
}

/** 单份资料的注入正文（含降级提示） */
export interface KbFragment {
  ref: TaskKbRef;
  /** 命中的片段文本；缺失时为 null */
  content: string | null;
  /** ok 正常 / missing 文件缺失 / anchor-missing 锚点漂移已降级整篇 */
  state: 'ok' | 'missing' | 'anchor-missing';
}

/**
 * 加载任务关联资料的片段内容。
 * - 文件缺失 → state='missing'（不抛错）
 * - 锚点在最新文档中找不到 → 降级为整篇并标记 'anchor-missing'
 */
export async function loadTaskKbFragments(taskId: number): Promise<KbFragment[]> {
  const refs = listTaskKbRefs(taskId);
  const out: KbFragment[] = [];
  for (const ref of refs) {
    const doc = await readDoc(ref.docPath);
    if (!doc) {
      out.push({ ref: { ...ref, valid: false }, content: null, state: 'missing' });
      continue;
    }
    if (!ref.anchor) {
      out.push({ ref, content: doc.content, state: 'ok' });
      continue;
    }
    const sliced = sliceSection(doc.content, ref.anchor);
    if (!sliced) {
      out.push({ ref, content: doc.content, state: 'anchor-missing' });
      continue;
    }
    out.push({ ref, content: sliced.content, state: 'ok' });
  }
  return out;
}

/**
 * 构造注入 producer 上下文的知识库资料段（与 skills/files 注入通道并列）。
 * 无关联资料时返回空字符串（板块 A 行为与既有完全一致——独立性保障）。
 */
export async function buildKnowledgeContext(taskId: number | null | undefined): Promise<string> {
  if (taskId == null) return '';
  let fragments: KbFragment[];
  try {
    if (!hasTaskKbRefs(taskId)) return '';
    fragments = await loadTaskKbFragments(taskId);
  } catch (err) {
    // 板块 B 异常不阻塞板块 A：注入失败仅记录，任务照常执行
    console.warn(`[knowledge] 加载任务 #${taskId} 关联资料失败，跳过注入：${err instanceof Error ? err.message : err}`);
    return '';
  }
  if (fragments.length === 0) return '';

  const blocks = fragments.map((f, i) => {
    const head = f.ref.anchor
      ? `### 资料 ${i + 1}：《${f.ref.title}》· 片段「${f.ref.anchor}」`
      : `### 资料 ${i + 1}：《${f.ref.title}》（整篇）`;
    const path = `路径：${f.ref.docPath}`;
    if (f.state === 'missing' || f.content == null) {
      return `${head}\n${path}\n（资料缺失：Vault 中已不存在或已移出索引范围，请忽略该资料，不要凭空编造其内容）`;
    }
    if (f.state === 'anchor-missing') {
      return `${head}\n${path}\n（原章节未找到，以下为整篇内容，请自行定位相关部分）\n\n${f.content}`;
    }
    return `${head}\n${path}\n\n${f.content}`;
  });

  return [
    '【关联知识库资料】',
    '以下为团队知识库中的只读参考资料，用于确保事实准确（参数、规格、品牌规范等）。',
    '要求：优先采信资料中的事实；资料未覆盖的信息不要编造。',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

export type { TaskKbRefInput, TaskKbRef };
