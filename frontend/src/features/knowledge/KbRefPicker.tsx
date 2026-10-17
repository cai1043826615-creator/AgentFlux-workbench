import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KB_REF_LIMIT, type KnowledgeSearchHit, type KnowledgeStatus, type TaskKbRefInput } from '@workbench/shared';
import { Badge, Btn, Empty } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { KB_EMPTY_STATES } from './kbEmpty.ts';

/**
 * 「关联知识库资料」步骤（板块 A/B 唯一耦合点，spec workflow-context）：
 * - 从知识库搜索勾选资料，最多 6 份（超出时提示并阻止继续勾选）
 * - 支持「整篇 / 章节片段」两种粒度（坑4：资料关联粒度是片段而非整份）
 * - 知识库未连接时显示提示并允许跳过，任务创建流程完全不受影响（6.5 独立性）
 *
 * `defaultQuery`（可选）：打开时预填关键词并**立即展示结果**，省去用户手动输入。
 * 作品集沙盒据此按任务所属工作流预置「电商 / 小红书」，让访客一进来就能看到资料；
 * 正常使用时不传该参数，行为与原先完全一致（空白起手、手动搜索）。
 */
export function KbRefPicker({
  value,
  onChange,
  defaultQuery,
}: {
  value: TaskKbRefInput[];
  onChange: (next: TaskKbRefInput[]) => void;
  defaultQuery?: string;
}) {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [query, setQuery] = useState(defaultQuery ?? '');
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  /** docPath → 展示标题（勾选时记录，避免额外请求） */
  const [titles, setTitles] = useState<Record<string, string>>({});
  /** docPath → 章节锚点（展开后才拉取） */
  const [anchors, setAnchors] = useState<Record<string, { anchor: string; title: string; level: number }[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void api
      .kbStatus()
      .then((r) => setStatus(r.status))
      .catch(() => setStatus({ state: 'disconnected', reason: '知识库状态不可用', root: null, source: 'none', range: { includeDirs: [], excludeDirs: [] }, indexing: false }));
  }, []);

  const connected = status?.state === 'connected';
  const atLimit = value.length >= KB_REF_LIMIT;

  const isPicked = useCallback((docPath: string, anchor: string | null) => value.some((r) => r.docPath === docPath && (r.anchor ?? null) === anchor), [value]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.kbSearch(q, 20);
      setHits(r.hits);
      setTitles((prev) => {
        const next = { ...prev };
        for (const h of r.hits) next[h.path] = h.title;
        return next;
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 预置关键词时**自动执行一次搜索**：让用户（沙盒访客）打开即见资料，无需手动输入。
   * 只在「有默认关键词 + 知识库已连接 + 尚未自动搜过」时触发一次，之后完全交给用户操作；
   * 正常使用（不传 defaultQuery）时该 effect 直接 return，行为与原先一致。
   */
  const autoSearchedRef = useRef(false);
  useEffect(() => {
    const q = (defaultQuery ?? '').trim();
    if (!q || !connected || autoSearchedRef.current) return;
    autoSearchedRef.current = true;
    void search();
    // 仅在连接状态就绪后触发一次；search 内部依赖当前 query，这里不需要重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, defaultQuery]);

  const toggleDoc = (docPath: string) => {
    if (isPicked(docPath, null)) {
      onChange(value.filter((r) => !(r.docPath === docPath && (r.anchor ?? null) === null)));
      return;
    }
    if (atLimit) {
      setNotice(`已达上限（${KB_REF_LIMIT} 份），请先移除已选资料`);
      return;
    }
    onChange([...value, { docPath, anchor: null }]);
  };

  const toggleAnchor = (docPath: string, anchor: string) => {
    if (isPicked(docPath, anchor)) {
      onChange(value.filter((r) => !(r.docPath === docPath && r.anchor === anchor)));
      return;
    }
    if (atLimit) {
      setNotice(`已达上限（${KB_REF_LIMIT} 份），请先移除已选资料`);
      return;
    }
    onChange([...value, { docPath, anchor }]);
  };

  const expand = async (docPath: string) => {
    if (expanded === docPath) {
      setExpanded(null);
      return;
    }
    setExpanded(docPath);
    if (anchors[docPath]) return;
    try {
      const { doc } = await api.kbDoc(docPath);
      setAnchors((prev) => ({ ...prev, [docPath]: doc.anchors }));
      setTitles((prev) => ({ ...prev, [docPath]: doc.title }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  const selectedLabel = (r: TaskKbRefInput) => `${titles[r.docPath] ?? r.docPath}${r.anchor ? ` · ${r.anchor}` : ''}`;

  const countText = useMemo(() => `${value.length} / ${KB_REF_LIMIT}`, [value.length]);

  if (status && !connected) {
    return (
      <div className="rounded-[4px] border px-3 py-3" style={{ borderColor: 'var(--color-line-strong)', background: 'var(--color-canvas)' }}>
        <div className="flex items-center gap-2">
          <Badge tone="no">知识库未连接</Badge>
          <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
            本步骤可跳过
          </span>
        </div>
        <p className="qs-meta mt-1.5 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
          {status.reason ?? '尚未连接 Obsidian Vault。'} 可先直接创建任务，也可到「知识库」页连接 Vault 后再回来关联资料。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          从知识库搜索并勾选资料（可选，Agent 生成时会引用其内容）
        </span>
        <span className="qs-meta tabular" style={{ color: atLimit ? 'var(--color-warn)' : 'var(--color-ink-faint)' }}>
          {countText}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          className="qs-input flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
          placeholder="搜索知识库资料…"
          aria-label="搜索知识库资料"
        />
        <Btn size="sm" loading={busy} onClick={() => void search()}>
          搜索
        </Btn>
      </div>

      {notice ? (
        <p className="qs-meta" style={{ color: 'var(--color-warn)' }}>
          ● {notice}
        </p>
      ) : null}

      {hits ? (
        hits.length === 0 ? (
          <Empty text={KB_EMPTY_STATES.kbRefSearchEmpty.text} hint={KB_EMPTY_STATES.kbRefSearchEmpty.hint} emptyKey={KB_EMPTY_STATES.kbRefSearchEmpty.key} />
        ) : (
          <div className="max-h-[210px] space-y-1 overflow-y-auto pr-1">
            {hits.map((h) => {
              const pickedWhole = isPicked(h.path, null);
              const isOpen = expanded === h.path;
              return (
                <div key={h.path} className="rounded-[4px] border" style={{ borderColor: pickedWhole ? 'var(--color-signal)' : 'var(--color-line)', background: pickedWhole ? 'var(--color-signal-soft)' : 'transparent' }}>
                  <div className="flex items-start gap-2 px-2.5 py-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-signal)]"
                      checked={pickedWhole}
                      onChange={() => toggleDoc(h.path)}
                      aria-label={`勾选 ${h.title}（整篇）`}
                    />
                    <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => toggleDoc(h.path)}>
                      <div className="truncate text-[13px] font-medium">{h.title}</div>
                      <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
                        {h.path}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                        {h.snippet}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="qs-meta shrink-0 cursor-pointer rounded-[4px] border px-1.5 py-0.5"
                      style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}
                      onClick={() => void expand(h.path)}
                      title="选择章节片段"
                    >
                      {isOpen ? '收起' : '选章节'}
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="border-t px-2.5 py-2" style={{ borderColor: 'var(--color-line)' }}>
                      {!anchors[h.path] ? (
                        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                          加载章节…
                        </span>
                      ) : anchors[h.path].length === 0 ? (
                        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                          该文档没有标题层级，只能按整篇关联
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {anchors[h.path].map((a) => {
                            const picked = isPicked(h.path, a.anchor);
                            return (
                              <button
                                key={a.anchor}
                                type="button"
                                className="cursor-pointer rounded-[4px] border px-1.5 py-0.5 text-[11px] transition-colors"
                                style={{
                                  borderColor: picked ? 'var(--color-signal)' : 'var(--color-line-strong)',
                                  background: picked ? 'var(--color-signal-soft)' : 'transparent',
                                  color: picked ? 'var(--color-signal)' : 'var(--color-ink-soft)',
                                }}
                                onClick={() => toggleAnchor(h.path, a.anchor)}
                                title={`片段：${a.anchor}`}
                              >
                                {a.title}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <p className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          输入关键词搜索，或直接跳过本步骤。
        </p>
      )}

      {/* 已选列表（可移除） */}
      <div>
        <div className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>
          已选资料
        </div>
        {value.length === 0 ? (
          <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
            未关联任何资料
          </span>
        ) : (
          <div className="space-y-1">
            {value.map((r, i) => (
              <div key={`${r.docPath}#${r.anchor ?? ''}`} className="flex items-center gap-2 rounded-[4px] border px-2 py-1.5" style={{ borderColor: 'var(--color-line)' }}>
                <span className="qs-meta tabular shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{selectedLabel(r)}</span>
                <button type="button" className="qs-meta shrink-0 cursor-pointer hover:underline" style={{ color: 'var(--color-danger)' }} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
