import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeDirInfo, KnowledgeDoc, KnowledgeDocSummary, KnowledgeHealth, KnowledgeSearchHit, KnowledgeStats, KnowledgeStatus, KnowledgeTagInfo } from '@workbench/shared';
import { Badge, Btn, Empty, Field, Glyph, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { KB_EMPTY_STATES } from './kbEmpty.ts';
import { KnowledgeOverviewBar } from './KnowledgeOverviewBar.tsx';
import { Markdown } from './Markdown.tsx';

/** 逗号/换行分隔的目录配置 ↔ 数组 */
function parseDirs(text: string): string[] {
  return text
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Vault 连接配置（设置面板）：Vault 根路径 + 目录白名单 / 排除目录（坑5：只读且不全盘托出）。
 * 保存后由后端触发后台重建索引。
 */
export function VaultConfigModal({ open, status, onClose, onSaved }: { open: boolean; status: KnowledgeStatus | null; onClose: () => void; onSaved: () => void }) {
  const [root, setRoot] = useState('');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [presetProducts, setPresetProducts] = useState('');
  const [presetBrand, setPresetBrand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoot(status?.root ?? '');
    setInclude((status?.range.includeDirs ?? []).join(', '));
    setExclude((status?.range.excludeDirs ?? []).filter((d) => !['.git', '.obsidian', '.trash', 'node_modules', '.pnpm-store', 'dist', '.DS_Store'].includes(d)).join(', '));
    setPresetProducts(status?.presets?.products ?? '10_raw/products');
    setPresetBrand(status?.presets?.brand ?? 'wiki/brand');
    setError(null);
  }, [open, status]);

  if (!open) return null;

  const save = async (nextRoot: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.kbSaveConfig({ root: nextRoot, includeDirs: parseDirs(include), excludeDirs: parseDirs(exclude), presetDirs: { products: presetProducts.trim(), brand: presetBrand.trim() } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[10vh]" onClick={onClose}>
      <div className="qs-card w-full p-5" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="font-display mb-1 text-[15px] font-semibold">连接 Obsidian Vault</div>
        <p className="qs-meta mb-3" style={{ color: 'var(--color-ink-faint)' }}>
          只读接入本地 Markdown 目录，工作台不会修改、删除或移动 Vault 内任何文件。
        </p>
        <Field label="Vault 根目录（绝对路径）">
          <input className="qs-input" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="如：D:\\MyVault 或 /Users/me/vault" />
        </Field>
        <Field label="索引目录白名单（可选，留空 = 全库；逗号分隔）">
          <input className="qs-input" value={include} onChange={(e) => setInclude(e.target.value)} placeholder="如：10_raw/products, wiki/brand" />
        </Field>
        <Field label="额外排除目录（可选，逗号分隔）">
          <input className="qs-input" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="如：私人日记, 30_self_media" />
        </Field>
        <div className="my-2 border-t" style={{ borderColor: 'var(--color-line)' }} />
        <p className="qs-meta mb-2" style={{ color: 'var(--color-ink-faint)' }}>
          业务预设依据（目录，供星图「只看产品资料 / 只看品牌规范」使用；留空回退内置默认）
        </p>
        <Field label="预设：产品资料目录">
          <input className="qs-input" value={presetProducts} onChange={(e) => setPresetProducts(e.target.value)} placeholder="如：10_raw/products" />
        </Field>
        <Field label="预设：品牌规范目录">
          <input className="qs-input" value={presetBrand} onChange={(e) => setPresetBrand(e.target.value)} placeholder="如：wiki/brand" />
        </Field>
        <p className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          默认排除：.git / .obsidian / .trash / node_modules / dist。也可用环境变量 WORKBENCH_VAULT_ROOT 兜底配置路径。
        </p>
        {error ? (
          <p className="qs-meta mt-2" style={{ color: 'var(--color-danger)' }}>
            ● {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Btn size="sm" onClick={onClose}>
            取消
          </Btn>
          {status?.root ? (
            <Btn size="sm" variant="danger" disabled={busy} onClick={() => void save('')}>
              断开连接
            </Btn>
          ) : null}
          <Btn size="sm" variant="primary" loading={busy} onClick={() => void save(root)}>
            保存并索引
          </Btn>
        </div>
      </div>
    </div>
  );
}

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
              title={node.dir}
            >
              {node.dir.split('/').pop()}
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

/** 知识库视图（板块 B）：总览统计 + 目录/标签浏览 + 全文搜索 + Markdown 原文阅读 */
export function KnowledgeView() {
  const { kbDocPath, openKbDoc } = useWorkbench();
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

  const reloadAll = useCallback(async () => {
    const st = await loadMeta();
    void loadHealth();
    if (st.state === 'connected') await loadDocs(filter);
  }, [loadMeta, loadDocs, filter, loadHealth]);

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
            <h2 className="font-display text-[20px] font-bold">知识库</h2>
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
          <h2 className="font-display text-[20px] font-bold">知识库</h2>
          <p className="qs-meta mt-1" style={{ color: 'var(--color-ink-faint)' }} title={status.root ?? ''}>
            已连接 · 只读接入
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.indexing ? <Badge tone="signal">索引中…</Badge> : <Badge tone="ok">已连接</Badge>}
          <Btn size="sm" loading={busy} onClick={() => void reindex()}>
            重建索引
          </Btn>
          {/* 35：折叠 / 展开目录与标签栏 */}
          <Btn size="sm" variant="ghost" onClick={() => setCatalogOpen((v) => !v)} title="折叠/展开目录与标签栏">
            {catalogOpen ? '收起目录' : '展开目录'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>
            连接设置
          </Btn>
        </div>
      </div>

      {notice ? (
        <p className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
          {notice}
        </p>
      ) : null}

      {/* 总览带：统计 + 星图缩略预览 + 最近更新 + 健康度小指标（2.2–2.6） */}
      <KnowledgeOverviewBar status={status} stats={stats} health={health} islandOnly={islandOnly} onToggleIsland={() => void toggleIsland()} onOpenDoc={(path) => void openDoc(path)} />

      {/* 搜索 */}
      <div className="qs-card p-3">
        <div className="flex gap-2">
          <input
            className="qs-input flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder="搜索知识库…"
            aria-label="搜索知识库"
          />
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
        {/* 左：目录 + 标签（35：可折叠，收起后三栏变两栏） */}
        {catalogOpen ? (
        <aside className="w-[210px] shrink-0 space-y-4">
          <div className="qs-card p-3">
            <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-faint)' }}>
              目录
            </div>
            {dirs.length === 0 ? <Empty text={KB_EMPTY_STATES.kbNoDirs.text} hint={KB_EMPTY_STATES.kbNoDirs.hint} emptyKey={KB_EMPTY_STATES.kbNoDirs.key} /> : <DirTree dirs={dirs} active={filter.tag ? null : filter.dir} onPick={(dir) => void pick({ dir, tag: null })} />}
          </div>
          <div className="qs-card p-3">
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
        </aside>
        ) : null}

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
              <Empty text="从左侧选择一篇文档阅读" />
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
                <Markdown text={doc.content} />
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
