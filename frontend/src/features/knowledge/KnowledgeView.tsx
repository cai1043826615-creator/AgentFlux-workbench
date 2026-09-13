import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeDirInfo, KnowledgeDoc, KnowledgeDocSummary, KnowledgeHealth, KnowledgeSearchHit, KnowledgeStats, KnowledgeStatus, KnowledgeTagInfo } from '@workbench/shared';
import { Badge, Btn, Empty, Glyph, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { KB_EMPTY_STATES } from './kbEmpty.ts';
import { dirDisplayName, dirDisplayPath } from './dirDisplayName.ts';
import { KnowledgeOverviewBar } from './KnowledgeOverviewBar.tsx';
import { VaultConfigModal } from './VaultConfigModal.tsx';
import { KnowledgeSidebar } from './KnowledgeSidebar.tsx';
import { Markdown } from './Markdown.tsx';


/** 目录树（由扁平目录列表构建，支持折叠） */
function DirTree({ dirs, active, onPick }: { dirs: KnowledgeDirInfo[]; active: string | null; onPick: (dir: string | null) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const tree = useMemo(() => {
    const nodes = dirs.filter((d) => d.dir !== '');
    const childrenOf = (parent: string) => nodes.filter((d) => (parent === '' ? !d.dir.includes('/') : d.dir.startsWith(`${parent}/`) && !d.dir.slice(parent.length + 1).includes('/')));
    return { childrenOf };
  }, [dirs]);

  const renderLevel = (parent: string, depth: number): React.ReactNode =>
    tree.childrenOf(parent).map((node) => {
      const hasChildren = tree.childrenOf(node.dir).length > 0;
      const isCollapsed = collapsed[node.dir];
      const isActive = active === node.dir;
      return (
        <div key={node.dir}>
          <div className="flex items-center gap-1" style={{ paddingLeft: depth * 10 }}>
            <button
              type="button"
              className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-[10px]"
              style={{ color: 'var(--color-ink-faint)', visibility: hasChildren ? 'visible' : 'hidden' }}
              onClick={() => setCollapsed((p) => ({ ...p, [node.dir]: !p[node.dir] }))}
              aria-label={isCollapsed ? '展开目录' : '折叠目录'}
            >
              <span style={{ display: 'inline-block', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>›</span>
            </button>
            <button
              type="button"
              className={`min-w-0 flex-1 cursor-pointer truncate rounded-[4px] px-1.5 py-1 text-left text-[12px] transition-colors ${isActive ? 'font-semibold' : ''}`}
              style={{ background: isActive ? 'var(--color-signal-soft)' : 'transparent', color: isActive ? 'var(--color-signal)' : 'var(--color-ink-soft)' }}
              onClick={() => onPick(node.dir)}
              title={`${dirDisplayPath(node.dir)}（真实路径：${node.dir}）`}
            >
              {dirDisplayName(node.dir)}
            </button>
            <span className="qs-meta tabular shrink-0">{node.count}</span>
          </div>
          {hasChildren && !isCollapsed ? renderLevel(node.dir, depth + 1) : null}
        </div>
      );
    });

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        className={`w-full cursor-pointer rounded-[4px] px-1.5 py-1 text-left text-[12px] transition-colors ${active === null ? 'font-semibold' : ''}`}
        style={{ background: active === null ? 'var(--color-signal-soft)' : 'transparent', color: active === null ? 'var(--color-signal)' : 'var(--color-ink-soft)' }}
        onClick={() => onPick(null)}
      >
        全部文档
        <span className="qs-meta tabular ml-1">{dirs.find((d) => d.dir === '')?.count ?? 0}</span>
      </button>
      {renderLevel('', 0)}
    </div>
  );
}

/** 知识库视图：总览统计 + 目录/标签浏览 + 全文搜索 + Markdown 原文阅读 */
export function KnowledgeView() {
  const { kbDocPath, openKbDoc, setView } = useWorkbench();
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [islandOnly, setIslandOnly] = useState(false);
  const [dirs, setDirs] = useState<KnowledgeDirInfo[]>([]);
  const [tags, setTags] = useState<KnowledgeTagInfo[]>([]);
  const [docs, setDocs] = useState<KnowledgeDocSummary[]>([]);
  const [doc, setDoc] = useState<KnowledgeDoc | null>(null);
  const [filter, setFilter] = useState<{ dir: string | null; tag: string | null }>({ dir: null, tag: null });
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // 35：目录/标签栏可折叠（收起后由三栏变两栏，把宽度让给列表与阅读区）
  const [catalogOpen, setCatalogOpen] = useState(true);
  /** P1·意见#7：搜索候选需要**全量**文档标题（不受当前目录/标签筛选影响），单独拉一份 */
  const [allDocs, setAllDocs] = useState<KnowledgeDocSummary[]>([]);
  /** 候选浮层是否展开（输入时展开，选中/失焦/按 Esc 收起） */
  const [suggestOpen, setSuggestOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadMeta = useCallback(async () => {
    const [st, s, d, t] = await Promise.all([api.kbStatus(), api.kbStats(), api.kbDirs(), api.kbTags()]);
    setStatus(st.status);
    setStats(s.stats);
    setDirs(d.dirs);
    setTags(t.tags);
    return st.status;
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const r = await api.kbHealth();
      setHealth(r.health);
    } catch {
      setHealth(null);
    }
  }, []);

  const loadDocs = useCallback(async (f: { dir: string | null; tag: string | null }) => {
    const r = await api.kbDocs({ dir: f.tag ? undefined : (f.dir ?? null), tag: f.tag ?? undefined });
    setDocs(r.docs);
  }, []);

  /** 全量文档（供搜索候选）：不受当前筛选影响，知识库 5–50 篇量级，一次拉全即可 */
  const loadAllDocs = useCallback(async () => {
    try {
      const r = await api.kbDocs({});
      setAllDocs(r.docs);
    } catch {
      setAllDocs([]);
    }
  }, []);

  const reloadAll = useCallback(async () => {
    const st = await loadMeta();
    void loadHealth();
    if (st.state === 'connected') {
      await loadDocs(filter);
      void loadAllDocs();
    }
  }, [loadMeta, loadDocs, loadAllDocs, filter, loadHealth]);

  useEffect(() => {
    void reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 索引进行中：轮询直到完成（后台异步任务，不阻塞界面）
  useEffect(() => {
    if (!status?.indexing) {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current != null) return;
    pollRef.current = window.setInterval(() => void reloadAll(), 900);
    return () => {
      if (pollRef.current != null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.indexing, reloadAll]);

  // 定位阅读：星图节点 / 任务关联资料跳转
  useEffect(() => {
    if (!kbDocPath) return;
    let cancelled = false;
    void api
      .kbDoc(kbDocPath)
      .then((r) => {
        if (!cancelled) setDoc(r.doc);
      })
      .catch(() => {
        if (!cancelled) setNotice(`无法打开文档：${kbDocPath}`);
      });
    return () => {
      cancelled = true;
    };
  }, [kbDocPath]);

  const pick = async (f: { dir: string | null; tag: string | null }) => {
    setFilter(f);
    setHits(null);
    setQuery('');
    // 切换浏览范围即退出孤岛筛选（2.6：孤岛筛选不残留）
    setIslandOnly(false);
    await loadDocs(f);
  };

  const openDoc = async (path: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.kbDoc(path);
      setDoc(r.doc);
      // 同步到全局定位，保证「星图/任务详情跳转同一篇」时仍能重新打开
      openKbDoc(path);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 孤岛一键筛选（2.6）：
   * - 进入：清空搜索态；拉全量文档并按健康度孤岛路径过滤（条数 = 孤岛指标）；孤岛数为 0 时列表区渲染 no-islands 空态。
   * - 取消：恢复点击前的目录/标签浏览范围（filter 原样保留，不残留孤岛筛选）。
   */
  const toggleIsland = async () => {
    if (islandOnly) {
      setIslandOnly(false);
      await loadDocs(filter);
      return;
    }
    setHits(null);
    setQuery('');
    let h = health;
    if (!h) {
      try {
        const r = await api.kbHealth();
        h = r.health;
        setHealth(r.health);
      } catch {
        h = null;
      }
    }
    const paths = new Set(h?.islands.paths ?? []);
    if (paths.size === 0) {
      setDocs([]);
      setIslandOnly(true);
      return;
    }
    const r = await api.kbDocs({});
    setDocs(r.docs.filter((d) => paths.has(d.path)));
    setIslandOnly(true);
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    setBusy(true);
    try {
      const r = await api.kbSearch(q, 30);
      setHits(r.hits);
      setDoc(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 搜索候选（意见#7）：候选 = 文档标题 + 标签，**不是历史搜索记录**。
   * 理由：知识库只有 5–50 篇量级，用户是在「找」而不是「搜」——给标题比给历史更有用。
   * 无输入时不展示；有输入时按包含匹配（大小写不敏感），标题与标签各自限量。
   */
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as { kind: 'doc' | 'tag'; label: string; sub?: string; path?: string }[];
    const docHits = allDocs
      .filter((d) => d.title.toLowerCase().includes(q))
      .slice(0, 6)
      .map((d) => ({ kind: 'doc' as const, label: d.title, sub: d.dir || '根目录', path: d.path }));
    const tagHits = tags
      .filter((t) => t.tag.toLowerCase().includes(q))
      .slice(0, 4)
      .map((t) => ({ kind: 'tag' as const, label: t.tag, sub: `${t.count} 篇` }));
    return [...docHits, ...tagHits];
  }, [query, allDocs, tags]);

  const reindex = async () => {
    setBusy(true);
    setNotice('索引重建已启动，完成后统计会自动刷新');
    try {
      await api.kbReindex();
      await reloadAll();
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.state === 'connected';

  // ===== 未连接空状态（板块 A 完全不受影响） =====
  if (status && !connected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            {/* 新3：与已连接分支及各页大标题统一 22px */}
            <h2 className="font-display text-[22px] font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>知识库</h2>
          </div>
          <Badge tone="no">未连接</Badge>
        </div>
        <div className="qs-card p-8 text-center">
          <Glyph name="box" size={28} className="mx-auto mb-3" />
          <p className="text-[14px] font-medium">
            <span data-qs-empty={KB_EMPTY_STATES.kbDisconnected.key}>{KB_EMPTY_STATES.kbDisconnected.text}</span>
          </p>
          <p className="qs-meta mx-auto mt-2 max-w-[430px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
            {status.reason ?? '尚未配置 Vault 路径。'}
          </p>
          <p className="qs-meta mx-auto mt-1 max-w-[430px] leading-relaxed" style={{ color: 'var(--color-ink-faint)' }} data-qs-empty-next={KB_EMPTY_STATES.kbDisconnected.key}>
            {KB_EMPTY_STATES.kbDisconnected.hint}
          </p>
          <div className="mt-4 flex justify-center">
            <Btn variant="primary" onClick={() => setConfigOpen(true)}>
              连接 Obsidian Vault
            </Btn>
          </div>
        </div>
        <VaultConfigModal open={configOpen} status={status} onClose={() => setConfigOpen(false)} onSaved={() => void reloadAll()} />
      </div>
    );
  }

  if (!status) return <Spinner label="加载知识库…" />;

  return (
    <div className="space-y-4">
      {/* 头部：状态 + 索引范围 + 操作 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* 新3：页面大标题字号统一为 22px（与「每日热点」页一致；原 20px 造成同级页面不齐） */}
          <h2 className="font-display text-[22px] font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            知识库
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {status.indexing ? <Badge tone="signal">索引中…</Badge> : <Badge tone="ok">已连接</Badge>}
          <Btn size="sm" loading={busy} onClick={() => void reindex()}>
            重建索引
          </Btn>
          {/* P1·5.6：折叠控件已移入目录面板标题栏（紧邻目录树），此处不再重复 */}
          <Btn size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>
            知识库设置
          </Btn>
        </div>
      </div>

      {notice ? (
        <p className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
          {notice}
        </p>
      ) : null}

      {/* 总览带：统计 + 星图缩略预览 + 最近更新 + 健康度小指标（2.2–2.6） */}
      {/* 总览带（P1 要点②）：1 核心指标 + 3 入口，横向一条 */}
      <KnowledgeOverviewBar status={status} stats={stats} health={health} />

      {/* 搜索（29：sticky 冻结，目录树/列表滚动时搜索条仍在视野内）
          意见#7：输入即出候选（候选 = 文档标题 + 标签，非历史记录） */}
      <div className="qs-card sticky top-0 z-20 p-3" style={{ background: 'var(--color-surface)' }}>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              className="qs-input w-full"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => {
                // 延迟收起，保证候选项的 onClick 先触发
                window.setTimeout(() => setSuggestOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setSuggestOpen(false);
                  void runSearch();
                } else if (e.key === 'Escape') {
                  setSuggestOpen(false);
                }
              }}
              placeholder="搜索知识库…"
              aria-label="搜索知识库"
              role="combobox"
              aria-expanded={suggestOpen && suggestions.length > 0}
              aria-autocomplete="list"
            />
            {/* 候选浮层 */}
            {suggestOpen && suggestions.length > 0 ? (
              <div
                className="qs-card absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[280px] overflow-y-auto p-1"
                style={{ boxShadow: '0 4px 12px rgba(10,10,10,0.10)' }}
                role="listbox"
                data-kb-suggest
              >
                {suggestions.map((s) => (
                  <button
                    key={`${s.kind}-${s.label}`}
                    type="button"
                    className="qs-nav-item flex w-full items-center gap-2 text-left"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setSuggestOpen(false);
                      setQuery('');
                      if (s.kind === 'doc' && s.path) void openDoc(s.path);
                      else void pick({ dir: null, tag: s.label });
                    }}
                  >
                    <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                      {s.kind === 'doc' ? '文档' : '标签'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                      {s.sub}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Btn variant="primary" size="sm" loading={busy} onClick={() => void runSearch()}>
            搜索
          </Btn>
          {hits ? (
            <Btn
              size="sm"
              variant="ghost"
              onClick={() => {
                setHits(null);
                setQuery('');
              }}
            >
              清除
            </Btn>
          ) : null}
        </div>
      </div>

      <div className="flex gap-4">
        {/* 左：公共侧栏（P1·5.5：容器 + 标题栏折叠控件抽出共用；过滤控件由本页自定） */}
        <KnowledgeSidebar
          open={catalogOpen}
          title="目录"
          width={210}
          onToggle={() => setCatalogOpen(false)}
          onExpand={() => setCatalogOpen(true)}
          footer={
            <>
              <div className="qs-card mt-4 p-3">
                <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-faint)' }}>
                  标签
                </div>
                {tags.length === 0 ? (
                  <Empty text={KB_EMPTY_STATES.kbNoTags.text} hint={KB_EMPTY_STATES.kbNoTags.hint} emptyKey={KB_EMPTY_STATES.kbNoTags.key} />
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => {
                      const active = filter.tag === t.tag;
                      return (
                        <button
                          key={t.tag}
                          type="button"
                          className="cursor-pointer rounded-[4px] border px-1.5 py-0.5 text-[11px] transition-colors"
                          style={{
                            borderColor: active ? 'var(--color-signal)' : 'var(--color-line-strong)',
                            background: active ? 'var(--color-signal-soft)' : 'transparent',
                            color: active ? 'var(--color-signal)' : 'var(--color-ink-soft)',
                          }}
                          onClick={() => void pick({ dir: null, tag: active ? null : t.tag })}
                        >
                          {t.tag} <span className="tabular">{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          }
        >
          {dirs.length === 0 ? (
            <Empty text={KB_EMPTY_STATES.kbNoDirs.text} hint={KB_EMPTY_STATES.kbNoDirs.hint} emptyKey={KB_EMPTY_STATES.kbNoDirs.key} />
          ) : (
            <DirTree dirs={dirs} active={filter.tag ? null : filter.dir} onPick={(dir) => void pick({ dir, tag: null })} />
          )}
        </KnowledgeSidebar>

        {/* 中：文档列表 / 搜索结果 */}
        <div className="w-[300px] shrink-0">
          <div className="qs-card max-h-[62vh] overflow-y-auto p-2">
            {hits ? (
              hits.length === 0 ? (
                <Empty text={KB_EMPTY_STATES.searchEmpty.text} hint={KB_EMPTY_STATES.searchEmpty.hint} emptyKey={KB_EMPTY_STATES.searchEmpty.key} />
              ) : (
                <div className="space-y-1">
                  <div className="qs-meta px-1.5 py-1" style={{ color: 'var(--color-ink-faint)' }}>
                    命中 {hits.length} 篇
                  </div>
                  {hits.map((h) => (
                    <button
                      key={`${h.path}#${h.score}`}
                      type="button"
                      className="qs-interactive block w-full cursor-pointer rounded-[4px] border px-2.5 py-2 text-left"
                      style={{ borderColor: 'var(--color-line)' }}
                      onClick={() => void openDoc(h.path)}
                    >
                      <div className="truncate text-[13px] font-medium">{h.title}</div>
                      <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
                        {h.path} · {h.matchMode === 'fts' ? '全文命中' : '短词匹配'}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                        {h.snippet}
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : docs.length === 0 ? (
              islandOnly ? (
                <Empty text={KB_EMPTY_STATES.noIslands.text} hint={KB_EMPTY_STATES.noIslands.hint} emptyKey={KB_EMPTY_STATES.noIslands.key} />
              ) : (stats?.docCount ?? 0) === 0 ? (
                <Empty text={KB_EMPTY_STATES.kbNoDocs.text} hint={KB_EMPTY_STATES.kbNoDocs.hint} emptyKey={KB_EMPTY_STATES.kbNoDocs.key} />
              ) : (
                <Empty text="该范围内暂无文档" />
              )
            ) : (
              <div className="space-y-0.5">
                <div className="qs-meta flex items-center justify-between px-1.5 py-1" style={{ color: 'var(--color-ink-faint)' }}>
                  <span>
                    {islandOnly
                      ? `孤岛文档 · ${docs.length} 篇`
                      : filter.tag
                        ? `标签：${filter.tag}`
                        : filter.dir
                          ? `目录：${filter.dir || '根目录'}`
                          : '全部文档'} · {docs.length} 篇
                  </span>
                  {islandOnly ? (
                    <button
                      type="button"
                      className="cursor-pointer rounded-[4px] px-1 text-[11px] transition-colors"
                      style={{ color: 'var(--color-signal)' }}
                      onClick={() => void toggleIsland()}
                    >
                      清除
                    </button>
                  ) : null}
                </div>
                {docs.map((d) => (
                  <button
                    key={d.path}
                    type="button"
                    className={`qs-nav-item w-full text-left ${doc?.path === d.path ? 'active' : ''}`}
                    onClick={() => void openDoc(d.path)}
                    title={d.path}
                  >
                    <span className="min-w-0 flex-1 truncate">{d.title}</span>
                    <span className="qs-meta shrink-0 tabular">{d.mtime ? d.mtime.slice(5, 10) : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右：阅读区 */}
        <div className="min-w-0 flex-1">
          <div className="qs-card max-h-[62vh] overflow-y-auto p-5">
            {!doc ? (
              /* 阅读区空态（意见 N6）：不只是一行「从左侧选择」，而是承担「引导下一步」的职责：
                 最近阅读 3 篇 + 今日热点入口 + 健康度一行摘要，把 2/3 屏空间用起来 */
              <div data-qs-empty={KB_EMPTY_STATES.kbNoDocSelected.key} className="space-y-4">
                <div>
                  <h3 className="font-display text-[17px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                    从左侧选一篇文档开始阅读
                  </h3>
                  <p className="qs-meta mt-1" style={{ color: 'var(--color-ink-faint)' }}>
                    {KB_EMPTY_STATES.kbNoDocSelected.hint}
                  </p>
                </div>

                {/* 最近更新（取 stats.recent 前 3 篇，点击直接打开） */}
                {(stats?.recent ?? []).length > 0 ? (
                  <div>
                    <div className="qs-meta mb-1.5 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      最近更新
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(stats?.recent ?? []).slice(0, 3).map((d) => (
                        <button
                          key={d.path}
                          type="button"
                          className="qs-clickable rounded-[4px] border px-3 py-2 text-left transition-colors hover:border-[var(--color-line-strong)]"
                          style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}
                          onClick={() => void openDoc(d.path)}
                          title={d.path}
                        >
                          <span className="block truncate text-[13px] font-medium">{d.title}</span>
                          <span className="qs-meta block truncate text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                            {d.dir || '根目录'} · {d.tags.slice(0, 3).join('、') || '无标签'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* 下一步入口：每日热点 → 收进灵感库 */}
                <button
                  type="button"
                  className="qs-clickable flex w-full items-center gap-3 rounded-[4px] border px-3 py-2.5 text-left transition-colors hover:border-[var(--color-line-strong)]"
                  style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}
                  onClick={() => setView('hot')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">打开每日热点</span>
                    <span className="qs-meta block text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                      把值得留的素材收进灵感库
                    </span>
                  </span>
                  <span className="qs-meta shrink-0" style={{ color: 'var(--color-signal)' }}>
                    →
                  </span>
                </button>

                {/* 健康度一行摘要 */}
                <p className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                  知识库共 {stats?.docCount ?? 0} 篇 · {stats?.tagCount ?? 0} 个标签 · {stats?.dirCount ?? 0} 个目录
                  {health?.islands ? ` · 孤岛 ${health.islands.count} 篇` : ''}
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 border-b pb-3" style={{ borderColor: 'var(--color-line)' }}>
                  <h3 className="font-display text-[19px] font-bold leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
                    {doc.title}
                  </h3>
                  <div className="qs-meta mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--color-ink-faint)' }}>
                    <span>{doc.path}</span>
                    <span>更新 {doc.mtime ? doc.mtime.slice(0, 16).replace('T', ' ') : '—'}</span>
                    {doc.tags.length > 0 ? <span>标签 {doc.tags.join(' / ')}</span> : null}
                  </div>
                  {doc.anchors.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {doc.anchors.slice(0, 12).map((a) => (
                        <span key={a.anchor} className="rounded-[4px] border px-1.5 py-0.5 text-[11px]" style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }} title={`章节片段：${a.anchor}`}>
                          {a.title}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Markdown text={doc.content} onOpenDoc={(p) => void openDoc(p)} />
              </>
            )}
          </div>
        </div>
      </div>

      <VaultConfigModal
        open={configOpen}
        status={status}
        onClose={() => setConfigOpen(false)}
        onSaved={() => {
          setDoc(null);
          setHits(null);
          void reloadAll();
        }}
      />
    </div>
  );
}
