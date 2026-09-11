import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraphData, KnowledgeGraphNode, KnowledgeNodeDetail } from '@workbench/shared';
import { Badge, Btn, Empty, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';

/** 参与模拟的节点（含布局状态） */
interface SimNode extends KnowledgeGraphNode {
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

const DOC_RADIUS = (degree: number) => Math.min(16, 5 + Math.sqrt(degree) * 2.2);
const TAG_RADIUS = (degree: number) => Math.min(11, 4 + Math.sqrt(degree) * 1.6);

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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** canvas 元素用 state 持有：数据到达后 canvas 才挂载，需要触发绘制循环重新绑定 */
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  /** 模拟节点与视图变换存 ref，避免每帧触发 React 渲染 */
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<{ source: string; target: string; kind: string }[]>([]);
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
      // 初始化布局：文档环形 + 标签散布，避免全部重叠
      const docs = g.nodes.filter((n) => n.kind === 'doc');
      const tags = g.nodes.filter((n) => n.kind === 'tag');
      const nodes: SimNode[] = [
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
      nodesRef.current = nodes;
      edgesRef.current = g.edges;
      indexRef.current = new Map(nodes.map((n) => [n.id, n]));
      viewRef.current = { zoom: 1, panX: 0, panY: 0 };
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

  /** 绘制一帧 */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const { zoom, panX, panY } = viewRef.current;
    const dpr = window.devicePixelRatio || 1;
    const nodes = nodesRef.current;
    const idx = indexRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const toScreen = (wx: number, wy: number) => ({ x: cx + (wx + panX) * zoom, y: cy + (wy + panY) * zoom });

    // 边
    for (const e of edgesRef.current) {
      const s = idx.get(e.source);
      const t = idx.get(e.target);
      if (!s || !t) continue;
      const sp = toScreen(s.x, s.y);
      const tp = toScreen(t.x, t.y);
      const focused = kbNodeId && (e.source === kbNodeId || e.target === kbNodeId);
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
      const p = toScreen(n.x, n.y);
      const base = n.kind === 'doc' ? DOC_RADIUS(n.degree) : TAG_RADIUS(n.degree);
      const r = Math.max(2.5, base * Math.min(1.4, Math.max(0.6, zoom)));
      const selected = kbNodeId === n.id;
      const dim = Boolean(kbNodeId) && !selected && !n.neighbor;

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

      // 标签文字：文档节点在缩放足够或选中/邻居时绘制
      if (n.kind === 'doc' && (zoom >= 0.8 || selected || n.neighbor || n.highlight)) {
        ctx.font = `${selected || n.highlight ? '600 ' : ''}11px ui-sans-serif, system-ui, sans-serif`;
        // canvas 不支持 CSS 变量，使用与 --color-ink 一致的字面色值
        ctx.fillStyle = dim ? 'rgba(10,10,10,0.3)' : '#0a0a0a';
        ctx.textAlign = 'center';
        ctx.fillText(n.label.length > 12 ? `${n.label.slice(0, 12)}…` : n.label, p.x, p.y + r + 11);
      }
    }
  }, [kbNodeId]);

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

  /** 屏幕坐标 → 世界坐标 */
  const screenToWorld = useCallback((sx: number, sy: number) => {
    const { w, h } = sizeRef.current;
    const { zoom, panX, panY } = viewRef.current;
    return { x: (sx - w / 2) / zoom - panX, y: (sy - h / 2) / zoom - panY };
  }, []);

  /** 命中测试（返回最近的节点） */
  const hitTest = useCallback((sx: number, sy: number): SimNode | null => {
    const { zoom } = viewRef.current;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      const r = Math.max(6, (n.kind === 'doc' ? DOC_RADIUS(n.degree) : TAG_RADIUS(n.degree)) * Math.min(1.4, Math.max(0.6, zoom)));
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d <= r + 4 && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }, [screenToWorld]);

  const localPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
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

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const view = viewRef.current;
    const before = screenToWorld(sx, sy);
    const nextZoom = Math.min(3, Math.max(0.25, view.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    viewRef.current = { ...view, zoom: nextZoom };
    const after = screenToWorld(sx, sy);
    // 保持光标下的世界点不动
    viewRef.current = { ...viewRef.current, panX: viewRef.current.panX + (after.x - before.x), panY: viewRef.current.panY + (after.y - before.y) };
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

  const resetView = () => {
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    alphaRef.current = 1;
    for (const n of nodesRef.current) n.highlight = false;
    setMatchCount(null);
  };

  const nodeCount = graph?.nodes.length ?? 0;
  const hasData = useMemo(() => (graph ? graph.nodes.length > 0 : false), [graph]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="qs-meta mb-0.5">板块 B · 知识库管理系统</div>
          <h2 className="font-display text-[20px] font-bold">知识星图</h2>
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
            placeholder="搜索节点定位…"
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

      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <div ref={wrapRef} className="qs-card relative h-[62vh] overflow-hidden" style={{ background: 'var(--color-canvas)' }}>
            {loading && !graph ? (
              <div className="flex h-full items-center justify-center">
                <Spinner label="加载星图…" />
              </div>
            ) : !hasData ? (
              // 4.4：无数据时渲染空图提示而非报错
              <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
                <Empty text="暂无图谱数据" />
                <p className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                  知识库中没有文档，或文档之间既无 Markdown 链接也无共享标签。
                </p>
              </div>
            ) : (
              <canvas
                ref={(el) => {
                  canvasRef.current = el;
                  setCanvasEl(el);
                }}
                className="block h-full w-full cursor-grab active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={() => setHover(null)}
                onWheel={onWheel}
                role="img"
                aria-label="知识图谱"
              />
            )}
            {hover && hasData ? (
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
