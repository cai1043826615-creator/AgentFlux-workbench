/**
 * 中文全文检索（design.md D3，坑3）：
 * - ≥3 字词走 FTS5 trigram（MATCH + bm25 相关度排序）——中文无需外部分词器
 * - 1-2 字短词 trigram 无命中，回退 LIKE 兜底
 * - 混合查询（长词 + 短词）取交集，保证所有词都命中
 */
import type { KnowledgeSearchHit, KnowledgeSearchResult } from '@workbench/shared';
import { all } from '../db/client.ts';
import { makeSnippet } from './markdown.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';
import { normalizeRel } from './vault.ts';

/** FTS5 trigram 的最小可命中长度（3-gram） */
const TRIGRAM_MIN = 3;

/** LIKE 兜底命中的固定分值（排在 FTS 命中之后） */
const LIKE_SCORE_BASE = 1_000_000;

interface DocRow {
  path: string;
  title: string;
  dir_path: string;
  tags: string;
  body: string;
}

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** 构造 FTS5 查询串：各长词作为短语 AND 组合（引号转义避免语法错误） */
function buildMatchExpr(terms: string[]): string {
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ');
}

/**
 * 关键词搜索。返回按相关度排序的命中列表（含标题/相对路径/命中片段）。
 * query 为空返回空结果（不视为错误）。
 */
export function searchDocs(query: string, limit = 30): KnowledgeSearchResult {
  ensureKnowledgeSchema();
  const q = String(query ?? '').trim();
  if (!q) return { query: q, hits: [] };

  const terms = q.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const ftsTerms = terms.filter((t) => [...t].length >= TRIGRAM_MIN);
  const shortTerms = terms.filter((t) => [...t].length < TRIGRAM_MIN);

  /** path → { score, mode } */
  const merged = new Map<string, { score: number; mode: 'fts' | 'like' }>();
  let first = true;

  if (ftsTerms.length > 0) {
    let rows: { path: string; score: number }[] = [];
    try {
      rows = all<{ path: string; score: number }>(
        `SELECT f.path AS path, bm25(${KT.fts}) AS score FROM ${KT.fts} f WHERE ${KT.fts} MATCH ? ORDER BY score LIMIT 200`,
        [buildMatchExpr(ftsTerms)],
      );
    } catch {
      rows = []; // MATCH 语法异常时按无命中处理，不抛给用户
    }
    for (const r of rows) merged.set(r.path, { score: r.score, mode: 'fts' });
    first = false;
  }

  if (shortTerms.length > 0) {
    const where = shortTerms.map(() => `(body LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')`).join(' AND ');
    const params: string[] = [];
    for (const t of shortTerms) {
      params.push(`%${escapeLike(t)}%`, `%${escapeLike(t)}%`);
    }
    const rows = all<{ path: string }>(`SELECT path FROM ${KT.docs} WHERE ${where} ORDER BY mtime DESC LIMIT 200`, params);
    if (first) {
      rows.forEach((r, i) => merged.set(r.path, { score: LIKE_SCORE_BASE + i, mode: 'like' }));
    } else {
      // 混合查询：只保留同时满足长词与短词的文档
      const likeSet = new Set(rows.map((r) => r.path));
      for (const key of [...merged.keys()]) {
        if (!likeSet.has(key)) merged.delete(key);
      }
    }
  }

  const ordered = [...merged.entries()].sort((a, b) => a[1].score - b[1].score).slice(0, Math.max(1, limit));
  if (ordered.length === 0) {
    return { query: q, hits: [], hint: `未找到包含「${q}」的文档，可尝试其他关键词` };
  }

  const hits: KnowledgeSearchHit[] = [];
  for (const [path, meta] of ordered) {
    const row = all<DocRow>(`SELECT path,title,dir_path,tags,body FROM ${KT.docs} WHERE path = ?`, [path])[0];
    if (!row) continue;
    hits.push({
      path: normalizeRel(row.path),
      title: row.title,
      dir: row.dir_path,
      tags: parseTags(row.tags),
      snippet: makeSnippet(row.body, terms.find((t) => row.body.includes(t)) ?? terms[0] ?? q),
      matchMode: meta.mode,
      score: Number(meta.score.toFixed(4)),
    });
  }
  return { query: q, hits };
}
