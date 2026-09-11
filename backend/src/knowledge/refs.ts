/**
 * 任务关联资料（design.md D6）—— 板块 A ↔ 板块 B 的唯一耦合点。
 *
 * - 存储在独立的 task_kb_refs 表（不含入板块 A 状态机）
 * - 粒度支持「整篇 / 章节片段」（坑4：存「路径 + 章节标题」，避免字节偏移漂移）
 * - 注入：阶段执行前读取关联 → 按片段截取 → 并入 producer 上下文（与既有 skills/files 通道一致）
 * - 降级：文件缺失/锚点漂移 → 注入「资料缺失」提示并标记失效，任务照常执行
 * - 边界：板块 A 对知识库内容只读消费，不写回 Vault
 */
import { KB_REF_LIMIT, HOT_HOT_REF_LIMIT, type HotEvidenceLevel, type TaskHotRef, type TaskHotRefInput, type TaskKbRef, type TaskKbRefInput } from '@workbench/shared';
import { all, get, run, tx } from '../db/client.ts';
import { readDoc } from './docs.ts';
import { sliceSection } from './markdown.ts';
import { KT, ensureKnowledgeSchema, type TaskHotRefRow, type TaskKbRefRow } from './schema.ts';
import { normalizeRel, resolveVaultConfig, vaultFileExists } from './vault.ts';

export { KB_REF_LIMIT, HOT_HOT_REF_LIMIT };

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

/**
 * 批量只读聚合（delivery-ops B6）：一次查询取全部任务的关联资料，按任务返回
 * { total, invalid }。同一 doc_path 只判定一次可用性（集合级去重 + 缓存），
 * 避免逐任务 N+1 判定；与 listTaskKbRefs 的失效判定（isDocAvailable）口径一致。
 * 纯只读：不修改 task_kb_refs 表结构与任何既有函数行为。
 */
export function countKbRefsByTask(taskIds: number[]): Map<number, { total: number; invalid: number }> {
  const out = new Map<number, { total: number; invalid: number }>();
  const ids = (taskIds ?? []).filter((id) => Number.isFinite(id));
  if (ids.length === 0) return out;

  ensureKnowledgeSchema();
  const rows = all<TaskKbRefRow>(
    `SELECT * FROM ${KT.taskRefs} WHERE task_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`,
    ids,
  );

  // 集合级去重：同 doc_path 只判定一次，结果缓存复用
  const availabilityCache = new Map<string, boolean>();
  const check = (docPath: string): boolean => {
    const path = normalizeRel(docPath);
    if (availabilityCache.has(path)) return availabilityCache.get(path)!;
    const valid = isDocAvailable(path);
    availabilityCache.set(path, valid);
    return valid;
  };

  for (const r of rows) {
    const entry = out.get(r.task_id) ?? { total: 0, invalid: 0 };
    entry.total += 1;
    if (!check(r.doc_path)) entry.invalid += 1;
    out.set(r.task_id, entry);
  }
  return out;
}

export type { TaskKbRefInput, TaskKbRef };

// ============================================================================
// hot-intel D2：任务背景 · 外部环境情报（独立表 task_hot_refs，不改 task_kb_refs）
// ============================================================================

/** 热点背景数量超限时抛出（路由层转 400） */
export class HotRefLimitError extends Error {
  constructor(limit: number) {
    super(`任务背景·外部环境情报最多挂 ${limit} 条热点`);
    this.name = 'HotRefLimitError';
  }
}

/** 热点背景无效（hotId/title 缺失）时抛出 */
export class HotRefInvalidError extends Error {
  constructor(hotId: string) {
    super(`无效的热点背景条目：${hotId}`);
    this.name = 'HotRefInvalidError';
  }
}

/** 证据等级归一化（非法值回退 single-source） */
function normEvidence(v: unknown): HotEvidenceLevel {
  const s = v && String(v).trim() ? String(v).trim() : '';
  return s === 'multi-source' || s === 'single-source' || s === 'traceable' ? s : 'single-source';
}

/** 行 → 共享类型（快照条目持久化后始终有效；移除即删除行） */
function toHotRef(row: TaskHotRefRow): TaskHotRef {
  return {
    id: row.id,
    taskId: row.task_id,
    hotId: row.hot_id,
    title: row.title,
    sourceId: row.source_id || '',
    sourceName: row.source_name || '',
    evidence: normEvidence(row.evidence),
    url: row.url || null,
    latestAt: row.latest_at || null,
    createdAt: row.created_at,
    valid: row.valid === 1,
  };
}

/** 归一化并校验热点背景（不改库；超限/非法时抛出） */
function normalizeHotRefs(refs: TaskHotRefInput[]): TaskHotRefInput[] {
  const input = Array.isArray(refs) ? refs : [];
  if (input.length > HOT_HOT_REF_LIMIT) throw new HotRefLimitError(HOT_HOT_REF_LIMIT);
  const seen = new Set<string>();
  const normalized: TaskHotRefInput[] = [];
  for (const r of input) {
    const hotId = String(r?.hotId ?? '').trim();
    const title = String(r?.title ?? '').trim();
    if (!hotId || !title) throw new HotRefInvalidError(hotId || '(空)');
    if (seen.has(hotId)) continue;
    seen.add(hotId);
    normalized.push({
      hotId,
      title,
      sourceId: r.sourceId && String(r.sourceId).trim() ? String(r.sourceId).trim() : '',
      sourceName: r.sourceName && String(r.sourceName).trim() ? String(r.sourceName).trim() : '',
      evidence: normEvidence(r.evidence),
      url: r.url && String(r.url).trim() ? String(r.url).trim() : null,
      latestAt: r.latestAt && String(r.latestAt).trim() ? String(r.latestAt).trim() : null,
    });
  }
  return normalized;
}

