import { useEffect, useRef, useState } from 'react';
import type { AgentOnlineStatus, Message } from '@workbench/shared';
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Avatar } from '../../components/ui.tsx';

/** 工位状态 → 文案 + 状态点 tone（未连接API = 红色 no，忙碌 = 紫脉冲 busy） */
const STATUS_META: Record<AgentOnlineStatus, { label: string; dot: string; color: string }> = {
  busy: { label: '忙碌中', dot: 'busy', color: 'var(--color-signal)' },
  idle: { label: '待命', dot: 'idle', color: 'var(--color-ink-faint)' },
  online: { label: '在线', dot: 'ok', color: 'var(--color-ok)' },
  unconfigured: { label: '未连接API', dot: 'no', color: 'var(--color-danger)' },
};

/** receipt：Agent 已收到用户消息的居中分隔总结（微信式“已收到”回执） */
function ReceiptLine({ m }: { m: Message }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 select-none">
      <span className="h-px flex-1" style={{ background: 'var(--color-line-strong)' }} />
      <span className="qs-meta text-center" style={{ color: 'var(--color-ink-faint)' }}>
        —— {m.from} · 已收到你的消息 ——
      </span>
      <span className="h-px flex-1" style={{ background: 'var(--color-line-strong)' }} />
    </div>
  );
}

