/**
 * 任务列表视图 + 筛选栏 + 交付物全局搜索（B5 · 5.x/6.7/7.3，B6 · 9.1/9.2，B4 · 4.10）。
 * 与看板共用 store 全量任务数据源；筛选/排序在客户端按与后端一致的语义执行（applyTaskFilters）。
 */
import { useState } from 'react';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import type { DeliverableSearchHit } from '@workbench/shared';
import { useWorkbench, type TaskWithMeta } from '../../store/useWorkbench.tsx';
import { api } from '../../lib/api.ts';
import { isFilterActive, type TaskFilters } from '../../lib/taskFilters.ts';
import { useDownloadPackage } from '../../lib/useDownloadPackage.ts';
import { Avatar, Badge, Btn, Empty } from '../../components/ui.tsx';

const PLATFORM_OPTIONS = ['天猫', '京东', '拼多多', '抖音小店', '小红书', '其他'];
const COL_LABEL: Record<string, string> = { planned: '规划中', progress: '进行中', awaiting: '待确认', done: '已完成' };
const SORT_OPTIONS: { key: TaskFilters['sort']; label: string }[] = [
  { key: 'createdAt', label: '创建时间' },
  { key: 'updatedAt', label: '最近更新' },
  { key: 'progress', label: '进度' },
];
const HIT_FIELD_LABEL: Record<string, string> = { title: '标题', point: '卖点', keyword: '关键词', imageName: '图片名' };

/** 关联资料失效角标（B6 · 9.1/9.2：kbRefsInvalid > 0 才显示，无失效不显示） */
export function KbInvalidBadge({ task, compact }: { task: TaskWithMeta; compact?: boolean }) {
  const n = task.kbRefsInvalid ?? 0;
  if (n <= 0) return null;
  return (
    <span
      className="qs-badge shrink-0"
      title="关联知识库资料已失效（Vault 中已不存在）"
      style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
    >
      {compact ? `${n} 份失效` : `${n} 份关联资料已失效`}
    </span>
  );
}

