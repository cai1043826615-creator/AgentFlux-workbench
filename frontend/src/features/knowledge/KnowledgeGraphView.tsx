import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KB_GRAPH_PRESETS, type KnowledgeGraphData, type KnowledgeGraphEdge, type KnowledgeGraphIsolationFilter, type KnowledgeGraphPreset, type KnowledgeNodeDetail } from '@workbench/shared';
import { Badge, Btn, Empty, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { KB_EMPTY_STATES } from './kbEmpty.ts';
import { drawGraph, hitTest as kernelHitTest, layoutInitial, screenToWorld as kernelScreenToWorld, type GraphSimNode, type GraphView } from './graphCanvas.ts';

/** 模拟节点（布局/视觉状态由渲染内核 graphCanvas.ts 提供，此处仅别名） */
type SimNode = GraphSimNode;

/**
 * 知识星图（design.md D4）：自绘 canvas 力导向布局，不引入重型图库。
 * 节点：文档（圆）/ 标签（菱形）；边：文档间链接（实线）/ 文档-标签归属（虚线）。
 * 交互：滚轮缩放、空白拖拽平移、节点拖拽、悬停详情、点击查看关联、搜索定位高亮、点击关联跳转原文。
 */
export function KnowledgeGraphView() {
  const { openKbDoc, kbNodeId, setKbNodeId } = useWorkbench();
  const [graph, setGraph] = useState<KnowledgeGraphData | null>(null);
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null);
  const [hover, setHover] = useState<{ node: SimNode; sx: number; sy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** 缩放百分比显示（与 viewRef.zoom 同步；滚轮/按钮/适配/重置视图后均更新） */
  const [zoomPct, setZoomPct] = useState(100);
  /** 图谱透镜过滤（仅影响前端渲染集合）：目录 / 标签 / 孤立状态三维度取交集 */
  const [filters, setFilters] = useState<{ dir: string | null; tag: string | null; isolation: KnowledgeGraphIsolationFilter }>({ dir: null, tag: null, isolation: 'all' });
  /** 当前生效的业务预设 id（null = 无预设；手动修改任一过滤维度时置 null 取消高亮） */
  const [preset, setPreset] = useState<KnowledgeGraphPreset['id'] | null>(null);

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
      const { graph: g } = await api.kbGraph();
      setGraph(g);
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
    const { dir, tag, isolation } = filters;
    if (!dir && !tag && isolation === 'all' && !preset) return all;
    let docs = all.filter((n) => n.kind === 'doc');
    if (dir) {
      const target = dir;
      docs = docs.filter((d) => {
        const p = d.path ?? '';
        const i = p.lastIndexOf('/');
        const dd = i < 0 ? '' : p.slice(0, i);
        return dd === target || dd.startsWith(`${target}/`);
      });
    }
    if (tag) {
      const t = tag.trim();
      docs = docs.filter((d) => d.tags.some((x) => x.trim() === t));
    }
    if (isolation === 'linked') {
      const linked = new Set<string>();
      for (const e of edgesRef.current) {
        if (e.kind === 'link') {
          linked.add(e.source);
          linked.add(e.target);
        }
      }
      docs = docs.filter((d) => linked.has(d.id));
    } else if (isolation === 'island') {
      docs = docs.filter((d) => d.isolated === true);
    }
    let tags: SimNode[] = [];
    if (tag) {
      const t = tag.trim();
      if (docs.length > 0) tags = all.filter((n) => n.kind === 'tag' && n.label.trim() === t);
    } else {
      const used = new Set<string>();
      for (const d of docs) for (const t0 of d.tags) used.add(t0.trim());
      tags = all.filter((n) => n.kind === 'tag' && used.has(n.label.trim()));
    }
    return [...docs, ...tags];
  }, [filters, preset]);

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

  /** 手动修改任一过滤维度 → 预设高亮取消（3.7 预设与手动条件互斥） */
  const updateFilters = (next: Partial<{ dir: string | null; tag: string | null; isolation: KnowledgeGraphIsolationFilter }>) => {
    setHover(null);
    setPreset(null);
    setFilters((prev) => ({ ...prev, ...next }));
  };

  /** 清除全部过滤（含预设）→ 图谱恢复全量 */
  const clearFilters = () => {
    setHover(null);
    setPreset(null);
    setFilters({ dir: null, tag: null, isolation: 'all' });
  };

  /** 解析预设依据目录（3.7）：优先 status.presets（连接设置可改），未配置/未连接时回退共享常量 KB_GRAPH_PRESETS */
  const resolvePresetDir = useCallback(async (id: KnowledgeGraphPreset['id']): Promise<string | undefined> => {
    const fallback = KB_GRAPH_PRESETS.find((p) => p.id === id)?.dir;
    try {
      const { status } = await api.kbStatus();
      const dir = status.presets?.[id];
      return dir && dir.trim() ? dir.trim() : fallback;
    } catch {
      return fallback;
    }
  }, []);

  /** 应用业务预设：覆盖 filters（dir = 预设目录，tag = null，isolation = 'all'）并记录 preset id */
  const applyPreset = useCallback(
    async (id: KnowledgeGraphPreset['id']) => {
      const dir = await resolvePresetDir(id);
      if (!dir) return;
      setHover(null);
      setPreset(id);
      setFilters({ dir, tag: null, isolation: 'all' });
    },
    [resolvePresetDir],
  );

  /** 工具栏「K 孤岛」入口（3.9）：进入仅孤岛过滤态并取消预设高亮 */
  const goIsland = () => {
    setHover(null);
    setPreset(null);
    setFilters((prev) => ({ ...prev, isolation: 'island' }));
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
  /** 3.9 健康度计数：N 页面（文档节点，不含标签）/ M 双链（kind==='link' 边）/ K 孤岛（isolated 文档节点） */
  const docCount = graph?.nodes.filter((n) => n.kind === 'doc').length ?? 0;
  const linkEdgeCount = graph?.edges.filter((e) => e.kind === 'link').length ?? 0;
  const islandCount = graph?.nodes.filter((n) => n.kind === 'doc' && n.isolated === true).length ?? 0;
  /** 3.4 计数：已显示 X / 共 Y 个节点 */
  const visibleCount = useMemo(() => (hasData ? getVisibleNodes().length : 0), [hasData, getVisibleNodes, graph]);
  /** 过滤是否生效（任一维度或预设） */
  const filterActive = filters.dir != null || filters.tag != null || filters.isolation !== 'all' || preset != null;
  /** 3.6 过滤后无可见节点 → 画布区空态（不渲染 canvas） */
  const showFilterEmpty = hasData && visibleCount === 0 && filterActive;
  /** 3.7 当前生效预设名（label 取自共享常量，不散落在视图代码内） */
  const activePresetLabel = preset ? KB_GRAPH_PRESETS.find((p) => p.id === preset)?.label ?? null : null;

  // 3.5 过滤可见性贯通：每次过滤变化后，若当前选中节点不在可见节点集合中 → 清空选中与详情
  useEffect(() => {
    if (!kbNodeId) return;
    const ids = new Set(getVisibleNodes().map((n) => n.id));
    if (!ids.has(kbNodeId)) setKbNodeId(null);
  }, [kbNodeId, getVisibleNodes, graph]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-bold">知识星图</h2>
          <p className="qs-meta mt-1">悬停看关系，点击聚焦邻居，双击进入文档</p>
          <p className="qs-meta mt-1" style={{ color: 'var(--color-ink-faint)' }}>
            节点 {nodeCount} 个 · 关系边 {graph?.edges.length ?? 0} 条 · 圆形=文档，菱形=标签，虚线=标签归属
          </p>
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
          <Btn size="sm" variant="ghost" onClick={resetView}>
            重置视图
          </Btn>
        </div>
      </div>

      {error ? (
        <p className="qs-meta" style={{ color: 'var(--color-danger)' }}>
          ● {error}
        </p>
      ) : null}

      {hasData ? (
        /* 工具栏：交互图例 + 业务预设 + 健康度计数 + 图谱透镜过滤（3.1/3.4/3.7/3.9） */
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
          <span className="qs-meta">拖拽 · 滚轮缩放 · 双击阅读</span>
          <span className="h-3 w-px shrink-0" style={{ background: 'var(--color-line-strong)' }} />
          {KB_GRAPH_PRESETS.map((p) => (
            <Btn key={p.id} size="sm" variant={preset === p.id ? 'signal' : 'ghost'} onClick={() => void applyPreset(p.id)} title={`按 ${p.label} 预设目录过滤`}>
              {p.label}
            </Btn>
          ))}
          {preset && activePresetLabel ? <Badge tone="signal">{activePresetLabel} 生效中</Badge> : null}
          <span className="h-3 w-px shrink-0" style={{ background: 'var(--color-line-strong)' }} />
          <span className="qs-meta">
            {docCount} 页面 / {linkEdgeCount} 双链 /{' '}
            <button
              type="button"
              className="cursor-pointer hover:underline"
              style={{ color: 'var(--color-signal)' }}
              onClick={goIsland}
              title="进入仅孤岛过滤"
            >
              {islandCount} 孤岛
            </button>
          </span>
          <span className="h-3 w-px shrink-0" style={{ background: 'var(--color-line-strong)' }} />
          <input
            className="qs-input w-[150px]"
            placeholder="按目录过滤"
            aria-label="按目录过滤"
            value={filters.dir ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim().replace(/\/+$/, '');
              updateFilters({ dir: v ? v : null });
            }}
          />
          <input
            className="qs-input w-[130px]"
            placeholder="按标签过滤"
            aria-label="按标签过滤"
            value={filters.tag ?? ''}
            onChange={(e) => {
              const v = e.target.value.trim();
              updateFilters({ tag: v ? v : null });
            }}
          />
          <div className="flex items-center gap-1">
            <Btn size="sm" variant={filters.isolation === 'all' ? 'signal' : 'ghost'} onClick={() => updateFilters({ isolation: 'all' })}>
              全部
            </Btn>
            <Btn size="sm" variant={filters.isolation === 'linked' ? 'signal' : 'ghost'} onClick={() => updateFilters({ isolation: 'linked' })}>
              仅有链接
            </Btn>
            <Btn size="sm" variant={filters.isolation === 'island' ? 'signal' : 'ghost'} onClick={() => updateFilters({ isolation: 'island' })}>
              仅孤岛
            </Btn>
          </div>
          <span className="qs-meta tabular">已显示 {visibleCount} / 共 {nodeCount} 个节点</span>
          {filterActive ? (
            <Btn size="sm" variant="ghost" onClick={clearFilters}>
              清除过滤
            </Btn>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div ref={wrapRef} className="qs-card relative h-[62vh] overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
            {loading && !graph ? (
              <div className="flex h-full items-center justify-center">
                <Spinner label="加载星图…" />
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
                  text={preset ? '该预设在当前知识库中没有匹配资料' : '当前过滤条件下没有节点'}
                  hint={preset ? '检查预设依据的目录/标签是否与 Vault 结构一致，或清除过滤' : '放宽或清除过滤条件'}
                  emptyKey={preset ? 'graph-preset-empty' : 'graph-filter-empty'}
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
          </div>
        </div>

        {/* 节点详情（点击节点） */}
        <aside className="qs-card h-fit w-[280px] shrink-0 p-4">
          <h3 className="font-display mb-3 text-[15px] font-semibold">节点详情</h3>
          {!detail ? (
            <Empty text="点击图中节点查看关联" />
          ) : (
            <div className="space-y-3">
              <div>
                <Badge tone={detail.node.kind === 'doc' ? 'signal' : 'default'}>{detail.node.kind === 'doc' ? '文档' : '标签'}</Badge>
                <div className="mt-1.5 text-[13px] font-medium leading-snug">{detail.node.label}</div>
                {detail.node.path ? (
                  <button
                    type="button"
                    className="qs-meta mt-1 cursor-pointer text-left hover:underline"
                    style={{ color: 'var(--color-signal)' }}
                    onClick={() => openKbDoc(detail.node.path)}
                  >
                    {detail.node.path} · 阅读原文
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
                          onClick={() => openKbDoc(d.path)}
                          title={d.path}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px]">{d.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
