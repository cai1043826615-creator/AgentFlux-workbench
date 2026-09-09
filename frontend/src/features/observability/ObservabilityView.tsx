import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Agent, AgentExecution, ExecutionStats } from '@workbench/shared';
import { Avatar, Badge, Btn, Card, Empty, Field, SectionTitle, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { dotClass } from '../workstation/WorkstationBar.tsx';

/** Agent 状态视图（意见18：工位在线状态 + 执行统计 + 执行日志） */

/* ===== 工具 ===== */

/** ISO 时间 → 中文相对时间 */
function relTime(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function StatusBadge({ status }: { status: Agent['onlineStatus'] }) {
  if (status === 'online') return <Badge tone="ok">在线</Badge>;
  if (status === 'busy') return <Badge tone="signal">忙碌</Badge>;
  if (status === 'unconfigured') return <Badge tone="warn">未配置</Badge>;
  return <Badge>待命</Badge>;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

/** 平均耗时格式化（意见18：<60s x秒 / ≥60s x分x秒 / ≥1h x时x分） */
function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const s = Math.floor(total / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  const h = Math.floor(m / 60);
  return `${h}时${m % 60}分`;
}

/* ===== 主视图 ===== */

export function ObservabilityView() {
  const { agents, connected, refresh } = useWorkbench();

  // —— 执行统计：逐个 Agent 拉取并汇总 ——
  const [statsByAgent, setStatsByAgent] = useState<Record<string, ExecutionStats | null>>({});
  const [statsLoading, setStatsLoading] = useState(true);
  const agentIdsKey = agents.map((a) => a.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const ids = agentIdsKey ? agentIdsKey.split(',') : [];
    if (ids.length === 0) {
      setStatsByAgent({});
      setStatsLoading(false);
      return;
    }
    setStatsLoading(true);
    void Promise.allSettled(ids.map((id) => api.agentStats(id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, ExecutionStats | null> = {};
      results.forEach((r, i) => {
        next[ids[i]] = r.status === 'fulfilled' ? r.value.stats : null;
      });
      setStatsByAgent(next);
      setStatsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [agentIdsKey]);

  const totals = useMemo(() => {
    let runs = 0;
    let successCount = 0;
    let durationMs = 0;
    for (const a of agents) {
      const s = statsByAgent[a.id];
      if (!s) continue;
      runs += s.runs;
      successCount += s.successCount;
      durationMs += s.avgDurationMs * s.runs;
    }
    return {
      runs,
      successRate: runs > 0 ? (successCount / runs) * 100 : 0,
      avgDurationMs: runs > 0 ? durationMs / runs : 0,
    };
  }, [agents, statsByAgent]);

  // —— 执行日志 ——
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLogsLoading(true);
    void api
      .executions(50)
      .then((r) => {
        if (cancelled) return;
        setExecutions(r.executions);
        setLogsError('');
        setLogsLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setExecutions([]);
        setLogsError(e instanceof Error ? e.message : '加载失败');
        setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // —— 工位就地编辑（persona / model / skills） ——
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ persona: '', model: '', skills: '' });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const startEdit = (a: Agent) => {
    setEditId(a.id);
    setDraft({ persona: a.persona, model: a.model, skills: a.skills.join(', ') });
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editId || saving) return;
    setSaving(true);
    setEditError('');
    try {
      await api.updateAgent(editId, {
        persona: draft.persona.trim(),
        model: draft.model.trim(),
        skills: draft.skills
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setEditId(null);
      await refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const timeFmt = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col gap-4">
      {/* 页面标题（意见18：执行观测 → Agent 状态） */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-xl font-bold">Agent 状态</span>
        <Badge tone={connected ? 'ok' : 'no'}>{connected ? '实时连接' : '离线'}</Badge>
        <span className="qs-meta">AGENT STATUS · 在线 / 统计 / 日志</span>
      </div>

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        {/* 工位在线状态 */}
        <div className="flex-1 min-w-0">
          <SectionTitle meta="AGENTS / ONLINE">Agent 在线状态</SectionTitle>
          {agents.length === 0 ? (
            <Card>
              <Empty text="暂无工位（Agent）" />
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3 grid-flow-dense">
              {agents.map((a) => (
                <Card key={a.id} className="flex flex-col">
                  {/* 头部：头像 + 名字 + 角色 + 状态 + 编辑 */}
                  <div className="flex items-center gap-2.5">
                    <Avatar name={a.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-semibold truncate">{a.name}</span>
                        <Badge>{a.role}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <StatusBadge status={a.onlineStatus} />
                        <span className="qs-meta tabular">最近活跃 {relTime(a.lastActiveAt)}</span>
                      </div>
                    </div>
                    <Btn variant="ghost" size="sm" onClick={() => (editId === a.id ? setEditId(null) : startEdit(a))}>
                      {editId === a.id ? '收起' : '编辑'}
                    </Btn>
                  </div>

                  {/* 当前活动（状态点与 WorkstationBar 一致） */}
                  {a.activity ? (
                    <div className="mt-2.5 flex items-center gap-1.5 text-[12px] min-w-0" style={{ color: 'var(--color-ink-soft)' }}>
                      <span className={dotClass(a.onlineStatus)} />
                      <span className="truncate">{a.activity}</span>
                    </div>
                  ) : null}

                  {/* 模型 / 人设（人设一行截断） */}
                  <div className="mt-2.5 grid gap-1 text-[12px]">
                    <div className="flex gap-2 min-w-0">
                      <span className="qs-meta w-9 shrink-0">模型</span>
                      <span className="truncate" style={{ color: 'var(--color-ink-soft)' }}>
                        {a.model || '—'}
                      </span>
                    </div>
                    <div className="flex gap-2 min-w-0">
                      <span className="qs-meta w-9 shrink-0">人设</span>
                      <span className="truncate" title={a.persona} style={{ color: 'var(--color-ink-soft)' }}>
                        {a.persona || '—'}
                      </span>
                    </div>
                  </div>

                  {/* 技能标签 */}
                  {a.skills.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {a.skills.map((s) => (
                        <Badge key={s}>{s}</Badge>
                      ))}
                    </div>
                  ) : null}

                  {/* 就地展开编辑 */}
                  {editId === a.id ? (
                    <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: 'var(--color-line)' }}>
                      <Field label="人设 persona（一行）">
                        <input className="qs-input" value={draft.persona} onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))} placeholder="例：资深电商文案，擅长卖点提炼" />
                      </Field>
                      <Field label="模型 model">
                        <input className="qs-input" value={draft.model} onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))} placeholder="例：gpt-4o" />
                      </Field>
                      <Field label="技能 skills（逗号分隔）">
                        <input className="qs-input" value={draft.skills} onChange={(e) => setDraft((d) => ({ ...d, skills: e.target.value }))} placeholder="文案, 卖点提炼, 关键词" />
                      </Field>
                      {editError ? <div className="qs-meta" style={{ color: 'var(--color-danger)' }}>{editError}</div> : null}
                      <div className="flex justify-end gap-2">
                        <Btn size="sm" onClick={() => setEditId(null)}>
                          取消
                        </Btn>
                        <Btn size="sm" variant="primary" onClick={() => void saveEdit()} disabled={saving}>
                          {saving ? '保存中…' : '保存'}
                        </Btn>
                      </div>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 执行统计汇总 */}
        <div className="w-full xl:w-[300px] shrink-0">
          <Card title="执行统计">
            {statsLoading ? (
              <Spinner label="统计加载中…" />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="qs-meta">总执行</div>
                    <div className="font-display text-[20px] leading-tight tabular">{fmtNum(totals.runs)}</div>
                  </div>
                  <div>
                    <div className="qs-meta">成功率</div>
                    <div className="font-display text-[20px] leading-tight tabular">{totals.successRate.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="qs-meta">平均耗时</div>
                    <div className="font-display text-[20px] leading-tight tabular">{fmtDuration(totals.avgDurationMs)}</div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t space-y-2.5" style={{ borderColor: 'var(--color-line)' }}>
                  {agents.length === 0 ? (
                    <Empty text="暂无 Agent" />
                  ) : (
                    agents.map((a) => {
                      const s = statsByAgent[a.id];
                      const rate = s && s.runs > 0 ? s.successRate : 0;
                      const color = rate >= 70 ? 'var(--color-ok)' : rate >= 40 ? 'var(--color-warn)' : 'var(--color-danger)';
                      return (
                        <div key={a.id} className="flex items-center gap-2">
                          <span className="qs-meta w-14 truncate shrink-0">{a.name}</span>
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-line)' }}>
                            <div className="h-full" style={{ width: `${rate}%`, background: color }} />
                          </div>
                          <span className="qs-meta tabular w-12 text-right">{rate.toFixed(0)}%</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* 执行日志表 */}
      <Card title="执行日志" extra={<span className="qs-meta tabular">{executions.length} 条</span>} className="overflow-x-auto">
        {logsLoading ? (
          <Spinner label="日志加载中…" />
        ) : logsError ? (
          <Empty text={`日志加载失败：${logsError}`} />
        ) : executions.length === 0 ? (
          <Empty text="暂无执行日志" />
        ) : (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="qs-meta text-left" style={{ borderBottom: '1px solid var(--color-line)' }}>
                <th className="px-3 py-2 font-normal whitespace-nowrap">时间</th>
                <th className="px-3 py-2 font-normal">Agent</th>
                <th className="px-3 py-2 font-normal">任务</th>
                <th className="px-3 py-2 font-normal">阶段</th>
                <th className="px-3 py-2 font-normal">模型</th>
                <th className="px-3 py-2 font-normal">状态</th>
                <th className="px-3 py-2 font-normal">输入摘要</th>
                <th className="px-3 py-2 font-normal">输出摘要</th>
                <th className="px-3 py-2 font-normal text-right">耗时</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((ex) => {
                const failed = ex.status === 'failed';
                const open = expandedId === ex.id;
                return (
                  <Fragment key={ex.id}>
                    <tr
                      className="cursor-pointer align-top"
                      style={{ borderBottom: '1px solid var(--color-line)', background: failed ? 'var(--color-danger-soft)' : 'var(--color-surface)' }}
                      onClick={() => setExpandedId(open ? null : ex.id)}
                      title={failed ? '点击展开错误详情' : undefined}
                    >
                      <td className="px-3 py-2 qs-meta tabular whitespace-nowrap">{timeFmt(ex.createdAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{nameOf(ex.agentId)}</td>
                      <td className="px-3 py-2 qs-meta tabular whitespace-nowrap">{ex.taskId != null ? `#${ex.taskId}` : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{ex.stage ?? '—'}</td>
                      <td className="px-3 py-2 qs-meta whitespace-nowrap">{ex.model || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge tone={failed ? 'no' : 'ok'}>{failed ? '失败' : '成功'}</Badge>
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <div className="truncate" title={ex.inputSummary}>{ex.inputSummary || '—'}</div>
                      </td>
                      <td className="px-3 py-2 max-w-[200px]">
                        <div className="truncate" title={ex.outputSummary}>{ex.outputSummary || '—'}</div>
                      </td>
                      <td className="px-3 py-2 qs-meta tabular whitespace-nowrap text-right">{fmtDuration(ex.durationMs)}</td>
                    </tr>
                    {open && ex.error ? (
                      <tr style={{ background: 'var(--color-danger-soft)', borderBottom: '1px solid var(--color-line)' }}>
                        <td colSpan={9} className="px-3 py-2">
                          <div className="qs-meta mb-1" style={{ color: 'var(--color-danger)' }}>
                            错误详情
                          </div>
                          <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed" style={{ color: 'var(--color-danger)' }}>
                            {ex.error}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
