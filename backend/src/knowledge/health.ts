/**
 * 知识健康度（knowledge-ux A2 / design.md D3-D5）—— 文档使用率与孤岛判定的唯一计算函数。
 *
 * 口径（主文档 §0.2，与任务侧的溯源类指标严格区分，避免两套口径混淆）：
 * - 文档使用率 = 被至少一个任务关联过且仍存在于当前索引中的不同文档数 ÷ 已索引文档总数。
 *   分子与当前索引求交（`task_kb_refs` 中的失效行不计入，避免虚高）；`totalDocs === 0` 时 `ratio = null`（未知而非除零）。
 * - 孤岛文档 = 同时满足「无文档间链接边（kind='link'）」与「无共享标签」的文档。
 *   标签比较按去除首尾空白后的原字符串精确匹配（与 graphData 的标签节点口径一致）；
 *   「有独有标签」不等于「有共享标签」（design.md D4 反例）。
 *
 * 只读消费 `knowledge_docs` / `knowledge_links` / `task_kb_refs`，不写库、不改表结构（tasks 2.11）。
 * 与图谱 `isolated` 标记共用 `islandDocPaths()`，保证两处计数一致（tasks 2.9）。
 */
import type { KnowledgeHealth } from '@workbench/shared';
import { all, get } from '../db/client.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';
import { normalizeRel, resolveVaultConfig } from './vault.ts';

/**
 * 文档使用率（分子/分母/比例）。
 * 分子 = `task_kb_refs.doc_path` 与当前索引求交后的不同文档数（JOIN 天然剔除失效行，重复关联去重）；
 * 分母 = 当前已索引文档总数；`totalDocs === 0` 时 `ratio = null` 且不抛错。
 */
/**
 * 文档使用率：被任务引用的资料数 ÷ 索引到的总文档数。
 *
 * P1 补充：Vault 目录改名后，`task_kb_refs.doc_path` 中保存的旧路径与索引中的新路径
 * **前缀不同**，精确 JOIN 会全部落空、使用率恒为 0。因此除精确匹配外，增加**按文件名回退**：
 * 仅当索引中存在唯一同名文档时计入，与 `refs.ts` 的 `isDocAvailable` 判定口径保持一致。
 */
export function computeDocUsageRate(): { linkedDocs: number; totalDocs: number; ratio: number | null } {
  ensureKnowledgeSchema();
  const totalDocs = Number(get<{ c: number }>(`SELECT count(*) c FROM ${KT.docs}`)?.c ?? 0);
  if (totalDocs === 0) return { linkedDocs: 0, totalDocs: 0, ratio: null };

  const refPaths = all<{ doc_path: string }>(`SELECT DISTINCT doc_path FROM ${KT.taskRefs}`);
  const exact = new Set(all<{ path: string }>(`SELECT path FROM ${KT.docs}`).map((d) => d.path));
  // 文件名 → 该名字在索引中出现的次数（用于「唯一同名」判定）
  const byBase = new Map<string, number>();
  for (const p of exact) {
    const base = p.split('/').pop() ?? '';
    if (base) byBase.set(base, (byBase.get(base) ?? 0) + 1);
  }

  const used = new Set<string>();
  for (const r of refPaths) {
    const p = normalizeRel(r.doc_path);
    if (!p) continue;
    if (exact.has(p)) {
      used.add(p);
      continue;
    }
    const base = p.split('/').pop() ?? '';
    if (base && byBase.get(base) === 1) {
      for (const q of exact) {
        if ((q.split('/').pop() ?? '') === base) {
          used.add(q);
          break;
        }
      }
    }
  }
  const linkedDocs = used.size;
  return { linkedDocs, totalDocs, ratio: linkedDocs / totalDocs };
}

/** 解析文档 tags JSON（容错为空；标签按 trim 后原字符串） */
function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map((t) => String(t ?? '').trim()).filter(Boolean);
  } catch {
    /* 坏 JSON 容错为空 */
  }
  return [];
}

/**
 * 孤岛文档相对路径集合（按路径排序）。
 * 孤岛 = 无任何文档间链接边（kind='link' 的入边/出边均为空）且无共享标签（其任一标签被 ≥2 篇文档声明；无标签亦满足）。
 */
export function islandDocPaths(): string[] {
  ensureKnowledgeSchema();
  const docs = all<{ path: string; tags: string }>(`SELECT path, tags FROM ${KT.docs}`);
  if (docs.length === 0) return [];
  const docPaths = new Set(docs.map((d) => d.path));

  // 有文档间链接的文档集合（link 边的 source/target 并集；仅统计仍在索引内的路径，与 graphData 语义一致）
  const linked = new Set<string>();
  const linkRows = all<{ source_path: string; target: string }>(`SELECT source_path, target FROM ${KT.links} WHERE kind = 'link'`);
  for (const r of linkRows) {
    if (docPaths.has(r.source_path)) linked.add(r.source_path);
    if (docPaths.has(r.target)) linked.add(r.target);
  }

  // 标签 → 声明该标签的文档数（trim 后原字符串精确匹配）
  const tagCounts = new Map<string, number>();
  for (const d of docs) {
    for (const t of parseTags(d.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const sharedTags = new Set([...tagCounts.entries()].filter(([, c]) => c >= 2).map(([t]) => t));

  const islands: string[] = [];
  for (const d of docs) {
    if (linked.has(d.path)) continue;
    if (parseTags(d.tags).some((t) => sharedTags.has(t))) continue;
    islands.push(d.path);
  }
  return islands.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 知识健康度聚合（供 GET /api/knowledge/health 与图谱 isolated 标记共用） */
export function knowledgeHealth(): KnowledgeHealth {
  const computedAt = new Date().toISOString();
  // Vault 未连接：返回可解释空值（ratio null、清单空），不读索引数据、不 5xx
  if (!resolveVaultConfig().root) {
    return { usage: { linkedDocs: 0, totalDocs: 0, ratio: null }, islands: { count: 0, paths: [] }, computedAt };
  }
  const usage = computeDocUsageRate();
  const paths = islandDocPaths();
  return {
    usage,
    islands: { count: paths.length, paths },
    computedAt,
  };
}
