import { useEffect, useMemo, useRef, useState } from 'react';
import { APPROVAL_POINT_STAGES, STAGE_OWNER_ROLE, WORKFLOW_STAGE_KEYS, WORKFLOW_STAGE_LABELS, type Agent, type ProvenanceResult, type ReworkInfo, type TaskCostSummary, type TaskEvent, type TaskEventType, type TaskHotRef, type TaskHotRefInput, type TaskKbRef } from '@workbench/shared';
import { useWorkbench, type TaskWithMeta } from '../../store/useWorkbench.tsx';
import { Avatar, Badge, Spinner, Tabs } from '../../components/ui.tsx';
import { api, parseCopy, parseImages } from '../../lib/api.ts';
import { ContentDeliveryView } from '../content/ContentDeliveryView.tsx';
import { DownloadButton, KbInvalidBadge, fmtRelative } from '../board/TaskListView.tsx';

const EVENT_LABELS: Record<TaskEventType, string> = {
  TASK_CREATED: '创建任务',
  TASK_CONFIRMED: '确认开工',
  STAGE_STARTED: '进入阶段',
  STAGE_COMPLETED: '阶段完成',
  APPROVED: '采纳',
  REJECTED: '打回',
  REVIEW_PASSED: '校对放行',
  REVIEW_ROLLBACK: '校对回退',
  SUB_TASK_COMPLETE: '子任务完成',
  DELIVERABLE_DECIDED: '交付物定案',
};

/** 事件前缀「文字图标」（无 emoji：单字标记 + 语义色） */
const EVENT_MARKS: Record<TaskEventType, { ch: string; tone: 'ok' | 'no' | 'warn' | 'neutral' }> = {
  TASK_CREATED: { ch: '建', tone: 'neutral' },
  TASK_CONFIRMED: { ch: '开', tone: 'neutral' },
  STAGE_STARTED: { ch: '进', tone: 'neutral' },
  STAGE_COMPLETED: { ch: '完', tone: 'ok' },
  APPROVED: { ch: '采', tone: 'ok' },
  REJECTED: { ch: '打', tone: 'no' },
  REVIEW_PASSED: { ch: '放', tone: 'ok' },
  REVIEW_ROLLBACK: { ch: '退', tone: 'no' },
  SUB_TASK_COMPLETE: { ch: '子', tone: 'ok' },
  DELIVERABLE_DECIDED: { ch: '定', tone: 'ok' },
};

