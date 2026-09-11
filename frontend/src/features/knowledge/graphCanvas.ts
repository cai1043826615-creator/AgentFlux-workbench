/**
 * 知识星图渲染内核（knowledge-ux 2.1 抽取）：主视图与总览带缩略预览共用的绘制逻辑。
 *
 * 设计（design.md D2）：
 * - `layoutInitial(nodes)`：确定性初始布局（文档环形 + 标签散布），主视图与缩略图共用。
 * - `drawGraph(ctx, opts)`：单帧绘制（边 + 节点 + 标签文字），不包含力导向模拟。
 * - 纯函数、无 DOM 依赖：主视图每帧 rAF 调用；缩略图静态调用一次（不跑模拟、不绑交互）。
 * 交互（拖拽/滚轮/缩放/过滤/双击）全部留在调用方（KnowledgeGraphView），此处只负责「画」。
 */
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '@workbench/shared';

/** 视图变换（世界坐标 → 屏幕坐标的平移与缩放） */
export interface GraphView {
  zoom: number;
  panX: number;
  panY: number;
}

/** 参与绘制/命中的节点（布局状态 + 视觉状态），由调用方维护并逐帧传入 */
export interface GraphSimNode extends KnowledgeGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 拖拽中锁定位置 */
  pinned: boolean;
  /** 搜索命中高亮 */
  highlight: boolean;
  /** 与当前选中节点直接相连 */
  neighbor: boolean;
}

export interface GraphSize {
  w: number;
  h: number;
}

/** 文档节点半径（按 degree 增长，上限 16） */
export const DOC_RADIUS = (degree: number): number => Math.min(16, 5 + Math.sqrt(degree) * 2.2);
/** 标签节点半径（按 degree 增长，上限 11） */
export const TAG_RADIUS = (degree: number): number => Math.min(11, 4 + Math.sqrt(degree) * 1.6);

/** 节点半径（含缩放钳制，与绘制/命中一致） */
export function nodeRadius(n: Pick<KnowledgeGraphNode, 'kind' | 'degree'>, zoom: number): number {
  const base = n.kind === 'doc' ? DOC_RADIUS(n.degree) : TAG_RADIUS(n.degree);
  return Math.max(2.5, base * Math.min(1.4, Math.max(0.6, zoom)));
}

/**
 * 初始布局：文档节点环形排布 + 标签节点内圈散布（确定性，避免全部重叠）。
 * 返回带布局状态的新节点数组（不改动入参）。
 */
export function layoutInitial(nodes: KnowledgeGraphNode[]): GraphSimNode[] {
  const docs = nodes.filter((n) => n.kind === 'doc');
  const tags = nodes.filter((n) => n.kind === 'tag');
  return [
    ...docs.map((n, i) => {
      const a = (i / Math.max(1, docs.length)) * Math.PI * 2;
      const r = docs.length > 1 ? 150 + (i % 3) * 30 : 0;
      return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, pinned: false, highlight: false, neighbor: false };
    }),
    ...tags.map((n, i) => {
      const a = (i / Math.max(1, tags.length)) * Math.PI * 2 + 0.4;
      const r = tags.length > 1 ? 60 + (i % 4) * 22 : 0;
      return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, pinned: false, highlight: false, neighbor: false };
    }),
  ];
}

