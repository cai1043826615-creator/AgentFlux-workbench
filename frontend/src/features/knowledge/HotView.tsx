import { useCallback, useEffect, useState } from 'react';
import type { AttentionConfig, AttentionDomain, HotDailyInfo, HotEvidenceLevel, HotItem, HotPanel, HotSourceConfig, HotTier, TaskHotRefInput, TaskListItem } from '@workbench/shared';
import { Badge, Btn, Empty, Modal, ModalFooter, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { KB_EMPTY_STATES } from './kbEmpty.ts';

const TIER_LABEL: Record<HotTier, string> = { mustRead: '今日必看', browse: '浏览', other: '其他' };
const TIER_HINT: Record<HotTier, string> = {
  mustRead: '命中关注域且多信源跟进',
  browse: '命中关注域，信源较少',
  other: '未命中关注域',
};

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

/** 已知适配器 id（注册表后端可扩展；新增源无需改聚合代码） */
const KNOWN_ADAPTERS = ['pai-news', '100ec-24h', 'stats-sjjd', 'aihot'];

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 5.1 顶部统计药丸（数值取接口 counts，前端不重算） */
function Pill({ label, value }: { label: string; value: number }) {
  return (
    <span className="hot-pill" data-hot-pill={label}>
      <b>{value}</b>
      <span>{label}</span>
    </span>
  );
}

/** 5.2 信息条：新鲜度 + 源状态摘要 + 上游日报外链（无日报时退化为仅新鲜度） */
function InfoBar({ panel }: { panel: HotPanel }) {
  const ok = panel.sources.filter((s) => s.status === 'ok').length;
  const degraded = panel.sources.filter((s) => s.status === 'degraded');
  const daily = panel.daily as HotDailyInfo | null;
  const hasDaily = daily && daily.url;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }} data-hot-infobar>
      <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
        数据时间 {fmtTime(panel.fetchedAt)}
      </span>
      <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
        缓存至 {fmtTime(panel.expiresAt)}
      </span>
      <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
        源状态 {ok}/{panel.sources.length} 可用
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

