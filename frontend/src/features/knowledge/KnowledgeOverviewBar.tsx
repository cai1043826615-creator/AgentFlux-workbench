/**
 * 知识库总览带（knowledge-ux 2.2–2.6）：四统计卡 + 星图缩略预览 + 最近更新 + 健康度小指标。
 * - 挂载于 KnowledgeView 已连接分支（替换原四张统计卡），位于三栏之上，高度上限约 120–140px。
 * - 四个统计数字全部取自 `knowledgeStats()`（无硬编码占位数字，2.2）。
 * - 缩略预览用 `graphCanvas` 静态绘制一次（不启动力导向模拟、不绑定指针/滚轮，2.3）。
 * - 最近更新取 `stats.recent` 前 min(M,8) 条（2.4）。
 * - 健康度小指标：文档使用率（口径唯一，2.5）+ 孤岛（可点击筛选，2.6）。
 * - 空态文案与知识库页/星图共用 kbEmpty.ts 单一来源（4.4）。
 */
import { useEffect, useRef, useState } from 'react';
import type { KnowledgeGraphData, KnowledgeHealth, KnowledgeStats, KnowledgeStatus } from '@workbench/shared';
import { Badge } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { drawGraph, layoutInitial, type GraphSimNode } from './graphCanvas.ts';
import { KB_EMPTY_STATES } from './kbEmpty.ts';

/** 缩略图内部逻辑尺寸（CSS 固定宽高；按 dpr 放大内部分辨率保证清晰） */
const THUMB_W = 240;
const THUMB_H = 88;

