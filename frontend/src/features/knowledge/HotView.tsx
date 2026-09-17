import { useCallback, useEffect, useState } from 'react';
import type { AttentionConfig, AttentionDomain, HotDailyInfo, HotEvidenceLevel, HotItem, HotPanel, HotSourceConfig, HotTier } from '@workbench/shared';import { Badge, Btn, Empty, Modal, ModalFooter, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { fmtTime } from '../../lib/format.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { KB_EMPTY_STATES } from './kbEmpty.ts';

/** 证据等级中文映射（5.4：多源事件 / 单源 / 可回查原文） */
const EVIDENCE_LABEL: Record<HotEvidenceLevel, string> = {
  'multi-source': '多源事件',
  'single-source': '单源',
  traceable: '可回查原文',
};

/** 源分层上限选项（空 = 按 vertical 兜底：非电商垂直默认浏览） */
const TIER_CAP_OPTIONS: { value: '' | HotTier; label: string }[] = [
  { value: '', label: '自动（非电商垂直→浏览）' },
  { value: 'mustRead', label: '必看（不限）' },
  { value: 'browse', label: '浏览' },
  { value: 'other', label: '其他' },
];

/* report-driven-fixes 3.8：源管理降级——adapter/vertical 编辑界面已隐藏，
   KNOWN_ADAPTERS / VERTICAL_OPTIONS 常量随之移除（适配器注册表以后端为准，新增源无需改聚合代码） */

/**
 * 热点面板扩展类型（Q1 全量展示集 / Q5 未展示条数）：
 * 后端在 HotPanel 上追加的字段；旧缓存/降级面板可能没有，前端一律按可选处理。
 */
export type HotPanelExt = HotPanel & {
  aiTags?: Record<string, { cls?: 'dir' | 'ref' | 'none'; tag?: string; use?: string }>;
  aiTagged?: boolean;
  aiDegraded?: boolean;
  /** 全量展示集（前端三分组以此为数据源） */
  displaySet?: HotItem[];
  /** 未展示条数（上游原始条目数 - 展示数，主要来自去重合并） */
  hiddenCount?: number;
  /** 上游原始条目数（去重前） */
  rawCount?: number;
  /** 各源贡献的展示条数 */
  sourceCounts?: Record<string, number>;
};

/** 5.2 信息条：新鲜度 + 源状态摘要 + 上游日报外链（无日报时退化为仅新鲜度） */
function InfoBar({ panel }: { panel: HotPanelExt }) {
  const ok = panel.sources.filter((s) => s.status === 'ok').length;
  const degraded = panel.sources.filter((s) => s.status === 'degraded');
  const daily = panel.daily as HotDailyInfo | null;
  const hasDaily = daily && daily.url;
  // P1-14 追问修复：给出「条目本身的最新发布时间」——
  // 让「热点停在 11 日」一眼可辨：是抓取时间旧（我们慢了）还是发布时间旧（上游没更新）。
  // 二者分开讲，用户就不会把上游停更误判为刷新失灵。
  // Q1：全量展示集优先（旧缓存/降级面板回退 tiers）
  const allItems: HotItem[] = panel.displaySet?.length
    ? panel.displaySet
    : (['mustRead', 'browse', 'other'] as const).flatMap((t) => panel?.tiers[t] ?? []);
  const allLatest = allItems
    .map((i) => i.latestAt)
    .filter((v): v is string => !!v)
    .sort();
  const newest = allLatest[allLatest.length - 1] ?? null;
  const newestAgeDays = newest ? Math.floor((Date.now() - Date.parse(newest)) / 86400000) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }} data-hot-infobar>
      <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
        抓取于 {fmtTime(panel.fetchedAt)}
      </span>
      {newest ? (
        <span
          className="qs-meta"
          style={{ color: newestAgeDays && newestAgeDays >= 1 ? 'var(--color-warn)' : 'var(--color-ink-soft)' }}
          title={newestAgeDays && newestAgeDays >= 1 ? `上游最新内容发布于 ${newest.slice(0, 10)}，已 ${newestAgeDays} 天未更新——通常是信息源本身暂无新内容，与本工作台刷新无关` : '上游内容较新'}
        >
          条目最新发布 {newest.slice(0, 10)}
          {newestAgeDays && newestAgeDays >= 1 ? `（${newestAgeDays} 天前 · 上游暂无更新）` : ''}
        </span>
      ) : null}
      <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
        源状态 {ok}/{panel.sources.length} 个源可用
        {degraded.length > 0 ? ` · ${degraded.map((s) => `${s.label}降级${s.error ? `：${s.error}` : ''}`).join('；')}` : ''}
      </span>
      {hasDaily && daily ? (
        <a
          className="qs-meta inline-flex items-center gap-1 hover:underline"
          style={{ color: 'var(--color-signal)' }}
          href={daily.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          data-hot-daily
        >
          {daily.title ?? '上游日报'} {daily.date ? ` ${daily.date}` : ''} · {daily.count} 条
          {daily.publishedAt ? ` · ${fmtTime(daily.publishedAt)} 发布` : ''}
          <span aria-hidden="true">打开日报 ↗</span>
        </a>
      ) : null}
    </div>
  );
}

