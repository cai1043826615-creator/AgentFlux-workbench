import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Agent, AgentExecution, ExecutionStats } from '@workbench/shared';
import { Avatar, Badge, Btn, Card, Empty, SectionTitle, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { AgentSettingsModal } from '../workstation/AgentSettingsModal.tsx';
import { dotLabel } from '../workstation/WorkstationBar.tsx';

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

/** 头像右下角状态点颜色（与工位栏 dotClass 语义一致：busy=紫 / online·idle=绿 / unconfigured=灰） */
function dotColor(s: Agent['onlineStatus']): string {
  if (s === 'busy') return 'var(--color-signal)';
  if (s === 'online' || s === 'idle') return 'var(--color-ok)';
  return '#a1a1aa';
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
  const { agents, connected } = useWorkbench();

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

  // —— Agent 设置弹窗（意见9：复用 AgentSettingsModal，不再卡内就地编辑） ——
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);

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

      {/* 意见10：两个区域容器等高、底部对齐（网格 items-stretch；各自 h-full flex flex-col） */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[1fr_300px]">
        {/* 工位在线状态 */}
        <div className="flex min-w-0 flex-col">
          <SectionTitle meta="AGENTS / ONLINE">Agent 在线状态</SectionTitle>
          {agents.length === 0 ? (
            <Card>
              <Empty text="暂无工位（Agent）" />
            </Card>
          ) : (
            <div className="grid flex-1 content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3 grid-flow-dense">
              {agents.map((a) => (
                <Card key={a.id} className="flex flex-col">
                  {/* 头部（意见10 去重：头像右下状态点 + 名字/角色/状态 Badge + Agent 设置按钮；
                      意见5：「最近活跃」从本行拆出独立一行，避免元素过多被截断） */}
                  <div className="flex items-center gap-2.5">
                    <div className="relative shrink-0 self-start">
                      <Avatar name={a.name} id={a.id} size={36} />
                      <span
                        className="absolute -bottom-0.5 -right-0.5 h-[10px] w-[10px] rounded-full"
                        style={{ background: dotColor(a.onlineStatus), boxShadow: '0 0 0 2px var(--color-surface)' }}
                        title={dotLabel(a.onlineStatus)}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[14px] font-semibold">{a.name}</span>
                        <Badge>{a.role}</Badge>
                        <StatusBadge status={a.onlineStatus} />
                      </div>
                    </div>
                    <Btn variant="ghost" size="sm" onClick={() => setSettingsAgent(a)}>
                      Agent 设置
                    </Btn>
                  </div>

                  {/* 最近活跃（意见5：独立一行完整显示，不再被头部元素截断） */}
                  <div className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
                    最近活跃 {relTime(a.lastActiveAt)}
                  </div>

                  {/* 当前活动（意见10：单行，不再重复状态点；activity 与状态文字相同（如「待命」）时不重复显示） */}
                  {a.activity && a.activity.trim() !== dotLabel(a.onlineStatus) ? (
                    <div className="mt-2.5 truncate text-[12px]" style={{ color: 'var(--color-ink-soft)' }} title={a.activity}>
                      {a.activity}
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
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* 执行统计汇总（意见10：卡撑满，与在线状态卡底部对齐；内部分区弹性布局） */}
        <div className="flex flex-col">
          <Card
            title="执行统计"
            className="h-full flex flex-col [&>div]:flex-1 [&>div]:flex [&>div]:flex-col"
          >
            {statsLoading ? (
              <Spinner label="统计加载中…" />
            ) : (
              <div className="flex h-full flex-col">
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
                <div className="mt-4 flex-1 border-t pt-3 space-y-2.5" style={{ borderColor: 'var(--color-line)' }}>
                  {agents.length === 0 ? (
                    <div className="flex h-full items-center">
                      <Empty text="暂无 Agent" />
                    </div>
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
              </div>
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

      {settingsAgent ? (
        <AgentSettingsModal agent={settingsAgent} open onClose={() => setSettingsAgent(null)} />
      ) : null}
    </div>
  );
}
