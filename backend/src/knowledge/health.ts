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
import { all } from '../db/client.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';
import { normalizeRel, resolveVaultConfig } from './vault.ts';

/**
 * Q4/Q7（复核定案 §8.3）：「助理收件箱/」虚拟目录已取消全部用户可见形态（见 docs.ts）。
 * 健康度与界面可见口径必须一致：界面看不到的文档不能进分母、也不能靠它们的链接边把别人「传染」成已使用。
 * 这 9 篇由 indexer 写入索引表（索引器不在本次可改范围），故在 health 读侧同样屏蔽。
 */
const INBOX_PREFIX = '助理收件箱/';
/** 排除收件箱虚拟目录的 SQL 条件 */
const NOT_INBOX = `path NOT LIKE '${INBOX_PREFIX}%'`;

/**
 * 文档使用率（分子/分母/比例）。
 * 分子 = 三通道「已使用」并集 ∩ 当前索引（JOIN 天然剔除失效行，重复关联去重）：
 *   ① 被任务关联（`task_kb_refs.doc_path`，精确 + 唯一同名回退）
 *   ② 被 Agent 挂载（agents 表 workflow_skills / workflow_files / skills / files）
 *   ③ 被其他文档 wiki 引用（`knowledge_links` 中 kind='link' 的 source/target）
 * 分母 = 当前已索引文档总数；`totalDocs === 0` 时 `ratio = null` 且不抛错。
 */
/**
 * 文档使用率：被使用（任务关联 / Agent 挂载 / wiki 引用）的资料数 ÷ 索引到的总文档数。
 *
 * P1 补充：Vault 目录改名后，`task_kb_refs.doc_path` 中保存的旧路径与索引中的新路径
 * **前缀不同**，精确 JOIN 会全部落空、使用率恒为 0。因此除精确匹配外，增加**按文件名回退**：
 * 仅当索引中存在唯一同名文档时计入，与 `refs.ts` 的 `isDocAvailable` 判定口径保持一致。
 *
 * Q3（复核打回）：原实现只统计了通道①，「三通道合并」名不副实——7 篇正在被真实注入 Prompt 的
 * 技能库挂载文档不计入使用率。此处真正并入通道②③，与 `islandDocPaths()` 的三通道口径对齐。
 */
