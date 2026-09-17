import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type KnowledgeDirInfo, type KnowledgeGraphData, type KnowledgeGraphEdge, type KnowledgeNodeDetail, type KnowledgePresetEntry, type KnowledgeStatus, type KnowledgeTagInfo } from '@workbench/shared';
import { VaultConfigModal } from './VaultConfigModal.tsx';
import { KnowledgeSidebar } from './KnowledgeSidebar.tsx';
import { Badge, Btn, Empty, Modal, ModalFooter, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { KB_EMPTY_STATES } from './kbEmpty.ts';
import { dirDisplayName } from './dirDisplayName.ts';
import { drawGraph, hitTest as kernelHitTest, layoutInitial, screenToWorld as kernelScreenToWorld, type GraphSimNode, type GraphView } from './graphCanvas.ts';

/** 模拟节点（布局/视觉状态由渲染内核 graphCanvas.ts 提供，此处仅别名） */
type SimNode = GraphSimNode;

/** 目录树节点（由 flat dirs 列表构建，用于左树渲染） */
interface DirTreeNode {
  dir: string;
  count: number;
  depth: number;
  children: DirTreeNode[];
}

/** 将 flat 目录列表（含 '' 根）构建为嵌套树；跳过根目录（由「全部」行表达） */
function buildDirTree(items: KnowledgeDirInfo[]): DirTreeNode[] {
  const map = new Map<string, DirTreeNode>();
  for (const it of items) {
    if (it.dir === '') continue;
    map.set(it.dir, { dir: it.dir, count: it.count, depth: it.dir.split('/').length - 1, children: [] });
  }
  const roots: DirTreeNode[] = [];
  for (const it of items) {
    if (it.dir === '') continue;
    const node = map.get(it.dir)!;
    const i = it.dir.lastIndexOf('/');
    const parent = i < 0 ? '' : it.dir.slice(0, i);
    if (parent === '') roots.push(node);
    else map.get(parent)?.children.push(node);
  }
  return roots;
}

/** 目录展示名（意见#5：走中文显示名映射，未收录的段回退原段名；真实路径仍可在 tooltip / 设置中查看） */
function dirLabel(dir: string): string {
  return dirDisplayName(dir);
}

/** 已激活筛选条件 chip（可单独移除） */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span
      className="qs-clickable inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[12px]"
      style={{ borderColor: 'var(--color-line-strong)', background: 'var(--color-sunken)', color: 'var(--color-ink)' }}
    >
      {label}
      <button type="button" className="leading-none opacity-60 hover:opacity-100" aria-label={`移除 ${label}`} onClick={onRemove}>
        ×
      </button>
    </span>
  );
}