/** 单条热点卡片：只读情报 + 挂为任务背景（5.3/5.4/5.5 + 2.8） */
function HotCard({ item, index, onAttach }: { item: HotItem; index: number; onAttach: (item: HotItem) => void }) {
  const seq = String(index + 1).padStart(2, '0');
  const evidence = item.evidence;
  const hasLatest = item.latest && item.latest.trim().length > 0;
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

      {/* 5.5 双层内容：讯息（摘要）/ 最新进展（无 latest 时隐藏该层） */}
      {item.summary ? (
        <div className="mt-2 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }} data-hot-layer="summary">
          {item.summary}
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
          <Btn size="sm" variant="ghost" title="挂为任务背景（选择已存在任务，不产生新任务）" onClick={() => onAttach(item)}>
            挂为任务背景
          </Btn>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="qs-meta hover:underline" style={{ color: 'var(--color-signal)' }}>
              原文 ↗
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** 2.8 挂为任务背景：选择已存在任务（不产生新任务），PUT 追加该热点 */
function AttachModal({ open, onClose, item, onDone }: { open: boolean; onClose: () => void; item: HotItem | null; onDone: () => void }) {
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTasks(null);
    setSelected(null);
    setError(null);
    void api
      .listTasks()
      .then((r) => setTasks(r.tasks))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [open]);

  if (!open || !item) return null;

  const attach = async () => {
    if (selected == null) return;
    setBusy(true);
    setError(null);
    try {
      const { refs } = await api.taskHotRefs(selected);
      const next: TaskHotRefInput = {
        hotId: item.id,
        title: item.title,
        sourceId: item.sourceId ?? '',
        sourceName: item.sourceName ?? item.source ?? '',
        evidence: item.evidence ?? 'single-source',
        url: item.url,
        latestAt: item.latestAt,
      };
      const existing: TaskHotRefInput[] = refs.map((r) => ({
        hotId: r.hotId,
        title: r.title,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        evidence: r.evidence,
        url: r.url,
        latestAt: r.latestAt,
      }));
      await api.saveTaskHotRefs(selected, [...existing, next]);
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="挂为任务背景" onClose={onClose} width={520}>
      <p className="qs-meta mb-3 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
        将「{item.title}」挂到已存在任务的背景情报中（作为外部环境参考，不产生新任务）。
      </p>
      {!tasks ? (
        <Spinner label="加载任务列表…" />
      ) : tasks.length === 0 ? (
        <Empty text="暂无任务" />
      ) : (
        <div className="max-h-[40vh] space-y-1 overflow-y-auto pr-1">
          {tasks.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 rounded-[4px] border px-2.5 py-2 text-[13px]"
              style={{ borderColor: selected === t.id ? 'var(--color-signal)' : 'var(--color-line)', background: selected === t.id ? 'var(--color-signal-soft)' : 'transparent' }}
            >
              <input type="radio" className="accent-[var(--color-signal)]" checked={selected === t.id} onChange={() => setSelected(t.id)} />
              <span className="min-w-0 truncate">#{t.id} {t.title}</span>
            </label>
          ))}
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
        <Btn size="sm" variant="primary" loading={busy} disabled={selected == null} onClick={() => void attach()}>
          挂到该任务
        </Btn>
      </ModalFooter>
    </Modal>
  );
}

/**
 * 关注域与数据源配置编辑器（3.5/4.7：排除词 / 多词阈值 / 源管理；本地保存，不入版本库）
 *
 * 布局约束：宽度一律用 Tailwind 工具类（w-[Npx] / flex-1）表达，不要改成行内 style 或改写 qs-input。
 * 背景：index.css 的 .qs-input 曾经未被 @layer 包裹，其 width:100% 会压过所有宽度工具类，导致本弹窗内
 * flex-1 的输入框被撑满同行兄弟节点挤成 0 宽度而完全不可见。现已把组件类统一放进 @layer components
 * （base < components < utilities），工具类恢复覆盖能力；改动这些宽度时请保持用工具类，避免重蹈覆辙。
 */
function AttentionModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [config, setConfig] = useState<AttentionConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setBusy(true);
    setError(null);
    try {
      await api.hotSaveAttention(config);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="关注域与数据源配置" onClose={onClose} width={640}>
      <p className="qs-meta mb-3 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
        分层：命中关注域且多信源 → 必看；命中但信源少 → 浏览；未命中 → 其他。排除词命中直接作废该域；同域需命中 ≥阈值个不同关键词。配置保存在本地，不入版本库。
      </p>
      {!config ? (
        <Spinner label="加载配置…" />
      ) : (
        <div className="max-h-[48vh] space-y-3 overflow-y-auto pr-1">
          {/* 关注域 */}
          <div className="qs-meta font-medium" style={{ color: 'var(--color-ink-soft)' }}>
            关注域
          </div>
          {config.domains.map((d) => (
            <div key={d.id} className="rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)' }}>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--color-signal)]"
                    checked={d.enabled !== false}
                    onChange={(e) => patchDomain(d.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>
                <input className="qs-input flex-1" value={d.label} onChange={(e) => patchDomain(d.id, { label: e.target.value })} placeholder="关注域名称" />
                <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                  命中≥
                </span>
                <input
                  className="qs-input w-[52px]"
                  type="number"
                  min={1}
                  max={20}
                  value={d.minKeywordHits ?? 2}
                  onChange={(e) => patchDomain(d.id, { minKeywordHits: Number(e.target.value) || 2 })}
                  title="同一关注域需命中 ≥该阈值个不同关键词才成立（默认 2）"
                />
                <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
                  词
                </span>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfig((prev) => (prev ? { ...prev, domains: prev.domains.filter((x) => x.id !== d.id) } : prev))}
                >
                  删除
                </Btn>
              </div>
              <input
                className="qs-input mt-2"
                value={d.keywords.join(', ')}
                onChange={(e) => patchDomain(d.id, { keywords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
                placeholder="关键词，逗号分隔"
              />
              <input
                className="qs-input mt-1.5"
                value={(d.excludeKeywords ?? []).join(', ')}
                onChange={(e) => patchDomain(d.id, { excludeKeywords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
                placeholder="排除词（命中任一则该域作废），逗号分隔"
              />
            </div>
          ))}
          <Btn
            size="sm"
            onClick={() =>
              setConfig((prev) =>
                prev ? { ...prev, domains: [...prev.domains, { id: `custom-${Date.now()}`, label: '新关注域', keywords: [], excludeKeywords: [], minKeywordHits: 2, enabled: true }] } : prev,
              )
            }
          >
            新增关注域
          </Btn>

          {/* 数据源 */}
          <div className="qs-meta pt-1 font-medium" style={{ color: 'var(--color-ink-soft)' }}>
            数据源（可插拔适配器；新增源无需改聚合代码）
          </div>
          {(config.sources ?? []).map((s) => (
            <div key={s.id} className="rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)' }}>
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--color-signal)]"
                    checked={s.enabled !== false}
                    onChange={(e) => patchSource(s.id, { enabled: e.target.checked })}
                  />
                  启用
                </label>
                <span className="qs-input w-[110px] shrink-0 bg-transparent text-[12px]">{s.id}</span>
                <input className="qs-input flex-1" value={s.label} onChange={(e) => patchSource(s.id, { label: e.target.value })} placeholder="源名" />
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
                <Btn size="sm" variant="ghost" onClick={() => setConfig((prev) => (prev ? { ...prev, sources: (prev.sources ?? []).filter((x) => x.id !== s.id) } : prev))}>
                  删除
                </Btn>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <input className="qs-input w-[160px] shrink-0" value={s.adapter} onChange={(e) => patchSource(s.id, { adapter: e.target.value })} placeholder="adapter id" list="hot-adapters" />
                <input className="qs-input flex-1" value={s.endpoint} onChange={(e) => patchSource(s.id, { endpoint: e.target.value })} placeholder="拉取端点 URL" />
                <input className="qs-input w-[140px] shrink-0" value={s.vertical} onChange={(e) => patchSource(s.id, { vertical: e.target.value })} placeholder="垂直类别" />
              </div>
              {s.enterpriseCredentialRequired ? (
                <div className="qs-meta mt-1" style={{ color: 'var(--color-warn)' }}>
                  ⚠ 该源标记为需企业资质/账号（本期预留，未提供凭据时该源降级）
                </div>
              ) : null}
            </div>
          ))}
          <datalist id="hot-adapters">
            {KNOWN_ADAPTERS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <div className="flex items-center gap-2">
            <Btn
              size="sm"
              onClick={() =>
                setConfig((prev) =>
                  prev
                    ? {
                        ...prev,
                        sources: [...(prev.sources ?? []), { id: `src-${Date.now()}`, adapter: 'pai-news', label: '新数据源', endpoint: '', vertical: 'ecommerce-news', enabled: true }],
                      }
                    : prev,
                )
              }
            >
              新增数据源
            </Btn>
            <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
              进入必看所需最少信源
            </span>
            <input
              className="qs-input w-[64px]"
              type="number"
              min={1}
              max={20}
              value={config.minimumSources ?? 2}
              onChange={(e) => setConfig((prev) => (prev ? { ...prev, minimumSources: Number(e.target.value) || 1 } : prev))}
            />
          </div>
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
        <Btn size="sm" variant="primary" loading={busy} disabled={!config} onClick={() => void save()}>
          保存
        </Btn>
      </ModalFooter>
    </Modal>
  );
}

/** 每日热点视图（板块 B）：只读情报面板（多源 / 三态降级 / 电商化分层 / A4 排版） */
export function HotView() {
  const [panel, setPanel] = useState<HotPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [attachItem, setAttachItem] = useState<HotItem | null>(null);
  const [attachedTip, setAttachedTip] = useState<string | null>(null);

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

  const tiers: HotTier[] = ['mustRead', 'browse', 'other'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* 5.6 衬线 Display 大标题 */}
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
            关注域与源配置
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

      {attachedTip ? (
        <p className="qs-meta" style={{ color: 'var(--color-ok)' }}>
          ✓ {attachedTip}
        </p>
      ) : null}

      {loading && !panel ? (
        <Spinner label="拉取热点…" />
      ) : !panel || panel.status === 'unavailable' ? (
        <Empty text={KB_EMPTY_STATES.hotEmptyUnavailable.text} hint={KB_EMPTY_STATES.hotEmptyUnavailable.hint} emptyKey={KB_EMPTY_STATES.hotEmptyUnavailable.key} />
      ) : panel.counts.upstream === 0 ? (
        <Empty text={KB_EMPTY_STATES.hotEmptyNone.text} hint={KB_EMPTY_STATES.hotEmptyNone.hint} emptyKey={KB_EMPTY_STATES.hotEmptyNone.key} />
      ) : (
        <>
          {/* 5.1 三枚统计药丸 */}
          <div className="flex flex-wrap gap-2" data-hot-pills>
            <Pill label="多源热点" value={panel.counts.upstream} />
            <Pill label="今日必看" value={panel.counts.mustRead} />
            <Pill label="24H 精选" value={panel.counts.selected24h} />
          </div>

          {tiers.map((tier) => {
            const list = panel.tiers[tier];
            if (list.length === 0) return null;
            return (
              <section key={tier} className="space-y-2.5" data-hot-tier={tier}>
                <div className="flex items-baseline gap-2 border-b pb-1.5" style={{ borderColor: 'var(--color-line)' }}>
                  <h3 className="font-display text-[15px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
                    {TIER_LABEL[tier]}
                  </h3>
                  <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                    {list.length} 条 · {TIER_HINT[tier]}
                  </span>
                </div>
                {/* 5.6 响应式多栏网格 */}
                <div className="hot-grid">
                  {list.map((item, i) => (
                    <HotCard key={item.id} item={item} index={i} onAttach={setAttachItem} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      <AttentionModal open={configOpen} onClose={() => setConfigOpen(false)} onSaved={() => void load(true)} />
      <AttachModal
        open={attachItem != null}
        item={attachItem}
        onClose={() => setAttachItem(null)}
        onDone={() => setAttachedTip(`已挂到任务背景：${attachItem?.title}`)}
      />
    </div>
  );
}
