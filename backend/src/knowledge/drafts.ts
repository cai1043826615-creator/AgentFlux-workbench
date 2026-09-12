/**
 * 小助理草稿区（P2·F3）：产出的唯一落点。
 *
 * 铁律（kb-assistant spec）：小助理对 Vault 严格只读，全部产出写入工作台自己的
 * 草稿区（kb_drafts 表，与 Vault 无关）；「沉淀进知识库」的落盘需用户另行授权，本轮不实现。
 *
 * 草稿不进知识库索引/搜索/星图——它们不是已确认资料（防止污染知识库可信度，见对接文档 §5.2）。
 */
import { all, get, run } from '../db/client.ts';
import { KT, ensureKnowledgeSchema, type KbDraftRow } from './schema.ts';

/** 草稿（camelCase 对外契约） */
export interface KbDraft {
  id: number;
  title: string;
  sourceKind: 'doc' | 'hot' | 'audit' | 'raw';
  sourceRef: string;
  agentId: string;
  structured: boolean;
  content: string;
  createdAt: string;
}

function toDraft(row: KbDraftRow): KbDraft {
  return {
    id: row.id,
    title: row.title,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    agentId: row.agent_id,
    structured: row.structured === 1,
    content: row.content,
    createdAt: row.created_at,
  };
}

/** 草稿列表（新→旧） */
export function listDrafts(): KbDraft[] {
  ensureKnowledgeSchema();
  const rows = all<KbDraftRow>(`SELECT * FROM ${KT.drafts} ORDER BY id DESC`);
  return rows.map(toDraft);
}

/** 单条草稿（不存在返回 null） */
export function getDraft(id: number): KbDraft | null {
  ensureKnowledgeSchema();
  const row = get<KbDraftRow>(`SELECT * FROM ${KT.drafts} WHERE id = ?`, [id]);
  return row ? toDraft(row) : null;
}

/** 新增草稿（小助理产出唯一写入点） */
export function createDraft(input: {
  title: string;
  sourceKind: 'doc' | 'hot' | 'audit' | 'raw';
  sourceRef?: string;
  agentId?: string;
  structured?: boolean;
  content: string;
}): KbDraft {
  ensureKnowledgeSchema();
  const now = new Date().toISOString();
  const result = run(
    `INSERT INTO ${KT.drafts} (title, source_kind, source_ref, agent_id, structured, content, created_at) VALUES (?,?,?,?,?,?,?)`,
    [
      input.title.trim() || '未命名草稿',
      input.sourceKind,
      input.sourceRef ?? '',
      input.agentId ?? 'agent-assistant',
      input.structured === false ? 0 : 1,
      input.content,
      now,
    ],
  );
  const id = Number(result.lastInsertRowid);
  return getDraft(id)!;
}

/** 删除草稿 */
export function deleteDraft(id: number): boolean {
  ensureKnowledgeSchema();
  const result = run(`DELETE FROM ${KT.drafts} WHERE id = ?`, [id]);
  return result.changes > 0;
}
