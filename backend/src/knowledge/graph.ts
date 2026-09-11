/**
 * 知识星图数据（design.md D4）：
 * 节点 = 已索引文档 + 被使用的标签；边 = 文档间链接（link）+ 文档-标签归属（tag）。
 * 共享标签的两篇文档经由标签节点连通（避免文档两两成边的 O(n²) 膨胀）。
 * 图数据只来源于索引范围：范围外的文档既不是节点，相关链接也不会生成有效边。
 */
import type { KnowledgeDocSummary, KnowledgeGraphData, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeNodeDetail } from '@workbench/shared';
import { all, get } from '../db/client.ts';
import { listAllDocs, rowToSummary, summariesOf } from './docs.ts';
import { KT, ensureKnowledgeSchema } from './schema.ts';
import { normalizeRel } from './vault.ts';
import type { KnowledgeDocRow } from './schema.ts';

const DOC_PREFIX = 'doc:';
const TAG_PREFIX = 'tag:';

/** 文档节点 id */
export function docNodeId(path: string): string {
  return `${DOC_PREFIX}${normalizeRel(path)}`;
}

/** 标签节点 id */
export function tagNodeId(tag: string): string {
  return `${TAG_PREFIX}${String(tag ?? '').trim()}`;
}

interface LinkRow {
  source_path: string;
  target: string;
  kind: string;
}

/**
 * 图数据（节点/边）。
 * 无链接无标签时返回空节点集与空边集（前端渲染空图而非报错）。
 */
export function graphData(): KnowledgeGraphData {
  ensureKnowledgeSchema();
  const docs = listAllDocs();
  const docPaths = new Set(docs.map((d) => d.path));
  const links = all<LinkRow>(`SELECT source_path, target, kind FROM ${KT.links}`);

  const degree = new Map<string, number>();
  const edges: KnowledgeGraphEdge[] = [];
  const usedTags = new Set<string>();

  for (const l of links) {
    const source = docNodeId(l.source_path);
    let target: string;
    if (l.kind === 'tag') {
      const tag = l.target.startsWith(TAG_PREFIX) ? l.target.slice(TAG_PREFIX.length) : l.target;
      if (!tag) continue;
      target = tagNodeId(tag);
      usedTags.add(tag);
    } else {
      // 链接边：目标必须仍在索引范围内，否则不生成有效边
      if (!docPaths.has(l.target)) continue;
      target = docNodeId(l.target);
    }
    edges.push({ source, target, kind: l.kind === 'tag' ? 'tag' : 'link' });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }

  const nodes: KnowledgeGraphNode[] = docs.map((d) => ({
    id: docNodeId(d.path),
    kind: 'doc' as const,
    label: d.title,
    path: d.path,
    tags: d.tags,
    degree: degree.get(docNodeId(d.path)) ?? 0,
  }));

  for (const tag of [...usedTags].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
    nodes.push({
      id: tagNodeId(tag),
      kind: 'tag',
      label: tag,
      path: null,
      tags: [tag],
      degree: degree.get(tagNodeId(tag)) ?? 0,
    });
  }

  return { nodes, edges };
}

/**
 * 节点详情：文档节点给出出链/入链/共享标签文档；标签节点给出该标签下文档。
 * 节点不存在返回 null。
 */
export function nodeDetail(id: string): KnowledgeNodeDetail | null {
  ensureKnowledgeSchema();
  const raw = String(id ?? '');
  if (raw.startsWith(TAG_PREFIX)) {
    const tag = raw.slice(TAG_PREFIX.length).trim();
    if (!tag) return null;
    const docs = all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE tags LIKE ? ESCAPE '\\' ORDER BY mtime DESC`, [
      `%"${tag.replace(/["\\]/g, '\\$&')}"%`,
    ]).map(rowToSummary);
    if (docs.length === 0) return null;
    return {
      node: { id: tagNodeId(tag), kind: 'tag', label: tag, path: null, tags: [tag], degree: docs.length },
      outLinks: [],
      inLinks: [],
      sharedTagDocs: docs,
    };
  }

  const path = normalizeRel(raw.startsWith(DOC_PREFIX) ? raw.slice(DOC_PREFIX.length) : raw);
  const row = get<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE path = ?`, [path]);
  if (!row) return null;
  const summary = rowToSummary(row);

  const outPaths = all<{ target: string }>(`SELECT target FROM ${KT.links} WHERE source_path = ? AND kind = 'link'`, [path]).map((r) => r.target);
  const inPaths = all<{ source_path: string }>(`SELECT source_path FROM ${KT.links} WHERE target = ? AND kind = 'link'`, [path]).map((r) => r.source_path);

  // 共享标签文档：至少共享一个标签的其他文档
  const shared = new Map<string, KnowledgeDocSummary>();
  for (const tag of summary.tags) {
    const docs = all<KnowledgeDocRow>(`SELECT * FROM ${KT.docs} WHERE tags LIKE ? ESCAPE '\\'`, [`%"${tag.replace(/["\\]/g, '\\$&')}"%`]);
    for (const d of docs) {
      if (d.path === path) continue;
      shared.set(d.path, rowToSummary(d));
    }
  }

  const degree = outPaths.length + inPaths.length + summary.tags.length;
  return {
    node: { id: docNodeId(path), kind: 'doc', label: summary.title, path, tags: summary.tags, degree },
    outLinks: summariesOf(outPaths),
    inLinks: summariesOf(inPaths),
    sharedTagDocs: [...shared.values()].sort((a, b) => (b.mtime ?? '').localeCompare(a.mtime ?? '')),
  };
}
