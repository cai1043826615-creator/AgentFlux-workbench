import { useCallback, useEffect, useState } from 'react';
import type { AttentionConfig, HotItem, HotPanel, HotTier } from '@workbench/shared';
import { Badge, Btn, Empty, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';

const TIER_LABEL: Record<HotTier, string> = { mustRead: '今日必看', browse: '浏览', other: '其他' };
const TIER_HINT: Record<HotTier, string> = {
  mustRead: '命中关注域且多信源跟进',
  browse: '命中关注域，信源较少',
  other: '未命中关注域',
};

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 单条热点卡片；「创建任务」仅预填新建任务表单，需人工确认后才进入工作流（不自动创建） */
function HotCard({ item, onToTask }: { item: HotItem; onToTask: (item: HotItem) => void }) {
  return (
    <div className="qs-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium leading-snug">{item.title}</div>
          {item.summary ? (
            <div className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
              {item.summary}
            </div>
          ) : null}
          <div className="qs-meta mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1" style={{ color: 'var(--color-ink-faint)' }}>
            <span>{item.source}</span>
            {item.sourceCount > 1 ? <span>{item.sourceCount} 个信源</span> : null}
            <span>{fmtTime(item.latestAt)}</span>
            {item.domains.map((d) => (
              <span key={d.id} style={{ color: 'var(--color-signal)' }}>
                #{d.label}
              </span>
            ))}
          </div>
          <div className="qs-meta mt-1 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
            {item.reason}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Btn size="sm" variant="primary" onClick={() => onToTask(item)}>
            创建任务
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

/** 关注域配置编辑器（本地保存，不入版本库；保存后重新拉取即生效） */
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

  const patch = (id: string, next: Partial<{ label: string; keywords: string[]; enabled: boolean }>) =>
    setConfig((prev) => (prev ? { ...prev, domains: prev.domains.map((d) => (d.id === id ? { ...d, ...next } : d)) } : prev));

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[8vh]" onClick={onClose}>
      <div className="qs-card w-full p-5" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="font-display mb-1 text-[15px] font-semibold">关注域配置</div>
        <p className="qs-meta mb-3" style={{ color: 'var(--color-ink-faint)' }}>
          热点按关注域分层：命中且多信源 → 必看；命中但信源少 → 浏览；未命中 → 其他。配置保存在本地，不入版本库。
        </p>
        {!config ? (
          <Spinner label="加载配置…" />
        ) : (
          <div className="max-h-[52vh] space-y-2.5 overflow-y-auto pr-1">
            {config.domains.map((d) => (
              <div key={d.id} className="rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)' }}>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[var(--color-signal)]"
                      checked={d.enabled !== false}
                      onChange={(e) => patch(d.id, { enabled: e.target.checked })}
                    />
                    启用
                  </label>
                  <input className="qs-input flex-1" value={d.label} onChange={(e) => patch(d.id, { label: e.target.value })} placeholder="关注域名称" />
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
                  onChange={(e) => patch(d.id, { keywords: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
                  placeholder="关键词，逗号分隔"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Btn
                size="sm"
                onClick={() =>
                  setConfig((prev) =>
                    prev ? { ...prev, domains: [...prev.domains, { id: `custom-${Date.now()}`, label: '新关注域', keywords: [], enabled: true }] } : prev,
                  )
                }
              >
                新增关注域
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
        <div className="mt-4 flex justify-end gap-2">
          <Btn size="sm" onClick={onClose}>
            取消
          </Btn>
          <Btn size="sm" variant="primary" loading={busy} disabled={!config} onClick={() => void save()}>
            保存
          </Btn>
        </div>
      </div>
    </div>
  );
}

/** 每日热点视图（板块 B）：拉取/缓存/降级三态 + 电商化分层 + 热点转任务（人工确认） */
export function HotView() {
  const { openNewTask } = useWorkbench();
  const [panel, setPanel] = useState<HotPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

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

  /** 热点 → 预填新建任务表单（不自动创建，由用户确认后开工） */
  const toTask = (item: HotItem) => {
    const description = [item.summary, `热点来源：${item.source}`, item.url ? `原文：${item.url}` : '', item.domains.length > 0 ? `关注域：${item.domains.map((d) => d.label).join(' / ')}` : '']
      .filter(Boolean)
      .join('\n');
    openNewTask({ title: item.title, description });
  };

  const tiers: HotTier[] = ['mustRead', 'browse', 'other'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="qs-meta mb-0.5">板块 B · 知识库管理系统</div>
          <h2 className="font-display text-[20px] font-bold">每日热点</h2>
          <p className="qs-meta mt-1" style={{ color: 'var(--color-ink-faint)' }}>
            {panel?.sourceName ?? '公共热点 API'}
            {panel?.fetchedAt ? ` · 数据时间 ${fmtTime(panel.fetchedAt)}` : ''}
            {panel?.expiresAt ? ` · 缓存至 ${fmtTime(panel.expiresAt)}` : ''}
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
            关注域配置
          </Btn>
        </div>
      </div>

      {error ? (
        <p className="qs-meta" style={{ color: 'var(--color-danger)' }}>
          ● {error}
        </p>
      ) : null}

      {panel?.status !== 'live' && panel?.error ? (
        <div className="rounded-[4px] border px-3 py-2.5" style={{ borderColor: 'var(--color-warn)', background: 'var(--color-warn-soft)' }}>
          <div className="text-[12.5px] font-medium" style={{ color: 'var(--color-warn)' }}>
            {panel.status === 'stale' ? '热点源暂不可用，展示最近一次缓存内容' : '热点源暂不可用'}
          </div>
          <div className="qs-meta mt-1" style={{ color: 'var(--color-ink-soft)' }}>
            {panel.error.message} · 不影响知识库其他功能与工作流板块
          </div>
        </div>
      ) : null}

      {loading && !panel ? (
        <Spinner label="拉取热点…" />
      ) : !panel || panel.counts.upstream === 0 ? (
        <Empty text="暂无热点数据" />
      ) : (
        <>
          <div className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
            共 {panel.counts.upstream} 条 · 必看 {panel.counts.mustRead} · 浏览 {panel.counts.browse} · 其他 {panel.counts.other}
          </div>
          {tiers.map((tier) => {
            const list = panel.tiers[tier];
            if (list.length === 0) return null;
            return (
              <section key={tier} className="space-y-2">
                <div className="flex items-baseline gap-2 border-b pb-1.5" style={{ borderColor: 'var(--color-line)' }}>
                  <h3 className="font-display text-[15px] font-semibold">{TIER_LABEL[tier]}</h3>
                  <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                    {list.length} 条 · {TIER_HINT[tier]}
                  </span>
                </div>
                <div className="space-y-2">
                  {list.map((item) => (
                    <HotCard key={item.id} item={item} onToTask={toTask} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      <AttentionModal open={configOpen} onClose={() => setConfigOpen(false)} onSaved={() => void load(true)} />
    </div>
  );
}