/** 世界坐标 → 屏幕坐标（画布中心为原点） */
export function toScreen(wx: number, wy: number, view: GraphView, size: GraphSize): { x: number; y: number } {
  return { x: size.w / 2 + (wx + view.panX) * view.zoom, y: size.h / 2 + (wy + view.panY) * view.zoom };
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(sx: number, sy: number, view: GraphView, size: GraphSize): { x: number; y: number } {
  return { x: (sx - size.w / 2) / view.zoom - view.panX, y: (sy - size.h / 2) / view.zoom - view.panY };
}

/** 命中测试：返回距命中点最近的节点（未命中 null）。只遍历传入的节点集（调用方可传过滤后的可见集）。 */
export function hitTest(sx: number, sy: number, nodes: GraphSimNode[], view: GraphView, size: GraphSize): GraphSimNode | null {
  const { x: wx, y: wy } = screenToWorld(sx, sy, view, size);
  let best: GraphSimNode | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    // 命中半径保持与 knowledge-base 既有行为一致（最小 6px，略大于绘制半径便于点击）
    const base = n.kind === 'doc' ? DOC_RADIUS(n.degree) : TAG_RADIUS(n.degree);
    const r = Math.max(6, base * Math.min(1.4, Math.max(0.6, view.zoom)));
    const d = Math.hypot(n.x - wx, n.y - wy);
    if (d <= r + 4 && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

export interface GraphRenderOpts {
  nodes: GraphSimNode[];
  edges: KnowledgeGraphEdge[];
  view: GraphView;
  size: GraphSize;
  /** 当前选中节点 id（null = 无选中）；用于聚焦边/节点与淡化非邻居 */
  selectedId: string | null;
  /** 缩放比例（与 view.zoom 同步；独立入参便于按渲染语义使用，如标签文字阈值） */
  zoom: number;
}

/** 画布背景是否为深色（决定节点/文字是否用亮色系；当前固定浅色主题） */
const DARK = false;

/**
 * 绘制一帧图谱（边 + 节点 + 标签文字）。
 * 假定调用方已设置好 canvas 尺寸与 devicePixelRatio 变换（ctx.setTransform）。
 * 视觉细节与 knowledge-base 既有主视图逐像素一致（抽取不改变渲染）。
 */
export function drawGraph(ctx: CanvasRenderingContext2D, opts: GraphRenderOpts): void {
  const { nodes, edges, view, size, selectedId, zoom } = opts;
  const cx = size.w / 2;
  const cy = size.h / 2;

  // 边：标签归属为虚线，选中节点的直接边聚焦
  for (const e of edges) {
    const s = nodes.find((n) => n.id === e.source);
    const t = nodes.find((n) => n.id === e.target);
    if (!s || !t) continue;
    const sp = toScreen(s.x, s.y, view, size);
    const tp = toScreen(t.x, t.y, view, size);
    const focused = selectedId && (e.source === selectedId || e.target === selectedId);
    ctx.beginPath();
    ctx.setLineDash(e.kind === 'tag' ? [3, 3] : []);
    ctx.lineWidth = focused ? 1.8 : 0.9;
    ctx.strokeStyle = focused ? 'rgba(124,58,237,0.85)' : e.kind === 'tag' ? 'rgba(161,161,170,0.5)' : 'rgba(82,82,91,0.32)';
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 节点
  for (const n of nodes) {
    const p = toScreen(n.x, n.y, view, size);
    const r = nodeRadius(n, zoom);
    const selected = selectedId === n.id;
    const dim = Boolean(selectedId) && !selected && !n.neighbor;

    if (n.highlight) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(124,58,237,0.22)';
      ctx.fill();
    }

    ctx.globalAlpha = dim ? 0.32 : 1;
    if (n.kind === 'doc') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = selected ? '#7c3aed' : n.neighbor ? '#a78bfa' : '#52525b';
      ctx.fill();
      if (selected) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#7c3aed';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // 标签节点：菱形
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - r);
      ctx.lineTo(p.x + r, p.y);
      ctx.lineTo(p.x, p.y + r);
      ctx.lineTo(p.x - r, p.y);
      ctx.closePath();
      ctx.fillStyle = selected ? '#7c3aed' : n.neighbor ? '#c4b5fd' : '#d4d4d8';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#a1a1aa';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 标签文字：文档节点在缩放足够或选中/邻居/高亮时绘制
    if (n.kind === 'doc' && (zoom >= 0.8 || selected || n.neighbor || n.highlight)) {
      ctx.font = `${selected || n.highlight ? '600 ' : ''}11px ui-sans-serif, system-ui, sans-serif`;
      // canvas 不支持 CSS 变量，使用与 --color-ink 一致的字面色值
      ctx.fillStyle = dim ? 'rgba(10,10,10,0.3)' : DARK ? 'rgba(250,250,250,0.9)' : '#0a0a0a';
      ctx.textAlign = 'center';
      ctx.fillText(n.label.length > 12 ? `${n.label.slice(0, 12)}…` : n.label, p.x, p.y + r + 11);
    }
  }
}