/** 顶栏：工作群 + 各 Agent 圆头像会话切换 + 当前会话工位同步信息 */
function ChatHeader() {
  const { agents, chatTarget, selectChat } = useWorkbench();
  const isGroup = chatTarget.kind === 'group';
  const curAgent = isGroup ? null : agents.find((a) => a.id === chatTarget.to);
  const st = curAgent ? STATUS_META[curAgent.onlineStatus] : null;
  return (
    <div className="border-b px-3 pt-2.5 pb-2" style={{ borderColor: 'var(--color-line)' }}>
      {/* 圆头像横排：工作群（“群”符号圆）+ 3 个 Agent */}
      <div className="flex items-center gap-3 overflow-x-auto">
        <button
          type="button"
          className="flex shrink-0 flex-col items-center gap-1"
          title="工作群 · 事件与协作播报汇集于此"
          onClick={() => selectChat({ kind: 'group', to: '全体' })}
        >
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full font-display text-[15px] font-bold text-white transition-colors"
            style={{ background: isGroup ? 'var(--color-signal)' : 'var(--color-ink)', outline: isGroup ? '2px solid var(--color-signal)' : 'none', outlineOffset: 2 }}
          >
            群
          </span>
          <span className="qs-meta text-[10px]" style={{ color: isGroup ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}>
            工作群
          </span>
        </button>
        {agents.map((a) => {
          const active = !isGroup && chatTarget.to === a.id;
          const meta = STATUS_META[a.onlineStatus];
          return (
            <button key={a.id} type="button" className="flex shrink-0 flex-col items-center gap-1" title={`${a.name} · ${meta.label}`} onClick={() => selectChat({ kind: 'private', to: a.id })}>
              <span className="relative" style={{ outline: active ? '2px solid var(--color-signal)' : 'none', outlineOffset: 2, borderRadius: 999 }}>
                <Avatar name={a.name} size={40} />
                <span className={`qs-dot absolute -bottom-0.5 -right-0.5 ${meta.dot}`} style={{ boxShadow: '0 0 0 2px var(--color-surface)' }} />
              </span>
              <span className="qs-meta text-[10px]" style={{ color: active ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}>
                {a.name}
              </span>
            </button>
          );
        })}
      </div>
      {/* 工位同步信息：名字 + 当前工作状态（含 activity） */}
      <div className="mt-2 flex items-center gap-1.5 border-t pt-2" style={{ borderColor: 'var(--color-line)' }}>
        {curAgent && st ? (
          <>
            <span className="text-[12px] font-medium">{curAgent.name}</span>
            <span className={`qs-dot ${st.dot}`} style={{ boxShadow: '0 0 0 2px var(--color-surface)' }} />
            <span className="text-[11px]" style={{ color: st.color }}>{st.label}</span>
            {curAgent.activity ? (
              <span className="qs-meta truncate" style={{ color: 'var(--color-ink-faint)' }} title={curAgent.activity}>
                · {curAgent.activity}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-[12px] font-medium">工作群</span>
            <span className="qs-meta truncate" style={{ color: 'var(--color-ink-faint)' }}>全体 Agent 协作 · 事件与回执在此汇集</span>
          </>
        )}
      </div>
    </div>
  );
}

/** 待拍板提醒条（原参考图黄铃铛 → 文字 + ● 符号；点击跳转任务） */
function ApprovalReminder() {
  const { approvalQueue, openTask } = useWorkbench();
  if (approvalQueue.length === 0) return null;
  return (
    <div className="mx-3 mt-2.5 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-warn)', background: 'var(--color-warn-soft)' }}>
      <div className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--color-warn)' }}>
        <span aria-hidden="true">●</span>
        待拍板提醒
      </div>
      <div className="mt-1 space-y-0.5">
        {approvalQueue.map((x) => (
          <button
            key={x.taskId}
            type="button"
            className="block w-full text-left text-[12px] leading-snug transition-colors hover:underline"
            style={{ color: 'var(--color-ink-soft)' }}
            onClick={() => openTask(x.taskId)}
          >
            #{x.taskId} · {WORKFLOW_STAGE_LABELS[x.stage] ?? x.stage} 进入待确认 → 点击跳转
          </button>
        ))}
      </div>
    </div>
  );
}

/** 聊天侧栏：工作群 / 私聊（含 Agent 事件播报 + receipt 回执） */
export function ChatPanel() {
  const { agents, messages, chatTarget, sendChat, connected, openTask } = useWorkbench();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length]);

  const submit = () => {
    if (!draft.trim()) return;
    sendChat(draft);
    setDraft('');
  };

  return (
    <div className="flex h-full flex-col">
      <ChatHeader />
      <ApprovalReminder />

      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="qs-meta text-center py-8" style={{ color: 'var(--color-ink-faint)' }}>
            {chatTarget.kind === 'group' ? '工作群 · 事件与协作播报汇集于此' : `与 ${agents.find((a) => a.id === chatTarget.to)?.name ?? chatTarget.to} 的私聊`}
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === 'receipt') return <ReceiptLine key={m.id} m={m} />;
            if (m.kind === 'evt') {
              return (
                <div key={m.id} className="qs-meta px-2 py-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>
                  {m.taskId ? (
                    <button type="button" className="transition-colors hover:underline" style={{ color: 'inherit' }} onClick={() => openTask(m.taskId as number)}>
                      ── {m.body} ──
                    </button>
                  ) : (
                    <span>── {m.body} ──</span>
                  )}
                </div>
              );
            }
            const isMe = m.from === '你';
            const agent = agents.find((a) => a.name === m.from || a.id === m.from);
            const time = new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            if (isMe) {
              // 右侧：用户消息 = 黑底白字气泡（无头像）
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[78%] rounded-[4px] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ background: 'var(--color-ink)', color: '#fff', borderRadius: 4 }}>
                    {m.body}
                  </div>
                </div>
              );
            }
            // 左侧：Agent 消息 = 圆头像 + 名字 + 时间 + 灰底气泡
            return (
              <div key={m.id} className="flex gap-2">
                <Avatar name={m.from} size={28} />
                <div className="max-w-[78%]">
                  <div className="qs-meta mb-0.5" style={{ color: agent?.onlineStatus === 'online' ? 'var(--color-signal)' : 'var(--color-ink-faint)' }}>
                    {m.from} · {time}
                  </div>
                  <div className="rounded-[4px] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ background: 'rgba(0,0,0,0.045)', color: 'var(--color-ink)', borderRadius: 4 }}>
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t p-2.5" style={{ borderColor: 'var(--color-line)' }}>
        <div className="flex items-center gap-2">
          <input
            className="qs-input"
            placeholder={connected ? '输入消息，回车发送…' : '连接中…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            disabled={!connected}
          />
          <button type="button" className="qs-btn primary shrink-0" onClick={submit} disabled={!connected || !draft.trim()}>
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