/** 下载交付包（B4 · 4.10；错误含 409 中文原因以行内文本展示） */
export function DownloadButton({ taskId }: { taskId: number }) {
  const { download, busy, error } = useDownloadPackage(taskId);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Btn size="sm" variant="ghost" disabled={busy} loading={busy} onClick={() => void download()} title="下载交付包 ZIP（文案 + 已采纳图片）">
        {busy ? '打包中…' : '下载交付包'}
      </Btn>
      {error ? (
        <span className="qs-meta max-w-[180px] truncate text-[10px]" style={{ color: 'var(--color-danger)' }} title={error}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** 筛选栏（B5 · 6.7：平台多选或 / 负责人 / 时间范围 / 关键字 / 排序 / 清除筛选） */
export function TaskFilterBar() {
  const { agents, filters, setFilters, clearFilters } = useWorkbench();
  const set = <K extends keyof TaskFilters>(k: K, v: TaskFilters[K]) => setFilters({ ...filters, [k]: v });
  const active = isFilterActive(filters);
  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[4px] border px-3 py-2"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}
    >
      <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>
        筛选
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="qs-meta">平台</span>
        {PLATFORM_OPTIONS.map((p) => (
          <label key={p} className="flex cursor-pointer items-center gap-1 select-none">
            <input
              type="checkbox"
              className="h-3 w-3 accent-[var(--color-signal)]"
              checked={filters.platforms.includes(p)}
              onChange={(e) => set('platforms', e.target.checked ? [...filters.platforms, p] : filters.platforms.filter((x) => x !== p))}
            />
            {p}
          </label>
        ))}
      </span>
      <label className="flex items-center gap-1.5 text-[12px]">
        <span className="qs-meta">负责人</span>
        <select className="qs-input" style={{ width: 'auto' }} value={filters.owner} onChange={(e) => set('owner', e.target.value)}>
          <option value="">全部</option>
          {agents.map((a) => (
            <option key={a.id} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[12px]">
        <span className="qs-meta">创建</span>
        <input type="date" className="qs-input" style={{ width: 'auto' }} value={filters.from} onChange={(e) => set('from', e.target.value)} />
        <span className="qs-meta">至</span>
        <input type="date" className="qs-input" style={{ width: 'auto' }} value={filters.to} onChange={(e) => set('to', e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-[12px]">
        <span className="qs-meta">关键字</span>
        <input className="qs-input" style={{ width: 140 }} placeholder="标题 / 描述" value={filters.q} onChange={(e) => set('q', e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-[12px]">
        <span className="qs-meta">排序</span>
        <select className="qs-input" style={{ width: 'auto' }} value={filters.sort} onChange={(e) => set('sort', e.target.value as TaskFilters['sort'])}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <select className="qs-input" style={{ width: 'auto' }} value={filters.order} onChange={(e) => set('order', e.target.value as TaskFilters['order'])}>
          <option value="desc">降序</option>
          <option value="asc">升序</option>
        </select>
      </label>
      {active ? (
        <Btn size="sm" variant="ghost" onClick={clearFilters}>
          清除筛选
        </Btn>
      ) : null}
    </div>
  );
}

/** 任务列表表格（B5 · 5.1：行视图，含 id/标题/状态/阶段/负责人/平台/创建时间/操作） */
export function TaskListTable({ tasks, onOpen }: { tasks: TaskWithMeta[]; onOpen: (id: number) => void }) {
  const { openTask } = useWorkbench();
  const handleOpen = (t: TaskWithMeta) => {
    onOpen(t.id);
    openTask(t.id);
  };
  if (tasks.length === 0) {
    return <Empty text="无匹配任务 · 可调整上方筛选条件" />;
  }
  return (
    <div className="qs-card overflow-x-auto">
      <table className="w-full min-w-[780px] border-collapse text-[13px]">
        <thead>
          <tr className="qs-meta text-left" style={{ borderBottom: '1px solid var(--color-line)', color: 'var(--color-ink-faint)' }}>
            <th className="px-3 py-2 font-normal">#</th>
            <th className="px-3 py-2 font-normal">标题</th>
            <th className="px-3 py-2 font-normal">状态</th>
            <th className="px-3 py-2 font-normal">当前阶段</th>
            <th className="px-3 py-2 font-normal">负责人</th>
            <th className="px-3 py-2 font-normal">平台</th>
            <th className="px-3 py-2 font-normal">创建时间</th>
            <th className="px-3 py-2 font-normal">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr
              key={t.id}
              className="cursor-pointer transition-colors hover:bg-[var(--color-signal-soft)]"
              style={{ borderBottom: '1px solid var(--color-line)' }}
              onClick={() => handleOpen(t)}
              title="查看详情"
            >
              <td className="qs-meta px-3 py-2 tabular">{t.id}</td>
              <td className="max-w-[260px] truncate px-3 py-2 font-medium">{t.title}</td>
              <td className="px-3 py-2">
                <Badge tone={t.column === 'awaiting' ? 'warn' : t.column === 'done' ? 'ok' : 'default'}>{COL_LABEL[t.column] ?? t.column}</Badge>
              </td>
              <td className="px-3 py-2">{WORKFLOW_STAGE_LABELS[t.stage] ?? t.stage}</td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1">
                  <Avatar name={t.ownerName || '待'} size={16} />
                  {t.ownerName || '待分配'}
                </span>
              </td>
              <td className="qs-meta px-3 py-2">{(t.platforms ?? []).join(' / ') || t.platform || '—'}</td>
              <td className="qs-meta px-3 py-2 tabular">{new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false })}</td>
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <span className="flex items-center gap-1.5">
                  <KbInvalidBadge task={t} compact />
                  <DownloadButton taskId={t.id} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 交付物全局搜索（B5 · 7.3：入口 + 结果可跳转；空关键字/无命中均有提示） */
export function DeliverableSearch() {
  const { openTask, setTaskTab } = useWorkbench();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DeliverableSearchHit[] | null>(null);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!q.trim()) {
      setHits([]);
      setHint('请输入关键字');
      return;
    }
    setBusy(true);
    try {
      const r = await api.searchDeliverables(q.trim(), 20);
      setHits(r.hits);
      setHint(r.hits.length === 0 ? (r.hint ?? '无命中') : '');
    } catch {
      setHits([]);
      setHint('搜索失败，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <input
          className="qs-input"
          style={{ width: 200 }}
          placeholder="搜索交付物…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
        />
        <Btn size="sm" onClick={() => void run()} disabled={busy}>
          {busy ? '搜索中…' : '搜索'}
        </Btn>
      </div>
      {hits !== null ? (
        <div className="qs-card absolute right-0 top-full z-30 mt-1 max-h-[360px] w-[440px] overflow-y-auto p-2" style={{ background: 'var(--color-surface)' }}>
          {hits.length === 0 ? (
            <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
              {hint}
            </div>
          ) : (
            hits.map((h, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                onClick={() => {
                  openTask(h.taskId);
                  setTaskTab('deliver');
                  setHits(null);
                  setQ('');
                }}
              >
                <span className="truncate text-[12px] font-medium">
                  #{h.taskId} {h.taskTitle}
                </span>
                <span className="qs-meta w-full truncate text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  {WORKFLOW_STAGE_LABELS[h.stage] ?? h.stage} · v{h.version} · 命中{HIT_FIELD_LABEL[h.field] ?? h.field}：{h.snippet}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