/** 目录树递归行：缩进表达层级，可展开/折叠，单选高亮 */
function DirTreeRow({
  node,
  expanded,
  activeDir,
  onToggle,
  onSelect,
}: {
  node: DirTreeNode;
  expanded: Record<string, boolean>;
  activeDir: string | null;
  onToggle: (dir: string) => void;
  onSelect: (dir: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const open = expanded[node.dir] ?? false;
  const active = activeDir === node.dir;
  return (
    <Fragment>
      <div className="flex items-center" style={{ paddingLeft: node.depth * 12 }}>
        {hasChildren ? (
          <button type="button" className="qs-clickable w-4 shrink-0 text-center text-[11px]" onClick={() => onToggle(node.dir)} aria-label={open ? '折叠' : '展开'}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          className={`qs-nav-item min-w-0 flex-1 text-left ${active ? 'active' : ''}`}
          onClick={() => onSelect(node.dir)}
          title={node.dir}
        >
          <span className="min-w-0 flex-1 truncate">{dirLabel(node.dir)}</span>
          <span className="qs-meta tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{node.count}</span>
        </button>
      </div>
      {open && hasChildren
        ? node.children.map((c) => (
            <DirTreeRow key={c.dir} node={c} expanded={expanded} activeDir={activeDir} onToggle={onToggle} onSelect={onSelect} />
          ))
        : null}
    </Fragment>
  );
}

/**
 * 知识星图（design.md D4）：自绘 canvas 力导向布局，不引入重型图库。
 * 节点：文档（圆）/ 标签（菱形）；边：文档间链接（实线）/ 文档-标签归属（虚线）。
 * 交互：滚轮缩放、空白拖拽平移、节点拖拽、悬停详情、点击查看关联、搜索定位高亮、点击关联跳转原文。
 */
export function KnowledgeGraphView() {
  // P2·F1：节点详情「阅读原文」走预览弹窗（就地看，不离开星图）；双击仍跳知识库深度阅读
  const { openKbDoc, openDocPreview, kbNodeId, setKbNodeId } = useWorkbench();
  const [graph, setGraph] = useState<KnowledgeGraphData | null>(null);
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null);
  const [hover, setHover] = useState<{ node: SimNode; sx: number; sy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** 缩放百分比显示（与 viewRef.zoom 同步；滚轮/按钮/适配/重置视图后均更新） */
  const [zoomPct, setZoomPct] = useState(100);
  /** 左树目录数据（GET /api/knowledge/dirs）与标签数据（GET /api/knowledge/tags） */
  const [dirs, setDirs] = useState<KnowledgeDirInfo[]>([]);
  const [tagInfos, setTagInfos] = useState<KnowledgeTagInfo[]>([]);
  /** 重点目录（P1·6.10）：用户可增删改，来自知识库设置，两页共用 */
  const [presetEntries, setPresetEntries] = useState<KnowledgePresetEntry[]>([]);
  /** 知识库设置弹窗（P1·6.1：与知识库页同一个弹窗） */
  const [configOpen, setConfigOpen] = useState(false);
  /** 供设置弹窗展示用（root / range / indexing） */
  const [kbStatus, setKbStatus] = useState<KnowledgeStatus | null>(null);
  /** P1·5.7：左树折叠（与知识库页同一交互） */
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /** report-driven-fixes 2.13（D-31）：标签多选弹窗开关 */
  const [tagModalOpen, setTagModalOpen] = useState(false);
  /** 目录树展开状态（目录路径 → 是否展开；默认展开所有含子目录的节点） */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /**
   * 图谱透镜过滤（仅影响前端渲染集合，3.4/7 重构后）：
   * - dir：目录单选（含子孙目录）；null = 不过滤目录
   * - tags：标签多选，与目录维度取交集（"产品资料里标注了主推的"）
   * - islandOnly：只显示孤岛文档（连通性健康检查，独立开关）
   */
  const [filters, setFilters] = useState<{ dir: string | null; tags: string[]; islandOnly: boolean }>({ dir: null, tags: [], islandOnly: false });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** canvas 元素用 state 持有：数据到达后 canvas 才挂载，需要触发绘制循环重新绑定 */
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  /** 模拟节点与视图变换存 ref，避免每帧触发 React 渲染 */
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<KnowledgeGraphEdge[]>([]);
  const indexRef = useRef(new Map<string, SimNode>());
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const alphaRef = useRef(1);
  const dragRef = useRef<{ mode: 'none' | 'node' | 'pan'; id?: string; lastX: number; lastY: number; moved: boolean }>({ mode: 'none', lastX: 0, lastY: 0, moved: false });
  const sizeRef = useRef({ w: 0, h: 0 });
  const rafRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [gRes, dirsRes, tagsRes, statusRes] = await Promise.all([api.kbGraph(), api.kbDirs(), api.kbTags(), api.kbStatus()]);
      const g = gRes.graph;
      setGraph(g);
      setDirs(dirsRes.dirs);
      setTagInfos(tagsRes.tags);
      // P1·6.10：重点目录取自设置（用户可增删改），与知识库页同一份数据
      setPresetEntries(statusRes.status.presetEntries ?? []);
      setKbStatus(statusRes.status);
      // 默认展开所有含子目录的节点（叶子目录默认不展开）
      const paths = dirsRes.dirs.map((d) => d.dir);
      const exp: Record<string, boolean> = {};
      for (const d of dirsRes.dirs) {
        if (d.dir && paths.some((p) => p.startsWith(`${d.dir}/`))) exp[d.dir] = true;
      }
      setExpanded(exp);
      // 初始化布局：由渲染内核提供（文档环形 + 标签散布），避免全部重叠
      nodesRef.current = layoutInitial(g.nodes);
      edgesRef.current = g.edges;
      indexRef.current = new Map(nodesRef.current.map((n) => [n.id, n]));
      viewRef.current = { zoom: 1, panX: 0, panY: 0 };
      setZoomPct(100);
      alphaRef.current = 1;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 选中节点 → 拉取关联详情
  useEffect(() => {
    if (!kbNodeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void api
      .kbNode(kbNodeId)
      .then((r) => {
        if (!cancelled) setDetail(r.detail);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [kbNodeId]);

  // 选中节点变化 → 标记邻居（视觉聚焦）
  useEffect(() => {
    const nodes = nodesRef.current;
    const idx = indexRef.current;
    for (const n of nodes) n.neighbor = false;
    if (!kbNodeId) return;
    for (const e of edgesRef.current) {
      if (e.source === kbNodeId) {
        const t = idx.get(e.target);
        if (t) t.neighbor = true;
      }
      if (e.target === kbNodeId) {
        const s = idx.get(e.source);
        if (s) s.neighbor = true;
      }
    }
    alphaRef.current = Math.max(alphaRef.current, 0.25);
  }, [kbNodeId, graph]);

  /** 力导向一步（斥力 + 边弹簧 + 向心力 + 阻尼） */
  const simulate = useCallback(() => {
    const nodes = nodesRef.current;
    if (alphaRef.current <= 0.005) return;
    const alpha = alphaRef.current;
    const k = 0.02 * alpha;
    const REPULSION = 2400;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = (REPULSION / d2) * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
      // 向心力：避免飘散
      a.vx -= a.x * 0.0012 * alpha;
      a.vy -= a.y * 0.0012 * alpha;
    }

    const idx = indexRef.current;
    for (const e of edgesRef.current) {
      const s = idx.get(e.source);
      const t = idx.get(e.target);
      if (!s || !t) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const rest = e.kind === 'tag' ? 90 : 130;
      const f = ((d - rest) / d) * 0.06 * alpha;
      const fx = dx * f;
      const fy = dy * f;
      s.vx += fx;
      s.vy += fy;
      t.vx -= fx;
      t.vy -= fy;
    }

    for (const n of nodes) {
      if (n.pinned) continue;
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx * k * 8;
      n.y += n.vy * k * 8;
    }
    alphaRef.current = alpha * 0.985;
  }, []);

  /**
   * 收敛「设置 zoom/pan」为单一入口（3.2）：clamp zoom 0.25–3 后写 viewRef，
   * 并同步百分比显示。滚轮缩放、按钮缩放、适配、重置视图均经此函数。
   */
  const applyView = useCallback((next: Partial<GraphView>) => {
    const prev = viewRef.current;
    const zoom = Math.min(3, Math.max(0.25, next.zoom ?? prev.zoom));
    viewRef.current = { zoom, panX: next.panX ?? prev.panX, panY: next.panY ?? prev.panY };
    setZoomPct(Math.round(zoom * 100));
  }, []);

  /**
   * 当前过滤条件下的可见节点（3.4 图谱透镜）：
   * - 目录：文档目录等于所选目录或其子孙目录（与 listDocsByDir 递归语义一致，dir = 路径去掉文件名）
   * - 标签：声明该标签的文档 + 该标签节点（比较前 trim）
   * - 孤立：'linked' = 至少一条 kind==='link' 文档间链接边；'island' = isolated === true 的文档
   * - 交集：三维度同时生效取交集
   * - 标签节点：目录/孤岛过滤下保留「至少被一个可见文档使用的标签节点」；标签过滤下仅保留该标签节点
   */
  const getVisibleNodes = useCallback((): SimNode[] => {
    const all = nodesRef.current;
    const { dir, tags, islandOnly } = filters;
    if (!dir && tags.length === 0 && !islandOnly) return all;
    let docs = all.filter((n) => n.kind === 'doc');
    if (dir) {
      // 目录单选：命中所选目录或其子孙目录的文档
      docs = docs.filter((d) => {
        const p = d.path ?? '';
        const i = p.lastIndexOf('/');
        const dd = i < 0 ? '' : p.slice(0, i);
        return dd === dir || dd.startsWith(`${dir}/`);
      });
    }
    if (tags.length > 0) {
      // 标签多选：文档命中任一所选标签（标签维度内取并集），再与目录维度取交集
      const sel = new Set(tags.map((t) => t.trim()));
      docs = docs.filter((d) => d.tags.some((x) => sel.has(x.trim())));
    }
    if (islandOnly) {
      docs = docs.filter((d) => d.isolated === true);
    }
    // 标签节点：标签过滤下仅保留所选标签节点；否则保留被可见文档使用的标签节点
    let tagNodes: SimNode[] = [];
    if (tags.length > 0) {
      const sel = new Set(tags.map((t) => t.trim()));
      tagNodes = all.filter((n) => n.kind === 'tag' && sel.has(n.label.trim()));
    } else {
      const used = new Set<string>();
      for (const d of docs) for (const t0 of d.tags) used.add(t0.trim());
      tagNodes = all.filter((n) => n.kind === 'tag' && used.has(n.label.trim()));
    }
    return [...docs, ...tagNodes];
  }, [filters]);

  /** 当前过滤条件下的可见边：仅两端均可见时保留（3.4） */
  const getVisibleEdges = useCallback((): KnowledgeGraphEdge[] => {
    const ids = new Set(getVisibleNodes().map((n) => n.id));
    return edgesRef.current.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [getVisibleNodes]);

  /** 适配（3.3）：只作用于可见节点——包围盒（含内边距）→ zoom = clamp(min(w/bw, h/bh)) → pan 使包围盒中心对齐画布中心 */
  const fitView = useCallback(() => {
    const visible = getVisibleNodes();
    if (visible.length === 0) return;
    const { w, h } = sizeRef.current;
    const pad = 40;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of visible) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const zoom = Math.min(3, Math.max(0.25, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
    applyView({ zoom, panX: -(minX + maxX) / 2, panY: -(minY + maxY) / 2 });
    alphaRef.current = Math.max(alphaRef.current, 0.3);
  }, [applyView, getVisibleNodes]);

  const zoomIn = useCallback(() => applyView({ zoom: viewRef.current.zoom * 1.2 }), [applyView]);
  const zoomOut = useCallback(() => applyView({ zoom: viewRef.current.zoom / 1.2 }), [applyView]);

  /** 修改过滤维度（单选目录切换 / 标签勾选 / 孤岛开关）；预设高亮改为派生，无需手动取消 */
  const updateFilters = (next: Partial<{ dir: string | null; tags: string[]; islandOnly: boolean }>) => {
    setHover(null);
    setFilters((prev) => ({ ...prev, ...next }));
  };

  /** 清除全部过滤 → 图谱恢复全量 */
  const clearFilters = () => {
    setHover(null);
    setFilters({ dir: null, tags: [], islandOnly: false });
  };

  /** 绘制一帧（渲染内核 graphCanvas.drawGraph；主视图与缩略预览共用同一绘制） */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 过滤只作用于前端渲染集合：先算可见 nodes/edges 再交给渲染内核（被过滤节点不参与绘制）
    drawGraph(ctx, {
      nodes: getVisibleNodes(),
      edges: getVisibleEdges(),
      view: viewRef.current,
      size: sizeRef.current,
      selectedId: kbNodeId,
      zoom: viewRef.current.zoom,
    });
  }, [kbNodeId, getVisibleNodes, getVisibleEdges]);

  /** 主循环：持续模拟 + 绘制，直到冷却且无交互（依赖 canvasEl：canvas 挂载后才启动） */
  useEffect(() => {
    const canvas = canvasEl;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(280, Math.floor(rect.height));
      sizeRef.current = { w, h };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const loop = () => {
      simulate();
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [canvasEl, simulate, draw]);

  /**
   * 初始自动适配（P0：星图首屏偏移，画布约 60% 空白）。
   * 双前置条件：① 图谱数据与 canvas 均已就绪；② sizeRef 已有真实尺寸（由上面的主循环 effect 的 resize() 写入）。
   * 只自动执行一次（autoFitRef）：此后用户的手动缩放/平移不被覆盖，过滤变化与数据刷新也不重置视图。
   */
  const autoFitRef = useRef(false);
  useEffect(() => {
    if (autoFitRef.current) return;
    if (!graph || !canvasEl) return;
    if (sizeRef.current.w === 0 || sizeRef.current.h === 0) return;
    autoFitRef.current = true;
    fitView();
  }, [graph, canvasEl, fitView]);

  /** 屏幕坐标 → 世界坐标（渲染内核） */
  const screenToWorld = useCallback((sx: number, sy: number) => kernelScreenToWorld(sx, sy, viewRef.current, sizeRef.current), []);

  /** 命中测试（渲染内核；只遍历可见节点，被过滤节点不参与命中/悬停） */
  const hitTest = useCallback((sx: number, sy: number): SimNode | null => kernelHitTest(sx, sy, getVisibleNodes(), viewRef.current, sizeRef.current), [getVisibleNodes]);

  const localPos = (e: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localPos(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const node = hitTest(x, y);
    if (node) {
      node.pinned = true;
      dragRef.current = { mode: 'node', id: node.id, lastX: x, lastY: y, moved: false };
    } else {
      dragRef.current = { mode: 'pan', lastX: x, lastY: y, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localPos(e);
    const drag = dragRef.current;
    if (drag.mode === 'node' && drag.id) {
      const node = indexRef.current.get(drag.id);
      if (node) {
        const w = screenToWorld(x, y);
        node.x = w.x;
        node.y = w.y;
        node.vx = 0;
        node.vy = 0;
        drag.moved = true;
        alphaRef.current = Math.max(alphaRef.current, 0.3);
      }
      return;
    }
    if (drag.mode === 'pan') {
      const { zoom } = viewRef.current;
      viewRef.current = { ...viewRef.current, panX: viewRef.current.panX + (x - drag.lastX) / zoom, panY: viewRef.current.panY + (y - drag.lastY) / zoom };
      drag.lastX = x;
      drag.lastY = y;
      drag.moved = true;
      return;
    }
    const node = hitTest(x, y);
    setHover(node ? { node, sx: x, sy: y } : null);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const { x, y } = localPos(e);
    if (drag.mode === 'node' && drag.id) {
      const node = indexRef.current.get(drag.id);
      if (node) node.pinned = false;
      // 未拖动 → 视为点击选中
      if (!drag.moved) setKbNodeId(drag.id);
    } else if (drag.mode === 'pan' && !drag.moved) {
      // 点击空白处取消选中
      if (!hitTest(x, y)) setKbNodeId(null);
    }
    dragRef.current = { mode: 'none', lastX: 0, lastY: 0, moved: false };
  };

  /** 双击节点进入文档阅读（3.8）：命中文档节点调用 openKbDoc 切到阅读视图；标签节点不跳转（保持选中与详情） */
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = localPos(e);
    const node = hitTest(x, y);
    if (node && node.kind === 'doc' && node.path) openKbDoc(node.path);
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const view = viewRef.current;
    const before = screenToWorld(sx, sy);
    // 滚轮与按钮共用同一 clamp 边界（applyView 内 clamp 0.25–3）
    applyView({ zoom: view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2) });
    const after = screenToWorld(sx, sy);
    // 保持光标下的世界点不动
    applyView({ panX: viewRef.current.panX + (after.x - before.x), panY: viewRef.current.panY + (after.y - before.y) });
  };

  /** 关键词搜索定位：高亮命中节点并居中到首个命中 */
  const locate = (q: string) => {
    const needle = q.trim().toLowerCase();
    let first: SimNode | null = null;
    for (const n of nodesRef.current) {
      const hit = needle !== '' && (n.label.toLowerCase().includes(needle) || (n.path ?? '').toLowerCase().includes(needle));
      n.highlight = hit;
      if (hit && !first) first = n;
    }
    setMatchCount(needle === '' ? null : nodesRef.current.filter((n) => n.highlight).length);
    if (first) {
      viewRef.current = { ...viewRef.current, panX: -first.x, panY: -first.y };
      setKbNodeId(first.id);
    }
    alphaRef.current = Math.max(alphaRef.current, 0.2);
  };

  const resetView = useCallback(() => {
    applyView({ zoom: 1, panX: 0, panY: 0 });
    alphaRef.current = 1;
    for (const n of nodesRef.current) n.highlight = false;
    setMatchCount(null);
  }, [applyView]);

  const nodeCount = graph?.nodes.length ?? 0;
  const hasData = useMemo(() => (graph ? graph.nodes.length > 0 : false), [graph]);
  /** 孤岛计数（isolated 文档节点），用于左树孤岛开关文案 */
  const islandCount = graph?.nodes.filter((n) => n.kind === 'doc' && n.isolated === true).length ?? 0;
  /** 目录列表 → 嵌套树（左树渲染用） */
  const dirTree = useMemo(() => buildDirTree(dirs), [dirs]);
  /** 已显示 X / 共 Y 个节点 */
  const visibleCount = useMemo(() => (hasData ? getVisibleNodes().length : 0), [hasData, getVisibleNodes, graph]);
  /** 过滤是否生效（目录 / 标签 / 孤岛 任一维度） */
  const filterActive = filters.dir != null || filters.tags.length > 0 || filters.islandOnly;
  /** 过滤后无可见节点 → 画布区空态（不渲染 canvas） */
  const showFilterEmpty = hasData && visibleCount === 0 && filterActive;

  // 3.5 过滤可见性贯通：每次过滤变化后，若当前选中节点不在可见节点集合中 → 清空选中与详情
  useEffect(() => {
    if (!kbNodeId) return;
    const ids = new Set(getVisibleNodes().map((n) => n.id));
    if (!ids.has(kbNodeId)) setKbNodeId(null);
  }, [kbNodeId, getVisibleNodes, graph]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* 新3：页面大标题字号统一为 22px（与知识库页 / 每日热点页一致） */}
          <h2 className="font-display text-[22px] font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            知识星图
          </h2>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <input
            className="qs-input w-[180px]"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              locate(e.target.value);
            }}
            placeholder="在图谱中定位…"
            aria-label="搜索节点"
          />
          {matchCount != null ? <Badge tone={matchCount > 0 ? 'signal' : 'no'}>命中 {matchCount}</Badge> : null}
          <Btn size="sm" onClick={() => void load()} loading={loading}>
            刷新
          </Btn>
          {/* P1·6.1：知识库设置入口（与知识库页同一弹窗） */}
          <Btn size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>
            知识库设置
          </Btn>
        </div>
      </div>

      {error ? (
        <p className="qs-meta" style={{ color: 'var(--color-danger)' }}>
          ● {error}
        </p>
      ) : null}

      {hasData && filterActive ? (
        /* 已激活筛选标签条（7c）：可单独移除任一维度，一键清除全部 */
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
          <span className="qs-meta shrink-0">已激活筛选</span>
          {filters.dir != null ? (
            <FilterChip label={`目录：${dirLabel(filters.dir)}`} onRemove={() => updateFilters({ dir: null })} />
          ) : null}
          {filters.tags.map((t) => (
            <FilterChip key={t} label={`标签：${t}`} onRemove={() => updateFilters({ tags: filters.tags.filter((x) => x !== t) })} />
          ))}
          {/* report-driven-fixes 0.10：孤岛筛选的「仅孤岛」chip 界面隐藏（逻辑保留，UI 已无入口可触发） */}
          <Btn size="sm" variant="ghost" onClick={clearFilters}>清除全部</Btn>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左树：目录树 + 重点目录 + 标签多选 + 孤岛开关（7b）
            P1·5.7：容器与折叠控件改用公共 KnowledgeSidebar（与知识库页同一位置与交互） */}
        <KnowledgeSidebar
          open={sidebarOpen}
          title="目录"
          onToggle={() => setSidebarOpen(false)}
          onExpand={() => setSidebarOpen(true)}
        >
          <button type="button" className={`qs-nav-item w-full text-left ${filters.dir == null ? 'active' : ''}`} onClick={() => updateFilters({ dir: null })}>
            <span className="flex-1 truncate">全部文档</span>
            <span className="qs-meta tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{graph?.nodes.filter((n) => n.kind === 'doc').length ?? 0}</span>
          </button>
          <div className="mb-3 mt-0.5">
            {dirTree.map((d) => (
              <DirTreeRow
                key={d.dir}
                node={d}
                expanded={expanded}
                activeDir={filters.dir}
                onToggle={(dir) => setExpanded((prev) => ({ ...prev, [dir]: !(prev[dir] ?? false) }))}
                onSelect={(dir) => updateFilters({ dir: filters.dir === dir ? null : dir })}
              />
            ))}
          </div>

          {/* P1·意见#8 / 6.10：重点目录（原名「快捷」）——用户可增删改，与知识库页共用同一份数据 */}
          <div className="qs-meta mb-1">重点目录</div>
          <div className="mb-3 flex flex-col gap-0.5">
            {presetEntries.length === 0 ? (
              <span className="qs-meta px-1" style={{ color: 'var(--color-ink-faint)' }}>
                暂无重点目录 · 到「知识库设置」添加
              </span>
            ) : (
              presetEntries.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`qs-nav-item text-left ${filters.dir === p.dir ? 'active' : ''}`}
                  onClick={() => {
                    setHover(null);
                    setFilters((prev) => ({ ...prev, dir: filters.dir === p.dir ? null : p.dir }));
                  }}
                  title={`按「${p.dir}」过滤`}
                >
                  <span className="flex-1 truncate">★ {p.label}</span>
                </button>
              ))
            )}
          </div>

          {/* report-driven-fixes 2.13（D-31）：标签多选从内嵌 max-h 长列表改为弹窗选择，左栏不再被长列表撑高 */}
          <div className="qs-meta mb-1">标签（多选）</div>
          <button
            type="button"
            className="qs-nav-item"
            onClick={() => setTagModalOpen(true)}
            aria-expanded={false}
            title="在弹窗中勾选标签过滤"
          >
            <span className="flex-1 truncate">
              {filters.tags.length > 0 ? `已选 ${filters.tags.length} 个标签` : '选择标签'}
            </span>
            <span aria-hidden="true" className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
              编辑 ▸
            </span>
          </button>

          {/* report-driven-fixes 0.10：孤岛开关界面隐藏（代码保留——filters.islandOnly 逻辑与 islandCount 仍保留，
              仅不再提供 UI 入口；过滤已激活条里若出现孤岛维度也不会再显示「仅孤岛」chip） */}
        </KnowledgeSidebar>

        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          <div ref={wrapRef} className="qs-card relative min-h-0 flex-1 overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
            {loading && !graph ? (
              <div className="flex h-full items-center justify-center">
                <Spinner label="知识星图加载中…" />
              </div>
            ) : !hasData ? (
              // 4.4：无数据时渲染空图提示（文案与总览带缩略预览同源 kbEmpty.ts）
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <Empty text={KB_EMPTY_STATES.graphEmpty.text} hint={KB_EMPTY_STATES.graphEmpty.hint} emptyKey={KB_EMPTY_STATES.graphEmpty.key} />
              </div>
            ) : showFilterEmpty ? (
              // 3.6：过滤后无可见节点（或预设无匹配）→ 空态 + 可点击清除过滤，不渲染 canvas
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <Empty
                  text={filters.dir != null ? '所选目录在当前知识库中没有匹配资料' : '当前过滤条件下没有节点'}
                  hint={filters.dir != null ? '检查该目录是否与 Vault 结构一致，或清除过滤' : '放宽或清除过滤条件'}
                  emptyKey={filters.dir != null ? 'graph-preset-empty' : 'graph-filter-empty'}
                />
                <Btn size="sm" variant="ghost" onClick={clearFilters}>
                  清除过滤
                </Btn>
              </div>
            ) : (
              <>
                <canvas
                  ref={(el) => {
                    canvasRef.current = el;
                    setCanvasEl(el);
                  }}
                  className="block h-full w-full cursor-grab active:cursor-grabbing"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onDoubleClick={onDoubleClick}
                  onPointerLeave={() => setHover(null)}
                  onWheel={onWheel}
                  role="img"
                  aria-label="知识图谱"
                />
                {/* 3.2 缩放控件：画布右下角，百分比 + 放大 / 缩小 / 适配 */}
                <div
                  className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-[4px] border px-2 py-1"
                  style={{ borderColor: 'var(--color-line-strong)', background: 'var(--color-surface)' }}
                >
                  <span className="qs-meta tabular w-[42px] text-center">{zoomPct}%</span>
                  <Btn size="sm" variant="ghost" onClick={zoomOut} title="缩小">
                    缩小
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={zoomIn} title="放大">
                    放大
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={fitView} title="适配全部可见节点">
                    适配
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={resetView} title="重置缩放与平移">
                    重置
                  </Btn>
                </div>
              </>
            )}
            {hover && hasData && !showFilterEmpty ? (
              <div
                className="pointer-events-none absolute z-10 max-w-[260px] rounded-[4px] border px-2.5 py-1.5 text-[12px] shadow-sm"
                style={{ left: Math.min(hover.sx + 12, (sizeRef.current.w || 0) - 200), top: hover.sy + 12, borderColor: 'var(--color-line-strong)', background: 'var(--color-surface)' }}
              >
                <div className="font-medium">{hover.node.label}</div>
                <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-faint)' }}>
                  {hover.node.kind === 'doc' ? '文档' : '标签'} · 关联 {hover.node.degree}
                </div>
                {hover.node.tags.length > 0 ? (
                  <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-soft)' }}>
                    标签 {hover.node.tags.slice(0, 4).join(' / ')}
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* 图例（7c：操作说明移入画布角落） */}
            {hasData && !showFilterEmpty ? (
              <div
                className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-0.5 rounded-[4px] border px-2 py-1 text-[11px]"
                style={{ borderColor: 'var(--color-line-strong)', background: 'var(--color-surface)' }}
              >
                <span className="qs-meta">圆形=文档 · 菱形=标签 · 虚线=标签归属</span>
                <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                  拖拽平移 · 滚轮缩放 · 双击打开 · 已显示 {visibleCount}/{nodeCount}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* 节点详情（36：仅选中节点时展开，未选中时收起把宽度让给画布） */}
        {detail ? (
        <aside className="qs-card h-fit w-[280px] shrink-0 p-4">
          <h3 className="font-display mb-3 text-[15px] font-semibold">节点详情</h3>
          <div className="space-y-3">
              <div>
                <Badge tone={detail.node.kind === 'doc' ? 'signal' : 'default'}>{detail.node.kind === 'doc' ? '文档' : '标签'}</Badge>
                <div className="mt-1.5 text-[13px] font-medium leading-snug">{detail.node.label}</div>
                {detail.node.path ? (
                  <button
                    type="button"
                    className="qs-meta mt-1 cursor-pointer text-left hover:underline"
                    style={{ color: 'var(--color-signal)' }}
                    onClick={() => detail.node.path && openDocPreview(detail.node.path)}
                    title="预览全文（弹窗，不离开知识星图）"
                  >
                    {detail.node.path} · 查看原文 ↗
                  </button>
                ) : null}
                {detail.node.tags.length > 0 ? (
                  <div className="qs-meta mt-1" style={{ color: 'var(--color-ink-faint)' }}>
                    标签 {detail.node.tags.join(' / ')}
                  </div>
                ) : null}
              </div>

              {(
                [
                  ['指向的文档（出链）', detail.outLinks],
                  ['被指向（入链）', detail.inLinks],
                  ['共享标签的文档', detail.sharedTagDocs],
                ] as const
              ).map(([label, list]) => (
                <div key={label}>
                  <div className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>
                    {label} · {list.length}
                  </div>
                  {list.length === 0 ? (
                    <div className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                      无
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {list.slice(0, 12).map((d) => (
                        <button
                          key={d.path}
                          type="button"
                          className="qs-nav-item w-full text-left"
                          onClick={() => openDocPreview(d.path)}
                          title={`${d.path}（弹窗预览）`}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px]">{d.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
        </aside>
        ) : null}
      </div>

      {/* P1·6.1：知识库设置（与知识库页共用同一组件/弹窗） */}
      <VaultConfigModal
        open={configOpen}
        status={kbStatus}
        onClose={() => setConfigOpen(false)}
        onSaved={() => void load()}
        onReindex={() => void load()}
      />

      {/* report-driven-fixes 2.13（D-31）：标签多选弹窗（复用统一 Modal，替代左栏内嵌长列表） */}
      <Modal open={tagModalOpen} title="按标签筛选（多选）" onClose={() => setTagModalOpen(false)} width={420}>
        <p className="qs-meta mb-3" style={{ color: 'var(--color-ink-faint)' }}>
          勾选多个标签，与目录过滤取交集；已选 {filters.tags.length} 个
        </p>
        <div className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto pr-1">
          {tagInfos.length === 0 ? (
            <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
              暂无标签
            </div>
          ) : (
            tagInfos.map((t) => {
              const on = filters.tags.includes(t.tag);
              return (
                <label key={t.tag} className={`qs-nav-item cursor-pointer select-none ${on ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    className="h-3 w-3 shrink-0 accent-[var(--color-signal)]"
                    checked={on}
                    onChange={() => updateFilters({ tags: on ? filters.tags.filter((x) => x !== t.tag) : [...filters.tags, t.tag] })}
                  />
                  <span className="flex-1 truncate">{t.tag}</span>
                  <span className="qs-meta tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{t.count}</span>
                </label>
              );
            })
          )}
        </div>
        <ModalFooter>
          <Btn size="sm" variant="ghost" disabled={filters.tags.length === 0} onClick={() => updateFilters({ tags: [] })}>
            清除标签
          </Btn>
          <Btn size="sm" variant="primary" onClick={() => setTagModalOpen(false)}>
            完成
          </Btn>
        </ModalFooter>
      </Modal>
    </div>
  );
}