/** 5.7 三态降级提示：live 不渲染；stale/unavailable 文案与色调可区分 */
function DegradeNotice({ panel, onRetry, loading }: { panel: HotPanel; onRetry: () => void; loading: boolean }) {
  if (panel.status === 'live') return null;
  const stale = panel.status === 'stale';
  const tone = stale ? 'var(--color-warn)' : 'var(--color-danger)';
  const soft = stale ? 'var(--color-warn-soft)' : 'var(--color-danger-soft)';
  return (
    <div className="rounded-[4px] border px-3 py-2.5" style={{ borderColor: tone, background: soft }} data-hot-degrade={panel.status}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium" style={{ color: tone }}>
            {stale ? '展示最近一次缓存内容' : '热点源暂不可用'}
          </div>
          <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-soft)' }}>
            {stale && panel.fetchedAt ? `缓存时间 ${fmtTime(panel.fetchedAt)} · ` : ''}
            {panel.error?.message ?? '拉取失败'}
            {stale ? '' : ' · 不影响知识库其他功能与工作流板块'}
          </div>
        </div>
        <Btn size="sm" variant={stale ? 'default' : 'danger'} loading={loading} onClick={onRetry}>
          重试
        </Btn>
      </div>
    </div>
  );
}

/** 单条热点卡片：只读情报 + 收进灵感库（5.3/5.4/5.5；report-driven-fixes 0.5：主操作唯一化为「收进灵感库」，移除「挂到工作流」） */
function HotCard({ item, index }: { item: HotItem; index: number }) {
  const { pushToast } = useWorkbench();
  const seq = String(index + 1).padStart(2, '0');
  const evidence = item.evidence;
  const hasLatest = item.latest && item.latest.trim().length > 0;
  /** P1·8.4：摘要默认截断 4 行，可展开查看全文 */
  const [expanded, setExpanded] = useState(false);
  const [collecting, setCollecting] = useState(false);

  /** 收进灵感库：小助理整理单条热点，产出落盘 知识库/灵感库/（0.1 只读承诺的「唯一新增点」） */
  const collect = async () => {
    if (collecting) return;
    setCollecting(true);
    try {
      const r = await api.kbOrganize({
        kind: 'hot',
        item: {
          id: item.id,
          title: item.title,
          summary: item.summary ?? undefined,
          sourceName: item.sourceName ?? item.source ?? undefined,
          source: item.source ?? undefined,
          url: item.url ?? undefined,
        },
      });
      pushToast({ message: `已收进灵感库：${r.title ?? item.title}`, tone: 'ok', duration: 6000, key: 'kb-organize' });
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : '收进灵感库失败', tone: 'no', duration: 8000, key: 'kb-organize' });
    } finally {
      setCollecting(false);
    }
  };
  return (
    <div className="qs-card flex h-full flex-col p-3" data-hot-card>
      <div className="flex items-start justify-between gap-3">
        <div className="hot-seq shrink-0 pt-0.5" style={{ color: 'var(--color-ink-faint)' }} data-hot-seq>
          {seq}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium leading-snug">{item.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {evidence ? (
              <span className="qs-badge signal" data-hot-evidence={evidence}>
                {EVIDENCE_LABEL[evidence]}
              </span>
            ) : null}
            {item.domains.map((d) => (
              <span key={d.id} className="qs-meta" style={{ color: 'var(--color-signal)' }} data-hot-domain={d.id}>
                #{d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 5.5 双层内容：讯息（摘要）/ 最新进展（无 latest 时隐藏该层）
          P1·8.4：摘要固定截断 4 行并可展开，避免长短不一的卡片把高度差拉大 */}
      {item.summary ? (
        <div className="mt-2" data-hot-layer="summary">
          <div
            className="text-[12.5px] leading-relaxed"
            style={{
              color: 'var(--color-ink-soft)',
              display: expanded ? 'block' : '-webkit-box',
              WebkitLineClamp: expanded ? undefined : 4,
              WebkitBoxOrient: 'vertical',
              overflow: expanded ? undefined : 'hidden',
            }}
          >
            {item.summary}
          </div>
          {item.summary.length > 120 ? (
            <button
              type="button"
              className="qs-clickable qs-meta mt-1"
              style={{ color: 'var(--color-signal)' }}
              onClick={() => setExpanded((p) => !p)}
            >
              {expanded ? '收起' : '展开全文'}
            </button>
          ) : null}
        </div>
      ) : null}
      {hasLatest ? (
        <div className="mt-2 rounded-[4px] border-l-2 pl-2 text-[12.5px] leading-relaxed" style={{ borderColor: 'var(--color-signal)', color: 'var(--color-ink-soft)' }} data-hot-layer="latest">
          <span className="qs-meta mr-1" style={{ color: 'var(--color-ink-faint)' }}>
            最新进展
          </span>
          {item.latest}
        </div>
      ) : null}

      <div className="qs-meta mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-2.5" style={{ color: 'var(--color-ink-faint)' }}>
        <span>{item.sourceName ?? item.source}</span>
        {item.sourceCount > 1 ? <span>{item.sourceCount} 个信源</span> : null}
        <span>{fmtTime(item.latestAt)}</span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="qs-meta min-w-0 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
          {item.reason}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Btn size="sm" variant="primary" loading={collecting} onClick={() => void collect()} title="小助理整理后写入 知识库/灵感库/">
            收进灵感库
          </Btn>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="qs-meta hover:underline" style={{ color: 'var(--color-signal)' }}>
              查看原文 ↗
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 2.8 挂到工作流已移除（report-driven-fixes 0.5：热点卡片主操作唯一化为「收进灵感库」，挂到工作流入口迁至知识库文档行 0.9） */

/**
 * 热点源配置编辑器（P1·8.1：原「关注域与数据源配置」统一更名为「热点源配置」，
 * 与触发按钮文案一致；3.5/4.7：排除词 / 多词阈值 / 源管理；本地保存，不入版本库）
 *
 * 布局约束：宽度一律用 Tailwind 工具类（w-[Npx] / flex-1）表达，不要改成行内 style 或改写 qs-input。
 * 背景：index.css 的 .qs-input 曾经未被 @layer 包裹，其 width:100% 会压过所有宽度工具类，导致本弹窗内
 * flex-1 的输入框被撑满同行兄弟节点挤成 0 宽度而完全不可见。现已把组件类统一放进 @layer components
 * （base < components < utilities），工具类恢复覆盖能力；改动这些宽度时请保持用工具类，避免重蹈覆辙。
 */
function AttentionModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { pushToast } = useWorkbench();
  const [config, setConfig] = useState<AttentionConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 展开态：关注域 / 数据源（默认折叠，收进「展开 / 管理 ▸」）
  // ⚠ 必须在任何 early return 之前声明：否则 open 由 false→true 时 Hook 数量变化，React 会崩溃
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    void api
      .hotAttention()
      .then((r) => setConfig(r.config))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open]);

  if (!open) return null;

  const patchDomain = (id: string, next: Partial<AttentionDomain>) =>
    setConfig((prev) => (prev ? { ...prev, domains: prev.domains.map((d) => (d.id === id ? { ...d, ...next } : d)) } : prev));

  const patchSource = (id: string, next: Partial<HotSourceConfig>) =>
    setConfig((prev) =>
      prev ? { ...prev, sources: (prev.sources ?? []).map((s) => (s.id === id ? { ...s, ...next } : s)) } : prev,
    );

  const save = async () => {
    if (!config) return;
    // report-driven-fixes 3.8：关注域界面已隐藏（数据保留），空域守卫不再阻断保存——
    // 否则用户无法修复隐藏字段、源配置将永远无法落库；空域由后端自行处理。
    setBusy(true);
    setError(null);
    try {
      await api.hotSaveAttention(config);
      onSaved();
      pushToast({ message: '热点源配置已保存', tone: 'ok', duration: 4000 });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const domainInvalid = !!config && config.domains.some((d) => (d.keywords?.length ?? 0) === 0);

  return (
    <Modal open={open} title="热点源配置" onClose={onClose} width={640}>
      {!config ? (
        <Spinner label="配置加载中…" />
      ) : (
        <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1">
          {/* report-driven-fixes 3.8：关注域界面隐藏（数据保留，代码保留）——域关键词编辑不再提供 UI，
              保存时 domains 原样提交后端 */}
          {false && (
          <section>
            <div className="flex items-center justify-between">
              <div className="qs-meta font-medium" style={{ color: 'var(--color-ink-soft)' }}>我关心什么（关注域）</div>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  const id = `custom-${Date.now()}`;
                  setConfig((prev) => (prev ? { ...prev, domains: [...prev.domains, { id, label: '', keywords: [], excludeKeywords: [], minKeywordHits: 2, enabled: true }] } : prev));
                  setExpandedDomains((p) => ({ ...p, [id]: true }));
                }}
              >
                + 新增
              </Btn>
            </div>
            <div className="mt-2 space-y-1.5">
              {/* 恒 false 死代码：TS 不会在此传播 else 分支的 config 窄化，需非空断言（该分支永不执行） */}
              {config!.domains.map((d) => {
                const open = expandedDomains[d.id] ?? false;
                return (
                  <div key={d.id} className="rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
                    <div className="flex items-center gap-2 p-2.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 shrink-0 accent-[var(--color-signal)]"
                        checked={d.enabled !== false}
                        onChange={(e) => patchDomain(d.id, { enabled: e.target.checked })}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={d.label || '未命名关注域'}>
                        {d.label || '未命名关注域'}
                      </span>
                      <span className="qs-meta shrink-0">灵敏度 {d.minKeywordHits ?? 2}</span>
                      <span className="qs-meta shrink-0">关键词 {d.keywords.length} 个</span>
                      <Btn size="sm" variant="ghost" onClick={() => setExpandedDomains((p) => ({ ...p, [d.id]: !(p[d.id] ?? false) }))}>
                        {open ? '收起' : '展开'}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfig((prev) => (prev ? { ...prev, domains: prev.domains.filter((x) => x.id !== d.id) } : prev))}
                      >
                        删除
                      </Btn>
                    </div>
                    {open ? (
                      <div className="space-y-2 border-t p-2.5" style={{ borderColor: 'var(--color-line)' }}>
                        <input className="qs-input" value={d.label} onChange={(e) => patchDomain(d.id, { label: e.target.value })} placeholder="关注域名称" />
                        <input
                          className="qs-input"
                          value={d.keywords.join(', ')}
                          onChange={(e) => patchDomain(d.id, { keywords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
                          placeholder="关键词，逗号分隔（至少 1 个，否则该域无法命中）"
                        />
                        <input
                          className="qs-input"
                          value={(d.excludeKeywords ?? []).join(', ')}
                          onChange={(e) => patchDomain(d.id, { excludeKeywords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
                          placeholder="排除词（命中任一则该域作废），逗号分隔"
                        />
                        <div className="flex items-center gap-2">
                          <span className="qs-meta shrink-0">命中≥</span>
                          <input
                            className="qs-input w-[52px]"
                            type="number"
                            min={1}
                            max={5}
                            value={d.minKeywordHits ?? 2}
                            onChange={(e) => patchDomain(d.id, { minKeywordHits: Number(e.target.value) || 2 })}
                            title="同一关注域需命中 ≥该阈值个不同关键词才成立（默认 2）"
                          />
                          <span className="qs-meta shrink-0">词</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {domainInvalid ? (
              <p className="qs-meta mt-1.5" style={{ color: 'var(--color-warn)' }}>
                有未配置关键词的关注域，保存已禁用——请至少填写 1 个关键词
              </p>
            ) : null}
          </section>
          )}

          {/* 分层规则：阈值归拢，界面即规则（补回缺失的三档上限） */}
          <section>
            <div className="qs-meta font-medium" style={{ color: 'var(--color-ink-soft)' }}>分层规则</div>
            <div className="mt-2 space-y-2 rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)' }}>
              <p className="qs-meta leading-relaxed">
                必看：命中关注域 且 ≥ <span className="font-semibold">不同信源</span> 报道；浏览：命中关注域、信源较少；其他：未命中任何关注域。
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="qs-meta shrink-0">每档最多显示</span>
                <label className="flex items-center gap-1">
                  <span className="qs-meta shrink-0">必看</span>
                  <input className="qs-input w-[52px]" type="number" min={1} value={config.mustReadLimit ?? 3} onChange={(e) => setConfig((prev) => (prev ? { ...prev, mustReadLimit: Number(e.target.value) || 1 } : prev))} />
                  <span className="qs-meta shrink-0">条</span>
                </label>
                <label className="flex items-center gap-1">
                  <span className="qs-meta shrink-0">浏览</span>
                  <input className="qs-input w-[52px]" type="number" min={1} value={config.browseLimit ?? 8} onChange={(e) => setConfig((prev) => (prev ? { ...prev, browseLimit: Number(e.target.value) || 1 } : prev))} />
                  <span className="qs-meta shrink-0">条</span>
                </label>
                <label className="flex items-center gap-1">
                  <span className="qs-meta shrink-0">其他</span>
                  <input className="qs-input w-[52px]" type="number" min={1} value={config.otherLimit ?? 12} onChange={(e) => setConfig((prev) => (prev ? { ...prev, otherLimit: Number(e.target.value) || 1 } : prev))} />
                  <span className="qs-meta shrink-0">条</span>
                </label>
              </div>
              <div className="flex items-center gap-2 border-t pt-2" style={{ borderColor: 'var(--color-line)' }}>
                <span className="qs-meta shrink-0">进入必看所需最少信源</span>
                <input
                  className="qs-input w-[52px]"
                  type="number"
                  min={1}
                  max={20}
                  value={config.minimumSources ?? 2}
                  onChange={(e) => setConfig((prev) => (prev ? { ...prev, minimumSources: Number(e.target.value) || 1 } : prev))}
                />
              </div>
            </div>
          </section>

          {/* 数据源：默认视图只显状态点+源名+上限，技术字段收进「管理 ▸」 */}
          <section>
            <div className="flex items-center justify-between">
              <div className="qs-meta font-medium" style={{ color: 'var(--color-ink-soft)' }}>数据源（{config.sources?.length ?? 0}）</div>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  const id = `src-${Date.now()}`;
                  setConfig((prev) =>
                    prev
                      ? { ...prev, sources: [...(prev.sources ?? []), { id, adapter: 'pai-news', label: '新数据源', endpoint: '', vertical: 'ecommerce-news', enabled: true }] }
                      : prev,
                  );
                  setExpandedSources((p) => ({ ...p, [id]: true }));
                }}
              >
                + 新增
              </Btn>
            </div>
            <div className="mt-2 space-y-1.5">
              {(config.sources ?? []).map((s) => {
                const open = expandedSources[s.id] ?? false;
                return (
                  <div key={s.id} className="rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
                    <div className="flex items-center gap-2 p-2.5">
                      <span className={`qs-dot ${s.enabled !== false ? 'ok' : 'no'}`} title={s.enabled !== false ? '启用' : '已停用'} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={s.id}>
                        {s.label}
                      </span>
                      <select
                        className="qs-input w-[150px] shrink-0"
                        value={s.tierCap ?? ''}
                        onChange={(e) => patchSource(s.id, { tierCap: (e.target.value || undefined) as HotTier | undefined })}
                        title="源分层上限"
                      >
                        {TIER_CAP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <Btn size="sm" variant="ghost" onClick={() => setExpandedSources((p) => ({ ...p, [s.id]: !(p[s.id] ?? false) }))}>
                        管理 ▸
                      </Btn>
                      <Btn
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfig((prev) => (prev ? { ...prev, sources: (prev.sources ?? []).filter((x) => x.id !== s.id) } : prev))}
                      >
                        删除
                      </Btn>
                    </div>
                    {open ? (
                      <div className="space-y-2 border-t p-2.5" style={{ borderColor: 'var(--color-line)' }}>
                        <div className="flex items-center gap-2">
                          <span className="qs-meta w-[64px] shrink-0">显示名称</span>
                          <input className="qs-input flex-1" value={s.label} onChange={(e) => patchSource(s.id, { label: e.target.value })} placeholder="显示名称" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="qs-meta w-[64px] shrink-0">抓取地址</span>
                          <input className="qs-input flex-1" value={s.endpoint} onChange={(e) => patchSource(s.id, { endpoint: e.target.value })} placeholder="抓取地址 URL" />
                        </div>
                        {/* report-driven-fixes 3.8：源管理降级——展开区仅保留 显示名称 / 抓取地址；
                            抓取方式(adapter)与内容类型(vertical)的编辑界面隐藏（数据保留在 config，保存时原样提交） */}
                        {s.enterpriseCredentialRequired ? (
                          <div className="qs-meta" style={{ color: 'var(--color-warn)' }}>
                            ⚠ 该源标记为需企业资质/账号（本期预留，未提供凭据时该源降级）
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
      {error ? (
        <p className="qs-meta mt-2" style={{ color: 'var(--color-danger)' }}>
          ● {error}
        </p>
      ) : null}
      <ModalFooter>
        <Btn size="sm" onClick={onClose}>
          取消
        </Btn>
        {/* 3.8：关注域界面隐藏后 domainInvalid 不再禁用保存（见 save() 注释） */}
        <Btn size="sm" variant="primary" loading={busy} disabled={!config} onClick={() => void save()}>
          保存
        </Btn>
      </ModalFooter>
    </Modal>
  );
}

/** 每日热点视图：只读情报面板（多源 / 三态降级 / 电商化分层 / A4 排版） */
export function HotView() {
  // report-driven-fixes 3.5：后端在 panel 上扩展 aiTags（条目 id → AI 打标分组），类型对齐 api.hotPanel 返回
  // Q1：displaySet = 全量展示集（旧版只给了分层截断后的 13 条，热榜源一条都上不了屏）
  // Q5：hiddenCount = 未展示条数（去重合并掉的），避免「看不到 = 没有」的误判
  const [panel, setPanel] = useState<HotPanelExt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // 37：「其他」分组默认折叠，避免大量未命中关注域的信息抢占首屏
  const [collapsedOther, setCollapsedOther] = useState(true);

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.hotPanel(refresh);
      setPanel(r.panel);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  // report-driven-fixes 3.5：三分组（产出方向 / 可参考 / 无关），按后端 AI 打标结果（panel.aiTags[id].cls）归类。
  // 后端 hot-tagging 未下发 cls（LLM 失败降级）时该条目兜底进「可参考」。
  // Q1：数据源从「分层截断后的 tiers」改为「全量展示集 displaySet」——
  //     三分组本身就是筛选，不该在后端先丢条目；热榜源（微博/抖音/头条）因此能上屏。
  //     displaySet 缺失（旧缓存/降级面板）时回退 tiers，保证不白屏。
  const TIER_KEYS = ['mustRead', 'browse', 'other'] as const;
  const displayItems: HotItem[] = panel?.displaySet?.length
    ? panel.displaySet
    : TIER_KEYS.flatMap((t) => panel?.tiers[t] ?? []);
  const GROUPS: { key: 'dir' | 'ref' | 'none'; label: string; hint: string }[] = [
    { key: 'dir', label: '产出方向', hint: '与当前工作直接相关、可作产出依据' },
    { key: 'ref', label: '可参考', hint: '作为行业背景参考' },
    { key: 'none', label: '无关', hint: '与当前工作无关，默认折叠' },
  ];
  const aiTags = panel?.aiTags ?? {};
  const clsOf = (item: HotItem): 'dir' | 'ref' | 'none' => aiTags[item.id]?.cls ?? 'ref';
  const groups = GROUPS.map((g) => ({
    ...g,
    items: displayItems.filter((item) => clsOf(item) === g.key),
  }));
  const groupTotal = groups.reduce((n, g) => n + g.items.length, 0);
  const groupCount = (key: 'dir' | 'ref' | 'none') => groups.find((g) => g.key === key)?.items.length ?? 0;

  // 37：卡片序号跨分组全局连续（不受分组折叠影响）
  const seqById = new Map<string, number>();
  {
    let n = 0;
    for (const g of groups) for (const item of g.items) seqById.set(item.id, n++);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* 5.6 衬线 Display 大标题。
              命名边界（用户定案）：本模块叫「每日热点」；「灵感库」是它沉淀到知识库里的目录名，两者不是一回事。 */}
          <h2 className="font-display text-[22px] font-bold leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            每日热点
          </h2>
          <p className="qs-meta mt-1" style={{ color: 'var(--color-ink-faint)' }}>
            {panel?.sourceName ?? '多源热点'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {panel ? (
            <Badge tone={panel.status === 'live' ? 'ok' : panel.status === 'stale' ? 'warn' : 'no'}>
              {panel.status === 'live' ? '实时' : panel.status === 'stale' ? '缓存（源不可用）' : '不可用'}
            </Badge>
          ) : null}
          <Btn size="sm" loading={loading} onClick={() => void load(true)}>
            刷新
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfigOpen(true)}>
            灵感库设置
          </Btn>
        </div>
      </div>

      {error ? (
        <p className="qs-meta" style={{ color: 'var(--color-danger)' }}>
          ● {error}
        </p>
      ) : null}

      {panel ? <InfoBar panel={panel} /> : null}
      {panel ? <DegradeNotice panel={panel} loading={loading} onRetry={() => void load(true)} /> : null}

      {loading && !panel ? (
        <Spinner label="热点加载中…" />
      ) : !panel || panel.status === 'unavailable' ? (
        <Empty text={KB_EMPTY_STATES.hotEmptyUnavailable.text} hint={KB_EMPTY_STATES.hotEmptyUnavailable.hint} emptyKey={KB_EMPTY_STATES.hotEmptyUnavailable.key} />
      ) : panel.counts.upstream === 0 ? (
        <Empty text={KB_EMPTY_STATES.hotEmptyNone.text} hint={KB_EMPTY_STATES.hotEmptyNone.hint} emptyKey={KB_EMPTY_STATES.hotEmptyNone.key} />
      ) : (
        <>
          {/* 统计区（report-driven-fixes 3.5 重构口径）：
              原「上游抓取 / 今日必看 / 今日精选」与分层展示口径不一致；
              改为与列表同源的三分组计数：今日收集（全部条目）· 产出方向 · 可参考
              刷新时间保留 = 让「点刷新」有可见反馈 */}
          <div className="qs-card flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5" data-hot-pills>
            <span className="inline-flex items-baseline gap-1.5">
              <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                今日收集
              </span>
              <span className="font-display tabular text-[15px] font-bold">{groupTotal}</span>
              <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                条
              </span>
            </span>
            <span className="inline-flex items-baseline gap-1.5">
              <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                产出方向
              </span>
              <span className="font-display tabular text-[15px] font-bold">{groupCount('dir')}</span>
            </span>
            <span className="qs-meta inline-flex items-baseline gap-1.5" style={{ color: 'var(--color-ink-faint)' }}>
              可参考
              <span className="font-display tabular text-[15px] font-bold">{groupCount('ref')}</span>
            </span>
            {/* Q5：未展示条数提示（上游总数 - 展示数，主要来自三层去重合并），避免「看不到 = 没有」的误判 */}
            {panel && (panel.hiddenCount ?? 0) > 0 ? (
              <span
                className="qs-meta"
                style={{ color: 'var(--color-ink-faint)' }}
                title={`上游共抓到 ${panel.rawCount ?? groupTotal} 条，展示 ${groupTotal} 条；其余 ${panel.hiddenCount} 条因与其他条目重复（三层去重合并）未单独展示，已并入同类条目`}
                data-hot-hidden
              >
                另有 {panel.hiddenCount} 条未展示（重复合并）
              </span>
            ) : null}
            <span className="qs-meta ml-auto" style={{ color: 'var(--color-ink-faint)' }} title="最近一次抓取完成时间；点右上「刷新」可立即重抓">
              更新于 {fmtTime(panel.fetchedAt)}
            </span>
          </div>

          {groups.map((g) => {
            const list = g.items;
            if (list.length === 0) return null;
            /* report-driven-fixes 3.5：「无关」分组默认折叠（承接原「其他」分组的折叠行为）；其余常开 */
            const collapsible = g.key === 'none';
            const collapsed = collapsible && collapsedOther;
            /* 意见 #11 / P1：标题行本身即可双向切换（▸ 折叠 / ▾ 展开），不再另挂「收起」按钮。
               折叠态与展开态共用同一标题行，保证任何状态下都能收能展。 */
            const header = (
              <div
                className={`flex w-full items-baseline gap-2 border-b pb-1.5 ${collapsible ? 'qs-clickable' : ''}`}
                style={{ borderColor: 'var(--color-line)' }}
                title={g.hint}
                onClick={collapsible ? () => setCollapsedOther((p) => !p) : undefined}
                role={collapsible ? 'button' : undefined}
                aria-expanded={collapsible ? !collapsed : undefined}
              >
                {collapsible ? (
                  <span aria-hidden="true" className="qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)', width: 12, display: 'inline-block' }}>
                    {collapsed ? '▸' : '▾'}
                  </span>
                ) : null}
                {/* P1-15/新6 验收打回：折叠与展开共用同一字号，消除切换时的字体跳动；
                    折叠态仅以颜色降级区分，不改字号、不改行高 */}
                <h3
                  className="font-display text-[15px] font-semibold leading-6"
                  style={{ fontFamily: 'var(--font-display)', color: collapsed ? 'var(--color-ink-soft)' : undefined }}
                >
                  {g.label}
                </h3>
                <span className="qs-meta leading-6" style={{ color: 'var(--color-ink-faint)' }}>
                  {list.length} 条
                </span>
              </div>
            );

            return (
              <section key={g.key} className={collapsed ? '' : 'space-y-2.5'} data-hot-tier={g.key} data-collapsed={collapsed ? '1' : '0'}>
                {header}
                {collapsed ? null : (
                  /* 5.6 响应式多栏网格（37：序号全局连续） */
                  <div className="hot-grid">
                    {list.map((item) => (
                      <HotCard key={item.id} item={item} index={seqById.get(item.id) ?? 0} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      <AttentionModal open={configOpen} onClose={() => setConfigOpen(false)} onSaved={() => void load(true)} />
    </div>
  );
}