/**
 * 仅校验热点背景（挂接前调用；超限/非法时抛出）。
 */
export function validateTaskHotRefs(refs: TaskHotRefInput[]): void {
  ensureKnowledgeSchema();
  normalizeHotRefs(refs);
}

/**
 * 写入任务的热点背景（全量替换，与 kbRefs 语义一致）。
 * - 超过 HOT_HOT_REF_LIMIT 抛 HotRefLimitError；hotId/title 缺失抛 HotRefInvalidError
 * - 同一 hotId 去重
 */
export function setTaskHotRefs(taskId: number, refs: TaskHotRefInput[]): TaskHotRef[] {
  ensureKnowledgeSchema();
  const normalized = normalizeHotRefs(refs);
  tx(() => {
    run(`DELETE FROM ${KT.hotTaskRefs} WHERE task_id = ?`, [taskId]);
    for (const n of normalized) {
      run(
        `INSERT INTO ${KT.hotTaskRefs} (task_id,hot_id,title,source_id,source_name,evidence,url,latest_at,created_at,valid) VALUES (?,?,?,?,?,?,?,?,?,1)`,
        [taskId, n.hotId, n.title, n.sourceId ?? '', n.sourceName ?? '', n.evidence ?? '', n.url ?? null, n.latestAt ?? null, nowIso()],
      );
    }
  });
  return listTaskHotRefs(taskId);
}

/** 读取任务的热点背景（持久化快照：即使热点源当前不可用也始终可用） */
export function listTaskHotRefs(taskId: number): TaskHotRef[] {
  ensureKnowledgeSchema();
  const rows = all<TaskHotRefRow>(`SELECT * FROM ${KT.hotTaskRefs} WHERE task_id = ? ORDER BY id ASC`, [taskId]);
  return rows.map(toHotRef);
}

/** 清除任务的全部热点背景（任务删除等场景） */
export function clearTaskHotRefs(taskId: number): void {
  ensureKnowledgeSchema();
  run(`DELETE FROM ${KT.hotTaskRefs} WHERE task_id = ?`, [taskId]);
}

/** 任务是否有任何热点背景（注入前快速判断） */
export function hasTaskHotRefs(taskId: number): boolean {
  ensureKnowledgeSchema();
  const row = get<{ c: number }>(`SELECT count(*) c FROM ${KT.hotTaskRefs} WHERE task_id = ?`, [taskId]);
  return Number(row?.c ?? 0) > 0;
}

/**
 * 构造注入 producer 上下文的外部环境情报段（hot-intel D2，与「关联知识库资料」段并列）。
 * - 仅使用持久化快照（task_hot_refs 表），不依赖热点面板当前状态 → 热点源不可用时仍可注入；
 * - 含「不得作为产品品类/主体/功能规格依据」约束声明；
 * - 无背景时返回空字符串（板块 A 行为与既有完全一致——独立性保障）。
 */
export function buildHotContext(taskId: number | null | undefined): string {
  if (taskId == null) return '';
  let refs: TaskHotRef[];
  try {
    if (!hasTaskHotRefs(taskId)) return '';
    refs = listTaskHotRefs(taskId);
  } catch (err) {
    // 板块 B 异常不阻塞板块 A：注入失败仅记录，任务照常执行
    console.warn(`[knowledge] 加载任务 #${taskId} 外部环境情报失败，跳过注入：${err instanceof Error ? err.message : err}`);
    return '';
  }
  if (refs.length === 0) return '';

  const evidenceLabel: Record<string, string> = {
    'multi-source': '多源事件',
    'single-source': '单源信息',
    traceable: '可回查原文',
  };
  const lines = refs.map((r, i) => {
    const bits = [
      r.sourceName || '外部热点',
      r.evidence ? `证据等级：${evidenceLabel[r.evidence] ?? r.evidence}` : '',
      r.latestAt ? `数据时间：${r.latestAt.slice(0, 10)}` : '',
    ].filter(Boolean).join(' · ');
    const link = r.url ? `原文：${r.url}` : '';
    return `${i + 1}. ${r.title}（${bits}）${link ? `\n   ${link}` : ''}`;
  });

  return [
    '【任务背景 · 外部环境情报】',
    '以下为任务挂接时的外部热点情报（多信源聚合/行业快讯/官方数据），仅作任务背景参考，了解行业动态与外部环境。',
    '要求：这些情报**不得作为产品品类、主体或功能规格的依据**，也不得据此编造任务需求与资料中未出现的事实；',
    '如与任务需求或团队资料冲突，以任务需求与资料为准。',
    '',
    lines.join('\n'),
  ].join('\n');
}