export function computeDocUsageRate(): { linkedDocs: number; totalDocs: number; ratio: number | null } {
  ensureKnowledgeSchema();
  const docRows = all<{ path: string }>(`SELECT path FROM ${KT.docs} WHERE ${NOT_INBOX}`);
  const totalDocs = docRows.length;
  if (totalDocs === 0) return { linkedDocs: 0, totalDocs: 0, ratio: null };

  const exact = new Set(docRows.map((d) => d.path));
  // 文件名 → 该名字在索引中出现的次数（用于「唯一同名」判定）
  const byBase = new Map<string, number>();
  for (const p of exact) {
    const base = p.split('/').pop() ?? '';
    if (base) byBase.set(base, (byBase.get(base) ?? 0) + 1);
  }

  const used = new Set<string>();
  // ① 被任务关联
  const refPaths = all<{ doc_path: string }>(`SELECT DISTINCT doc_path FROM ${KT.taskRefs}`);
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

  // ② 被 Agent 挂载：路径精确匹配 + 按「去 .md 后缀的 basename」匹配
  //    （技能名「小红书合规违禁词清单」命中「技能库/小红书/小红书合规违禁词清单.md」）
  const mounted = mountedTokens();
  const mountedBase = new Set<string>();
  for (const t of mounted) {
    const b = (t.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (b) mountedBase.add(b);
  }
  for (const p of exact) {
    if (used.has(p)) continue;
    if (mounted.has(p)) {
      used.add(p);
      continue;
    }
    const b = (p.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (b && mountedBase.has(b)) used.add(p);
  }

  // ③ 被其他文档 wiki 引用（link 边的 source/target 并集；仅统计仍在索引内的路径。
  //    收件箱文档已不可见，其出边不参与判定——否则一篇隐藏文档就能把半个库「传染」成已使用）
  const linkRows = all<{ source_path: string; target: string }>(
    `SELECT source_path, target FROM ${KT.links} WHERE kind = 'link' AND source_path NOT LIKE '${INBOX_PREFIX}%'`,
  );
  for (const r of linkRows) {
    if (exact.has(r.source_path)) used.add(r.source_path);
    if (exact.has(r.target)) used.add(r.target);
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
 * 解析 Agent 挂载 JSON（skills / files 为 JSON 数组，workflow_* 为 JSON 对象；
 * 坏 JSON 容错为空），并把其中的字符串值归一化为 token 集合。
 * 只读 agents 表（板块 A 挂载列）；表/列缺失或异常时返回空集，不影响孤岛判定。
 */
function mountedTokens(): Set<string> {
  const tokens = new Set<string>();
  try {
    const rows = all<{ workflow_skills: string; workflow_files: string; skills: string; files: string }>(
      'SELECT workflow_skills, workflow_files, skills, files FROM agents',
    );
    for (const r of rows) {
      for (const raw of [r.workflow_skills, r.workflow_files, r.skills, r.files]) {
        let v: unknown = null;
        try {
          v = JSON.parse(raw);
        } catch {
          continue;
        }
        const collect = (x: unknown): void => {
          if (typeof x === 'string' && x.trim()) tokens.add(normalizeRel(x.trim()));
          else if (Array.isArray(x)) x.forEach(collect);
          else if (x && typeof x === 'object') Object.values(x as Record<string, unknown>).forEach(collect);
        };
        collect(v);
      }
    }
  } catch {
    /* agents 表缺失/无挂载列：通道②空，不影响其余通道 */
  }
  return tokens;
}

/**
 * 孤岛文档相对路径集合（按路径排序）。
 * 孤岛 = 同时不满足三通道「已使用」判定：① 被任务关联（task_kb_refs）
 * ② 被 Agent 挂载（workflow_skills / workflow_files / skills / files 并集）
 * ③ 被其他文档 wiki 引用（kind='link' 的入边/出边）；且无共享标签（其任一标签被 ≥2 篇文档声明）。
 * 三通道合并（修 D-25）：避免把已挂载/已引用的资产误判为孤岛。
 */
export function islandDocPaths(): string[] {
  ensureKnowledgeSchema();
  const docs = all<{ path: string; tags: string }>(`SELECT path, tags FROM ${KT.docs} WHERE ${NOT_INBOX}`);
  if (docs.length === 0) return [];
  const docPaths = new Set(docs.map((d) => d.path));

  // 三通道「已使用」并集
  const used = new Set<string>();
  // ① 被任务关联
  try {
    const refPaths = all<{ doc_path: string }>(`SELECT DISTINCT doc_path FROM ${KT.taskRefs}`);
    for (const r of refPaths) {
      const p = normalizeRel(r.doc_path);
      if (docPaths.has(p)) used.add(p);
    }
  } catch {
    /* task_kb_refs 缺失不阻塞 */
  }
  // ② 被 Agent 挂载（精确路径 + 按文件名/basename 匹配：技能名「小红书合规违禁词清单」命中「技能库/…/小红书合规违禁词清单.md」）
  const mounted = mountedTokens();
  for (const t of mounted) if (docPaths.has(t)) used.add(t);
  for (const d of docs) {
    if (used.has(d.path)) continue;
    const base = (d.path.split('/').pop() ?? '').replace(/\.md$/i, '');
    if (base && mounted.has(base)) used.add(d.path);
  }
  // ③ 有文档间链接的文档集合（link 边的 source/target 并集；仅统计仍在索引内的路径，与 graphData 语义一致）
  const linkRows = all<{ source_path: string; target: string }>(
    `SELECT source_path, target FROM ${KT.links} WHERE kind = 'link' AND source_path NOT LIKE '${INBOX_PREFIX}%'`,
  );
  for (const r of linkRows) {
    if (docPaths.has(r.source_path)) used.add(r.source_path);
    if (docPaths.has(r.target)) used.add(r.target);
  }

  // 标签 → 声明该标签的文档数（trim 后原字符串精确匹配）
  const tagCounts = new Map<string, number>();
  for (const d of docs) {
    for (const t of parseTags(d.tags)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const sharedTags = new Set([...tagCounts.entries()].filter(([, c]) => c >= 2).map(([t]) => t));

  const islands: string[] = [];
  for (const d of docs) {
    if (used.has(d.path)) continue;
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