/** 星图缩略预览（只读静态绘制）：点击整块进入知识星图视图 */
function GraphThumbnail({ refreshToken, onOpen }: { refreshToken: string; onOpen: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graph, setGraph] = useState<KnowledgeGraphData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .kbGraph()
      .then((r) => {
        if (!cancelled) setGraph(r.graph);
      })
      .catch(() => {
        if (!cancelled) setGraph(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  // 静态绘制一帧（复用渲染内核；layoutInitial 仅做一次初始布局，不做力导向迭代）
  useEffect(() => {
    if (!graph) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(THUMB_W * dpr);
    canvas.height = Math.round(THUMB_H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sim: GraphSimNode[] = layoutInitial(graph.nodes);
    // 包围盒 → 适配缩放与居中平移（语义同 3.3 fit：zoom=clamp(min(w/bw,h/bh))，pan 居中）
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of sim) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const pad = 16;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const zoom = Math.min((THUMB_W - pad * 2) / bw, (THUMB_H - pad * 2) / bh);
    const view = { zoom, panX: THUMB_W / 2 - ((minX + maxX) / 2) * zoom, panY: THUMB_H / 2 - ((minY + maxY) / 2) * zoom };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, THUMB_W, THUMB_H);
    drawGraph(ctx, { nodes: sim, edges: graph.edges, view, size: { w: THUMB_W, h: THUMB_H }, selectedId: null, zoom });
  }, [graph]);

  return (
    <button
      type="button"
      onClick={onOpen}
      title="打开知识星图"
      aria-label="打开知识星图"
      className="block w-[240px] shrink-0 cursor-pointer rounded-[6px] border text-left transition-colors hover:border-[var(--color-signal)]"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-bg)' }}
    >
      {graph && graph.nodes.length > 0 ? (
        <canvas ref={canvasRef} className="block" style={{ width: THUMB_W, height: THUMB_H }} />
      ) : (
        <div className="px-3 py-2.5" style={{ height: THUMB_H }}>
          <div data-qs-empty={KB_EMPTY_STATES.graphEmpty.key} className="text-[11px] leading-snug" style={{ color: 'var(--color-ink-soft)' }}>
            {KB_EMPTY_STATES.graphEmpty.text}
          </div>
          <div data-qs-empty-next={KB_EMPTY_STATES.graphEmpty.key} className="qs-meta mt-1 text-[10px] leading-snug" style={{ color: 'var(--color-ink-faint)' }}>
            {KB_EMPTY_STATES.graphEmpty.hint}
          </div>
        </div>
      )}
    </button>
  );
}

export interface KnowledgeOverviewBarProps {
  status: KnowledgeStatus;
  stats: KnowledgeStats | null;
  health: KnowledgeHealth | null;
  islandOnly: boolean;
  onToggleIsland: () => void;
  onOpenDoc: (path: string) => void;
}

/**
 * 总览带：横向排布 [四项统计 | 缩略预览 | 最近更新 | 健康度小指标]。
 * 高度由紧凑内边距控制，约 120–140px。
 */
export function KnowledgeOverviewBar({ status, stats, health, islandOnly, onToggleIsland, onOpenDoc }: KnowledgeOverviewBarProps) {
  const { setView } = useWorkbench();
  const recent = (stats?.recent ?? []).slice(0, 8);
  const usage = health?.usage;
  // 文档使用率口径（2.5）：百分比（分子/分母）；ratio 为 null（未连接/0 篇文档）显示「—」
  const usageText = usage && usage.ratio !== null ? `${Math.round(usage.ratio * 100)}%（${usage.linkedDocs}/${usage.totalDocs}）` : '—';
  const islandCount = health?.islands.count ?? 0;

  return (
    <div className="qs-card flex items-stretch gap-4 p-3" data-qs-overview>
      {/* 四项统计（全部取自 knowledgeStats()，无硬编码占位） */}
      <div className="grid w-[236px] shrink-0 grid-cols-2 gap-2">
        {[
          ['文档', stats?.docCount ?? 0],
          ['标签', stats?.tagCount ?? 0],
          ['目录', stats?.dirCount ?? 0],
          ['关联边', stats?.edgeCount ?? 0],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)' }}>
            <div className="qs-meta text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
              {label}
            </div>
            <div className="font-display tabular text-[17px] font-bold leading-tight">{value}</div>
          </div>
        ))}
      </div>

      {/* 星图缩略预览（点击进入知识星图） */}
      <GraphThumbnail refreshToken={stats?.indexedAt ?? ''} onOpen={() => setView('knowledge-graph')} />

      {/* 最近更新（前 min(M,8) 条，点击在阅读区打开该文档；40：收窄约 20%，避免过度抢占横向空间） */}
      <div className="min-w-0 flex-1 max-w-[260px]">
        <div className="qs-meta mb-1.5 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          最近更新
        </div>
        {recent.length === 0 ? (
          <div className="py-2 text-[11px] leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
            {status.indexing ? '正在索引…' : '索引 0 篇文档，暂无最近更新'}
          </div>
        ) : (
          <ul className="space-y-1">
            {recent.map((d) => (
              <li key={d.path}>
                <button
                  type="button"
                  className="w-full cursor-pointer truncate rounded-[4px] px-1.5 py-0.5 text-left text-[11px] transition-colors hover:bg-[var(--color-signal-soft)]"
                  style={{ color: 'var(--color-ink-soft)' }}
                  onClick={() => onOpenDoc(d.path)}
                  title={d.path}
                >
                  <span className="font-medium" style={{ color: 'var(--color-ink)' }}>
                    {d.title}
                  </span>
                  <span className="qs-meta ml-1.5" style={{ color: 'var(--color-ink-faint)' }}>
                    {d.mtime ? d.mtime.slice(5, 16).replace('T', ' ') : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 健康度小指标（文档使用率 + 孤岛） */}
      <div className="w-[168px] shrink-0 space-y-1.5">
        <div className="rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)' }}>
          <div className="qs-meta text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
            文档使用率
          </div>
          <div className="font-display tabular text-[14px] font-bold leading-tight" data-qs-usage>
            {usageText}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleIsland}
          className={`block w-full cursor-pointer rounded-[4px] border px-2.5 py-1.5 text-left transition-colors ${islandOnly ? 'font-semibold' : ''}`}
          style={{
            borderColor: islandOnly ? 'var(--color-signal)' : 'var(--color-line)',
            background: islandOnly ? 'var(--color-signal-soft)' : 'transparent',
            color: islandOnly ? 'var(--color-signal)' : 'inherit',
          }}
          title="点击筛选孤岛文档 / 再次点击取消"
        >
          <div className="qs-meta text-[10px]" style={{ color: islandOnly ? 'var(--color-signal)' : 'var(--color-ink-faint)' }}>
            孤岛
          </div>
          <div className="font-display tabular text-[14px] font-bold leading-tight">
            {islandCount}
            {islandOnly ? '（筛选中）' : ''}
          </div>
        </button>
      </div>

      {status.indexing ? <Badge tone="signal">索引中…</Badge> : null}
    </div>
  );
}