const MARK_STYLE: Record<'ok' | 'no' | 'warn' | 'neutral', { bg: string; fg: string }> = {
  ok: { bg: 'var(--color-ok-soft)', fg: 'var(--color-ok)' },
  no: { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)' },
  warn: { bg: 'var(--color-warn-soft)', fg: 'var(--color-warn)' },
  neutral: { bg: 'var(--color-sunken)', fg: 'var(--color-ink-soft)' },
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtFull(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function stageKeyOf(ev: TaskEvent): string {
  const s = ev.payload?.stage;
  return typeof s === 'string' ? s : '';
}

function stageLabelOf(ev: TaskEvent): string {
  const s = stageKeyOf(ev);
  return s ? (WORKFLOW_STAGE_LABELS[s] ?? s) : '';
}

function eventNote(ev: TaskEvent): string {
  const n = ev.payload?.note;
  return typeof n === 'string' && n ? n : '';
}

/** 同类事件组（连续同 type + 同 stage 合并；最新在前） */
interface EventGroup {
  key: string;
  type: TaskEventType;
  stageKey: string;
  items: TaskEvent[];
}

function groupTitle(g: EventGroup): string {
  if (g.items.length === 1) return EVENT_LABELS[g.type];
  if (g.type === 'SUB_TASK_COMPLETE' && g.stageKey) {
    const unit = g.stageKey === 'main-image' || g.stageKey === 'detail-image' ? '张' : '项';
    return `${stageLabelOf(g.items[0])} · ${g.items.length} ${unit}完成`;
  }
  return `${EVENT_LABELS[g.type]} × ${g.items.length}`;
}

/** 活动日志（意见16 后半：最新在前 + 同类折叠可展开 + 文字图标前缀） */
function EventTimeline({ events }: { events: TaskEvent[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const groups = useMemo<EventGroup[]>(() => {
    const sorted = [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const out: EventGroup[] = [];
    for (const ev of sorted) {
      const sk = stageKeyOf(ev);
      const last = out[out.length - 1];
      if (last && last.type === ev.type && last.stageKey === sk) last.items.push(ev);
      else out.push({ key: String(ev.id), type: ev.type, stageKey: sk, items: [ev] });
    }
    return out;
  }, [events]);

  if (groups.length === 0) {
    return (
      <div className="qs-meta py-6 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无活动记录</div>
    );
  }

  return (
    <div className="relative space-y-2 border-l pl-4" style={{ borderColor: 'var(--color-line)' }}>
      {groups.map((g) => {
        const mark = EVENT_MARKS[g.type] ?? { ch: '·', tone: 'neutral' as const };
        const ms = MARK_STYLE[mark.tone];
        const foldable = g.items.length > 1;
        const open = expanded === g.key;
        const head = (
          <span className="flex items-center gap-1.5 min-w-0">
            {foldable ? (
              <span
                className="inline-block shrink-0 text-[12px] leading-none transition-transform"
                style={{ transform: open ? 'rotate(90deg)' : '', color: 'var(--color-ink-faint)' }}
              >
                ›
              </span>
            ) : null}
            <span className="truncate text-[12px] font-medium">{groupTitle(g)}</span>
          </span>
        );
        return (
          <div key={g.key} className="relative">
            <span className="absolute -left-[21.5px] top-1 h-[9px] w-[9px] rounded-full" style={{ background: 'var(--color-line-strong)' }} />
            <div className="flex items-center justify-between gap-2">
              {foldable ? (
                <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => setExpanded(open ? null : g.key)}>
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold" style={{ background: ms.bg, color: ms.fg }}>
                    {mark.ch}
                  </span>
                  {head}
                </button>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[10px] font-bold" style={{ background: ms.bg, color: ms.fg }}>
                    {mark.ch}
                  </span>
                  {head}
                </span>
              )}
              <span className="qs-meta shrink-0" title={fmtFull(g.items[0].createdAt)}>{fmtRelative(g.items[0].createdAt)}</span>
            </div>
            {stageLabelOf(g.items[0]) ? (
              <div className="qs-meta mt-0.5 pl-6 leading-relaxed" style={{ color: 'var(--color-ink-faint)' }}>
                {stageLabelOf(g.items[0])}
              </div>
            ) : null}
            {foldable && open ? (
              <div className="mt-1.5 space-y-1 border-l pl-4" style={{ borderColor: 'var(--color-line)' }}>
                {g.items.map((ev) => {
                  const note = eventNote(ev);
                  return (
                    <div key={ev.id} className="flex items-baseline justify-between gap-2">
                      <span className="text-[12px]" style={{ color: 'var(--color-ink-soft)' }}>{note || EVENT_LABELS[ev.type]}</span>
                      <span className="qs-meta shrink-0" title={fmtFull(ev.createdAt)}>{fmtRelative(ev.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** 阶段负责角色 → Agent 名（意见3：requirement/copy→美美、main-image/detail-image→平平、review/deliver→波波；与工位/播报映射一致） */
const ROLE_TO_AGENT_NAME: Record<string, string> = {
  文案: '美美',
  设计师: '平平',
  主管: '波波',
};

/**
 * 6 阶段条（意见5 重构：横向等分 + 圆形指示器 + 弹簧进度线 + 数字→✓ 形态 + 确认标记）
 * 意见3：指示器圆内显示负责 Agent 头像（按名从 agents 查；查不到回退数字/✓）
 * 意见4：仅「已流转到」的阶段（已完成/当前）显示头像；未到阶段不显示头像，回退为灰描边圆内数字序号
 * 状态语义：完成=绿底+右上对勾角标 / 当前=黑底+紫描边 / 未到=灰描边数字；标签同色
 * 确认点保留右下紫「确认」角标（引用 APPROVAL_POINT_STAGES，detail-image 加入后自动生效）
 * 进度线已完成段填充绿（300ms 过渡）；动效遵循 QS（--dur-standard / --dur-deliberate），
 * reduced-motion 由 index.css 全局规则自动关闭，无需组件内判断。
 */
function StageStepper({ task, agents }: { task: TaskWithMeta; agents: Agent[] }) {
  const done = task.column === 'done';
  const curIdx = WORKFLOW_STAGE_KEYS.indexOf(task.stage as (typeof WORKFLOW_STAGE_KEYS)[number]);
  const count = WORKFLOW_STAGE_KEYS.length;
  return (
    <div className="select-none overflow-x-auto py-1" role="group" aria-label="工作流阶段">
      <div className="flex min-w-[600px] items-start">
        {WORKFLOW_STAGE_KEYS.map((k, i) => {
          const state = done || i < curIdx ? 'done' : i === curIdx ? 'current' : 'todo';
          const isApproval = (APPROVAL_POINT_STAGES as string[]).includes(k);
          // 本节点已完成 → 它向右的进度线填充（弹簧：宽度 0→100%，300ms）
          const filled = done || i < curIdx;
          // 负责 Agent（意见3）：角色 → 名 → agents 按名查头像；查不到回退数字/✓
          const ownerName = ROLE_TO_AGENT_NAME[STAGE_OWNER_ROLE[k] ?? ''];
          const owner = ownerName ? agents.find((a) => a.name === ownerName) : undefined;
          return (
            <div key={k} className="flex min-w-0 flex-1 items-start">
              {/* 节点主体：圆形指示器（内嵌负责 Agent 头像）+ 下方标签 */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="relative">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-[13px] font-semibold tabular${state === 'current' ? ' qs-step-current' : ''}`}
                    aria-current={state === 'current' ? 'step' : undefined}
                    style={{
                      background: state === 'done' ? 'var(--color-ok)' : state === 'current' ? 'var(--color-ink)' : 'var(--color-surface)',
                      border: `1px solid ${state === 'todo' ? 'var(--color-line-strong)' : 'transparent'}`,
                      color: state === 'done' || state === 'current' ? '#fff' : 'var(--color-ink-faint)',
                      boxShadow: state === 'current' ? '0 0 0 2px var(--color-signal)' : undefined,
                      transition:
                        'background var(--dur-standard) var(--ease-standard), color var(--dur-standard) var(--ease-standard), border-color var(--dur-standard) var(--ease-standard), box-shadow var(--dur-standard) var(--ease-standard)',
                    }}
                  >
                    {state !== 'todo' && owner ? (
                      <Avatar name={owner.name} id={owner.id} size={24} />
                    ) : state === 'done' ? (
                      '✓'
                    ) : (
                      i + 1
                    )}
                  </div>
                  {/* 完成对勾角标（右上；与右下确认角标并存不冲突） */}
                  {state === 'done' ? (
                    <span
                      className="absolute -top-0.5 -right-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full text-[9px] font-bold"
                      style={{ background: '#fff', color: 'var(--color-ok)', boxShadow: '0 0 0 2px var(--color-surface)' }}
                    >
                      ✓
                    </span>
                  ) : null}
                  {isApproval ? (
                    <span
                      className="absolute -bottom-1 -right-2 flex h-[15px] items-center rounded-[4px] px-1 text-[9px] font-bold text-white"
                      style={{ background: 'var(--color-signal)' }}
                    >
                      确认
                    </span>
                  ) : null}
                </div>
                <span
                  className="qs-meta w-[64px] text-center text-[10px] leading-tight"
                  style={{
                    color: state === 'done' ? 'var(--color-ok)' : state === 'current' ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                    transition: 'color var(--dur-standard) var(--ease-standard)',
                  }}
                >
                  {WORKFLOW_STAGE_LABELS[k]}
                </span>
              </div>
              {/* 弹簧进度线（self-start + mt 17px 对齐指示器圆心，h-9=36px → 中心 18px） */}
              {i < count - 1 ? (
                <div
                  className="relative mx-1.5 h-[2px] min-w-4 flex-1 self-start"
                  style={{ marginTop: 17, background: 'var(--color-line)' }}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: filled ? '100%' : '0%',
                      background: 'var(--color-ok)',
                      transition: 'width var(--dur-deliberate) var(--ease-standard)',
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 子面板加载占位（QS：直角卡片 + 脉冲条，避免异步数据返回时布局跳变；空数据态仍按原设计不占位） */
function PanelSkeleton({ title, lines = 2 }: { title: string; lines?: number }) {
  return (
    <div className="qs-card p-4" aria-busy="true">
      <div className="mb-3 flex items-center gap-2">
        <span className="qs-pulse block h-4 w-32 rounded-[3px]" style={{ background: 'var(--color-sunken)' }} />
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="qs-pulse block h-9 rounded-[4px]" style={{ background: 'var(--color-sunken)' }} />
        ))}
      </div>
    </div>
  );
}

/** 任务关联的知识库资料（板块 A/B 唯一耦合点，6.3）：标题 / 路径 / 片段范围 + 跳转原文 + 失效标记 */
function KbRefsPanel({ taskId }: { taskId: number }) {
  const { openKbDoc } = useWorkbench();
  const [refs, setRefs] = useState<TaskKbRef[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .taskKbRefs(taskId)
      .then((r) => {
        if (!cancelled) setRefs(r.refs);
      })
      .catch(() => {
        if (!cancelled) setRefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (refs === null) return <PanelSkeleton title="关联知识库资料" />;
  // 未关联资料时不占用任务详情空间（知识库未连接时的既有体验保持一致）
  if (refs.length === 0) return null;

  const invalidCount = refs.filter((r) => !r.valid).length;
  return (
    <div className="qs-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold">关联知识库资料</h3>
        <span className="qs-meta" style={{ color: invalidCount > 0 ? 'var(--color-danger)' : 'var(--color-ink-faint)' }}>
          {refs.length} 份{invalidCount > 0 ? ` · ${invalidCount} 份已失效` : ''}
        </span>
      </div>
      <div className="space-y-1.5">
        {refs.map((r) => (
          <div key={r.id} className="rounded-[4px] border px-2.5 py-2" style={{ borderColor: r.valid ? 'var(--color-line)' : 'var(--color-danger-soft)', background: r.valid ? 'transparent' : 'var(--color-danger-soft)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: r.valid ? 'var(--color-ink)' : 'var(--color-danger)' }}>
                  {r.title}
                  {!r.valid ? <span className="qs-meta ml-1.5">失效（Vault 中已不存在）</span> : null}
                </div>
                <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
                  {r.docPath}
                  {r.anchor ? ` · 片段「${r.anchor}」` : ' · 整篇'}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 cursor-pointer text-[12px] hover:underline"
                style={{ color: r.valid ? 'var(--color-signal)' : 'var(--color-ink-faint)' }}
                onClick={() => openKbDoc(r.docPath)}
                title="跳转到知识库阅读原文"
              >
                阅读原文
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
        关联资料以只读方式作为 Agent 生成的事实参考，不会写回知识库。
      </p>
    </div>
  );
}

/** 任务背景 · 外部环境情报（hot-intel D2：列表 + 移除 + 失效标记 + 原文外链；与「关联知识库资料」并列且视觉可区分） */
function HotRefsPanel({ taskId }: { taskId: number }) {
  const [refs, setRefs] = useState<TaskHotRef[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .taskHotRefs(taskId)
      .then((r) => {
        if (!cancelled) setRefs(r.refs);
      })
      .catch(() => {
        if (!cancelled) setRefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (refs === null) return <PanelSkeleton title="任务背景 · 外部环境情报" />;
  // 未关联任何背景时不出现该区块（不占位）
  if (refs.length === 0) return null;

  const toInput = (r: TaskHotRef): TaskHotRefInput => ({
    hotId: r.hotId,
    title: r.title,
    sourceId: r.sourceId,
    sourceName: r.sourceName,
    evidence: r.evidence,
    url: r.url,
    latestAt: r.latestAt,
  });

  const remove = async (hotId: string) => {
    setBusy(true);
    try {
      const r = await api.saveTaskHotRefs(taskId, refs.filter((x) => x.hotId !== hotId).map(toInput));
      setRefs(r.refs);
    } finally {
      setBusy(false);
    }
  };

  const invalidCount = refs.filter((r) => !r.valid).length;
  return (
    <div className="qs-card p-4" data-hot-refs-panel>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-[15px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
          任务背景 · 外部环境情报
        </h3>
        <span className="qs-meta" style={{ color: invalidCount > 0 ? 'var(--color-danger)' : 'var(--color-ink-faint)' }}>
          {refs.length} 条{invalidCount > 0 ? ` · ${invalidCount} 条已失效` : ''}
        </span>
      </div>
      <div className="space-y-1.5">
        {refs.map((r) => (
          <div
            key={r.id}
            className="rounded-[4px] border-l-2 px-2.5 py-2"
            style={{ borderColor: 'var(--color-signal)', background: r.valid ? 'var(--color-signal-soft)' : 'var(--color-danger-soft)' }}
            data-hot-ref={r.hotId}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: r.valid ? 'var(--color-ink)' : 'var(--color-danger)' }}>
                  {r.title}
                  {!r.valid ? <span className="qs-meta ml-1.5">已失效（面板中已下线）</span> : null}
                </div>
                <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
                  {r.sourceName || '外部热点'}
                  {r.evidence ? ` · ${r.evidence === 'multi-source' ? '多源事件' : r.evidence === 'traceable' ? '可回查原文' : '单源信息'}` : ''}
                  {r.latestAt ? ` · ${fmtTime(r.latestAt)}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer" className="qs-meta hover:underline" style={{ color: 'var(--color-signal)' }}>
                    原文 ↗
                  </a>
                ) : null}
                <button type="button" className="qs-meta cursor-pointer hover:underline" style={{ color: 'var(--color-ink-faint)' }} onClick={() => void remove(r.hotId)} disabled={busy}>
                  移除
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
        外部环境情报仅作背景参考，不作为产品品类/主体/功能规格依据。
      </p>
    </div>
  );
}

/** 任务详情（对齐线框 renderTask：面包屑 + task-head + 阶段条 + tabs + 属性面板 / 内容交付） */
export function TaskDetailView({
  taskId,
  onBack,
  onNotFound,
}: {
  taskId: number;
  onBack: () => void;
  onNotFound: () => void;
}) {
  const { tasks, agents, eventsByTask, deliverablesByTask, openTask, taskTab, setTaskTab } = useWorkbench();
  const [descExpanded, setDescExpanded] = useState(false);

  // 新打开任务时默认落在「内容交付」tab（意见11；key=taskId 重挂载时执行一次；用户可手动切「任务详情」）
  const firstTabRef = useRef(true);
  useEffect(() => {
    if (firstTabRef.current) {
      setTaskTab('deliver');
      firstTabRef.current = false;
    }
    openTask(taskId);
  }, [taskId, openTask, setTaskTab]);

  const task = tasks.find((t) => t.id === taskId);

  useEffect(() => {
    if (tasks.length > 0 && !task) onNotFound();
  }, [task, tasks.length, onNotFound]);

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="加载任务…" />
      </div>
    );
  }

  const awaiting = task.column === 'awaiting';
  const done = task.column === 'done';

  // 24：进度与阶段条统一数据源（均由 task.stage 推导），消除「进度 0% 但阶段已是 1/6」的语义冲突
  const stageIdx = Math.max(0, WORKFLOW_STAGE_KEYS.indexOf(task.stage as (typeof WORKFLOW_STAGE_KEYS)[number]));
  const stagePct = Math.round(((done ? WORKFLOW_STAGE_KEYS.length : stageIdx + 1) / WORKFLOW_STAGE_KEYS.length) * 100);
  const progressText = `阶段 ${done ? WORKFLOW_STAGE_KEYS.length : stageIdx + 1}/${WORKFLOW_STAGE_KEYS.length} · ${stagePct}%`;

  // 产出摘要（文案标题 + 图片张数）
  const deliverables = deliverablesByTask[task.id] ?? [];
  const copyDel = deliverables.find((d) => d.kind === 'copy');
  const copyTitle = copyDel ? (parseCopy(copyDel)?.title ?? null) : null;
  const imgCount = deliverables
    .filter((d) => d.kind === 'image')
    .reduce((n, d) => n + (parseImages(d)?.length ?? 0), 0);

  // 当前阶段状态点（对齐工位状态语义：待确认=紫、进行=紫闪、完成=绿、规划=灰）
  const columnDot = awaiting ? 'qs-dot signal' : done ? 'qs-dot ok' : task.column === 'progress' ? 'qs-dot signal busy' : 'qs-dot unconfigured';

  return (
    <div className="space-y-4">
      {/* 面包屑（意见2：看板 / 任务 #id，点「看板」回列表） */}
      <nav className="qs-meta flex items-center gap-1.5" aria-label="面包屑">
        <button type="button" className="cursor-pointer hover:underline hover:text-[var(--color-ink)]" style={{ color: 'var(--color-ink-soft)' }} onClick={onBack}>
          看板
        </button>
        <span style={{ color: 'var(--color-ink-faint)' }}>/</span>
        <span style={{ color: 'var(--color-ink)' }}>任务 #{task.id}</span>
      </nav>

      {/* task-head（对齐线框 th-1/2/3，QS 编辑性大标题；意见11：返回按钮与标题垂直居中、加大尺寸并带边框强调，无 emoji） */}
      <div>
        <div className="qs-meta mb-1" style={{ color: 'var(--color-ink-faint)' }}>
          #{task.id} {task.title} · 电商新品上架 · 由你创建
        </div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display min-w-0 flex-1 text-[24px] font-bold leading-[1.15] md:text-[28px]" style={{ fontFamily: 'var(--font-display)' }}>
            {task.title}
          </h2>
          <span className="flex shrink-0 items-center gap-2">
            {/* B4 · 4.10 交付包下载入口（未归档任务也允许下载；无交付物时展示 409 中文原因） */}
            <DownloadButton taskId={task.id} />
            <button
              type="button"
              className="shrink-0 cursor-pointer rounded-[4px] border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-line-strong)]"
              onClick={onBack}
            >
              ← 返回任务看板
            </button>
          </span>
        </div>
        <div className="space-y-1">
          <div className={`qs-meta mt-1.5 ${descExpanded ? '' : 'line-clamp-3'}`} style={{ color: 'var(--color-ink-soft)' }}>
            {task.description || '新品上架全套物料'}
          </div>
          {task.description && task.description.length > 80 ? (
            <button type="button" className="qs-clickable qs-meta text-[12px]" style={{ color: 'var(--color-signal)' }} onClick={() => setDescExpanded((v) => !v)}>
              {descExpanded ? '收起' : '展开全文'}
            </button>
          ) : null}
        </div>
        {/* B6 · 9.3 任务详情头部角标（阶段条以上，数字与看板一致） */}
        {task.kbRefsInvalid > 0 ? (
          <div className="mt-2">
            <KbInvalidBadge task={task} />
          </div>
        ) : null}
      </div>

      {/* stages（意见11：6 节点 + 确认标记 + 箭头；意见3：节点内嵌负责 Agent 头像） */}
      <div className="qs-card p-3">
        <StageStepper task={task} agents={agents} />
      </div>

      {/* tabs（对齐线框 tabs；QS 焦点信号；意见12：内容交付在前，去掉「· 审批」） */}
      <Tabs
        items={[
          { key: 'deliver', label: '内容交付' },
          { key: 'detail', label: '任务详情' },
        ]}
        activeKey={taskTab}
        onChange={setTaskTab}
      />

      {taskTab === 'deliver' ? (
        <ContentDeliveryView taskId={taskId} />
      ) : (
        /* status-grid：内容区 + 280 属性面板 */
        <div className="flex gap-4">
          <div className="min-w-0 flex-1 space-y-4">
            {/* 当前阶段卡片 + 产出摘要（意见16 替代横幅与交付物概览） */}
            <div
              className="rounded-[4px] border px-3 py-2.5"
              style={{ borderColor: awaiting ? 'var(--color-signal)' : 'var(--color-line)', background: awaiting ? 'var(--color-signal-soft)' : 'var(--color-canvas)' }}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={columnDot} />
                <span className="text-[12px] font-bold">当前阶段：{task.stageLabel || WORKFLOW_STAGE_LABELS[task.stage]}</span>
                <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>负责人 {task.ownerName || '—'}</span>
              </div>
              <div className="text-[13px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                {task.stageNote || (done ? '已交付 · 已完成' : '引擎推进中…')}
              </div>
              {copyTitle || imgCount > 0 ? (
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 border-t pt-2" style={{ borderColor: 'var(--color-line)' }}>
                  {copyTitle ? (
                    <span className="qs-meta">文案 <span style={{ color: 'var(--color-ink-soft)' }}>{copyTitle}</span></span>
                  ) : null}
                  {imgCount > 0 ? (
                    <span className="qs-meta">图片 <span style={{ color: 'var(--color-ink-soft)' }}>{imgCount} 张</span></span>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* 关联知识库资料（有则显示，无则不占位） */}
            <KbRefsPanel taskId={task.id} />

            {/* 任务背景 · 外部环境情报（hot-intel D2：有则显示，无则不占位） */}
            <HotRefsPanel taskId={task.id} />

            {/* 产出溯源（B1：溯源率 + 明细 + 未关联警示；无产出/无事实项时不占位） */}
            <ProvenancePanel taskId={task.id} />

            {/* 返工记录（B2：第 N 次返工 · 意见；无返工时不占位） */}
            <ReworkPanel taskId={task.id} />

            {/* 执行与成本（B12 · 16.x：耗时合计 / 执行次数 / 阶段明细 / 模型 / token / 估算金额） */}
            <CostCard taskId={task.id} />

            {/* 活动日志 */}
            <div className="qs-card p-4">
              <h3 className="font-display mb-3 text-[15px] font-semibold">活动日志</h3>
              <EventTimeline events={eventsByTask[task.id] ?? []} />
            </div>
          </div>

          {/* 属性面板（280px，对齐线框 side-panel） */}
          <aside className="qs-card h-fit w-[280px] shrink-0 p-4">
            <h3 className="font-display mb-3 text-[15px] font-semibold">属性</h3>
            <div className="space-y-2.5">
              {[
                ['类型', '电商新品上架'],
                ['当前阶段', WORKFLOW_STAGE_LABELS[task.stage] ?? task.stage],
                ['进度', progressText],
                ['负责人', task.ownerName || '—'],
                ['创建人', task.createdBy || '—'],
                ['状态', task.column === 'planned' ? '规划中' : task.column === 'progress' ? '进行中' : task.column === 'awaiting' ? '待确认' : '已完成'],
                ['创建时间', fmtFull(task.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b pb-2 last:border-b-0" style={{ borderColor: 'var(--color-line)' }}>
                  <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{k}</span>
                  <span className="text-right text-[13px] font-medium">{v}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/* ===== 产出溯源（B1 · 2.6/2.7） ===== */
const FACT_TYPE_LABELS: Record<string, string> = { number: '数值', cert: '认证', material: '材质', textual: '文本' };

function ProvenancePanel({ taskId }: { taskId: number }) {
  const [provenance, setProvenance] = useState<ProvenanceResult | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setProvenance(undefined);
    void api
      .taskProvenance(taskId)
      .then((r) => {
        if (alive) setProvenance(r.provenance);
      })
      .catch(() => {
        if (alive) setProvenance(null);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  // 文案未产出 / 加载中：先占位骨架，避免布局跳变；加载失败则下方按空态处理
  if (provenance === undefined) return <PanelSkeleton title="产出溯源" />;

  // 无 kind='provenance' 行（老任务或文案未产出过）：一行提示，不占位（spec 2.6）
  if (provenance === null) {
    return (
      <div className="qs-meta px-1 py-1.5" style={{ color: 'var(--color-ink-faint)' }}>
        产出溯源：尚未生成结果（重新产出后生效）
      </div>
    );
  }

  // 未关联资料：明确警示，不展示溯源率数值（spec 2.7）
  if (!provenance.hasRefs) {
    return (
      <div
        className="flex items-center gap-2 rounded-[4px] border px-3 py-2 text-[12px]"
        style={{ borderColor: 'var(--color-warn)', background: 'var(--color-warn-soft)', color: 'var(--color-ink-soft)' }}
      >
        <span aria-hidden="true">⚠</span>
        <span>
          本任务未关联任何知识库资料 · <strong>参数由模型生成，请人工核对</strong>
        </span>
      </div>
    );
  }

  // 无实质事实项：一行提示，不显示 0%/100% 误导数值
  if (provenance.noFacts) {
    return (
      <div className="qs-meta px-1 py-1.5" style={{ color: 'var(--color-ink-faint)' }}>
        产出溯源：无实质事实项（文案中未抽取到可核对的事实）
      </div>
    );
  }

  return (
    <div className="qs-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[15px] font-semibold">产出溯源</h3>
        <Badge tone={provenance.percent !== null && provenance.percent >= 80 ? 'ok' : provenance.percent !== null && provenance.percent >= 50 ? 'warn' : 'no'}>
          {provenance.percent}%（{provenance.tracedCount}/{provenance.totalCount}）
        </Badge>
        {provenance.untracedCount > 0 ? (
          <Badge tone="warn">{provenance.untracedCount} 项未溯源</Badge>
        ) : null}
        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          可溯源事实项 ÷ 全部事实项 · 核对 {provenance.refCount} 份资料
        </span>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {provenance.facts.map((f) => (
          <div key={f.id} className="flex items-baseline gap-2 rounded-[3px] px-1.5 py-1 text-[12px]" style={{ background: f.traced ? 'var(--color-ok-soft)' : 'var(--color-danger-soft)' }}>
            <span className="shrink-0 font-medium" style={{ color: f.traced ? 'var(--color-ok)' : 'var(--color-danger)' }}>
              {f.traced ? '已溯源' : '未溯源'}
            </span>
            <span className="min-w-0 flex-1 truncate" title={f.text}>
              [{FACT_TYPE_LABELS[f.type] ?? f.type}] {f.text}
            </span>
            {f.sources.length > 0 ? (
              <span className="qs-meta shrink-0 truncate" style={{ maxWidth: '40%', color: 'var(--color-ink-faint)' }} title={f.sources.join(' / ')}>
                来自 {f.sources.join(' / ')}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== 返工记录（B2 · 3.7：第 N 次返工 · 意见，含阶段与时间；不依赖知识库连接） ===== */
function ReworkPanel({ taskId }: { taskId: number }) {
  const [rework, setRework] = useState<ReworkInfo | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setRework(undefined);
    void api
      .taskRework(taskId)
      .then((r) => {
        if (alive) setRework(r.rework);
      })
      .catch(() => {
        if (alive) setRework(null);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  // 加载中：占位骨架，避免布局跳变
  if (rework === undefined) return <PanelSkeleton title="返工记录" />;
  // 无返工记录：不显示返工区块（spec 3.6）
  if (!rework || rework.count === 0 || rework.records.length === 0) return null;

  // 最新在前展示（后端升序返回）
  const records = [...rework.records].reverse();
  return (
    <div className="qs-card p-4">
      <h3 className="font-display mb-3 text-[15px] font-semibold">返工记录</h3>
      <div className="space-y-2">
        {records.map((r, i) => (
          <div key={`${r.stage}-${r.at}-${i}`} className="rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)' }}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-bold" style={{ color: 'var(--color-danger)' }}>
                第 {rework.count - i} 次返工 · 意见：{r.note || '（未填写意见）'}
              </span>
            </div>
            <div className="qs-meta mt-1 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
              {WORKFLOW_STAGE_LABELS[r.stage] ?? r.stage} · {fmtFull(r.at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ===== 执行与成本卡片（B12 · 16.x） ===== */

/** 人类可读耗时：<1s 用 ms，<60s 用 s，否则 m/s */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

function fmtMoney(amount: number, currency: string): string {
  const symbol = currency === 'CNY' ? '¥' : currency === 'USD' ? 'US$' : '';
  return `${symbol}${amount.toFixed(2)} ${currency}`;
}

function CostStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="qs-meta text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-medium">{value}</div>
    </div>
  );
}

/** 16.1-16.4：总耗时/执行次数（成功/失败）/按阶段耗时明细/模型/token 与（cost != null 时）估算金额 */
function CostCard({ taskId }: { taskId: number }) {
  const [summary, setSummary] = useState<TaskCostSummary | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setSummary(undefined);
    void api
      .taskCost(taskId)
      .then((r) => {
        if (alive) setSummary(r.summary);
      })
      .catch(() => {
        if (alive) setSummary(null);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  // 加载中：占位骨架，避免布局跳变
  if (summary === undefined) return <PanelSkeleton title="执行与成本" lines={3} />;
  // 接口失败：不占位
  if (summary === null) return null;

  // 16.4 空态：无执行记录 → 一行提示，不占位
  if (summary.runs === 0) {
    return (
      <div className="qs-meta px-1 py-1.5" style={{ color: 'var(--color-ink-faint)' }}>
        执行与成本：尚无执行记录
      </div>
    );
  }

  const { cost, tokens } = summary;
  // 16.2 标注估算：估算记录存在 → 文案含「估算」；全部真实 → 标注「实测」；均不用「消耗」等确定性措辞
  const tokenText = tokens.tokensEstimated
    ? `约 ${tokens.total.toLocaleString()}（估算）`
    : `${tokens.total.toLocaleString()}（实测）`;

  return (
    <div className="qs-card p-4">
      <h3 className="font-display mb-3 flex items-center justify-between text-[15px] font-semibold">
        <span>执行与成本</span>
        {/* 16.3：无单价表（cost=null）时不出现任何金额 */}
        {cost ? (
          <span className="qs-badge" title={cost.note} style={{ background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }}>
            估算费用 {fmtMoney(cost.amount, cost.currency)}
          </span>
        ) : null}
      </h3>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <CostStat label="总耗时" value={fmtDuration(summary.totalDurationMs)} />
        <CostStat label="执行次数" value={`${summary.runs} 次 · 成功 ${summary.successRuns} / 失败 ${summary.failedRuns}`} />
        <CostStat label="涉及模型" value={summary.models.join('、') || '—'} />
        <CostStat label="Token" value={tokenText} />
      </div>

      {summary.byStage.length > 0 ? (
        <div className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--color-line)' }}>
          <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-faint)' }}>
            按阶段耗时
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {summary.byStage.map((s) => (
              <span key={s.stage} className="qs-meta text-[12px]">
                {s.stageLabel}：<span style={{ color: 'var(--color-ink)' }}>{fmtDuration(s.durationMs)}</span>（{s.runs} 次）
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
