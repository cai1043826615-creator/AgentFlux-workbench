import { useEffect, useRef, useState } from 'react';
import type { AgentOnlineStatus, Message } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Avatar } from '../../components/ui.tsx';
import { AvatarStatus } from '../../components/AvatarStatus.tsx';

/** 工作群头像命名规则（群头像统一放 frontend/public/groups/，直接引用路径、不落盘生成）：
 *  当前电商新品上架工作流 → 电商工作群 ecom.png（紫色购物袋）
 *  直播带货 → live.png（橙紫摄像机，暂未生成时回退 general.png 兜底）
 *  跨境选品 → cross.png（蓝绿地球包裹） · 其他 → general.png（彩色对话气泡）
 *  群头像使用：<img src="/groups/ecom.png" className="h-10 w-10 rounded-full object-cover" alt="电商工作群" />
 */

/** 工位状态 → 文案 + 状态点 tone（未连接API = 红色 no，忙碌 = 紫脉冲 busy） */
const STATUS_META: Record<AgentOnlineStatus, { label: string; dot: string; color: string }> = {
  busy: { label: '忙碌中', dot: 'busy', color: 'var(--color-signal)' },
  idle: { label: '待命', dot: 'idle', color: 'var(--color-ink-faint)' },
  online: { label: '在线', dot: 'ok', color: 'var(--color-ok)' },
  unconfigured: { label: '未连接API', dot: 'no', color: 'var(--color-danger)' },
};

/** receipt：Agent 已收到用户消息的居中分隔总结（微信式“已收到”回执）
 *  视觉：两侧分隔线 + 小字 + agent 头像小图（from 查不到 agents 时 Avatar 回退字母头像）
 *  群聊与私聊共用同一渲染分支，两种会话均显示 */
function ReceiptLine({ m }: { m: Message }) {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 select-none">
      <span className="h-px flex-1" style={{ background: 'var(--color-line-strong)' }} />
      <span className="qs-meta flex items-center gap-1.5 text-center whitespace-nowrap" style={{ color: 'var(--color-ink-faint)' }}>
        <Avatar name={m.from} size={16} />
        {m.from} · 已收到你的消息
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
          title="电商工作群 · 事件与协作播报汇集于此"
          style={{ cursor: 'pointer' }}
          onClick={() => selectChat({ kind: 'group', to: '全体' })}
        >
          <span
            className="block h-10 w-10 overflow-hidden rounded-full transition-colors"
            style={{ outline: isGroup ? '2px solid var(--color-signal)' : 'none', outlineOffset: 2 }}
          >
            <img src="/groups/ecom.png" alt="电商工作群" className="h-full w-full object-cover" />
          </span>
          <span className="qs-meta text-[10px]" style={{ color: isGroup ? 'var(--color-ink)' : 'var(--color-ink-faint)' }}>
            电商工作群
          </span>
        </button>
        {agents.map((a) => {
          const active = !isGroup && chatTarget.to === a.id;
          const meta = STATUS_META[a.onlineStatus];
          return (
            <button key={a.id} type="button" className="flex shrink-0 flex-col items-center gap-1" title={`${a.name}（${a.role}）· ${meta.label}`} style={{ cursor: 'pointer' }} onClick={() => selectChat({ kind: 'private', to: a.id })}>
              <AvatarStatus
                active={active}
                name={a.name}
                size={40}
                statusClass={meta.dot}
                avatarTitle={`${a.name}（${a.role}）· ${meta.label}`}
              />
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
          <span className="text-[12px] font-medium">电商工作群</span>
        )}
      </div>
    </div>
  );
}

/** 聊天侧栏：电商工作群 / 私聊（含 Agent 事件播报 + receipt 回执）
 *  事件筛选：全部 / 消息 / 事件（本地过滤渲染，不改数据源）；
 *  「全部」下事件默认折叠为一行「n 条系统事件 ▾」，点击展开/收起 */
type EventFilter = 'all' | 'msg' | 'evt';
const EVENT_FILTERS: { key: EventFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'msg', label: '消息' },
  { key: 'evt', label: '事件' },
];

export function ChatPanel() {
  const { agents, messages, chatTarget, sendChat, connected, openTask } = useWorkbench();
  const [draft, setDraft] = useState('');
  const [showEvents, setShowEvents] = useState(false); // 「全部」下事件折叠态（默认收起）
  const [filter, setFilter] = useState<EventFilter>('all'); // 筛选：默认「全部」
  const scrollRef = useRef<HTMLDivElement>(null);

  // 事件消息（kind==='evt'）数量：折叠行显示在固定筛选区右侧
  const evtCount = messages.filter((m) => m.kind === 'evt').length;

  /** evt 行渲染（── body ── 分隔行；带 taskId 时可点击跳任务详情） */
  const renderEvt = (m: Message) => (
    <div key={m.id} className="qs-meta px-2 py-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>
      {m.taskId ? (
        <button type="button" className="transition-colors hover:underline" style={{ color: 'inherit', cursor: 'pointer' }} onClick={() => openTask(m.taskId as number)}>
          ── {m.body} ──
        </button>
      ) : (
        <span>── {m.body} ──</span>
      )}
    </div>
  );

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

      {/* 事件筛选 + 折叠行（固定区：不随消息滚动，任何位置均可见） */}
      {messages.length > 0 && chatTarget.kind === 'group' ? (
        <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: 'var(--color-line)' }}>
          <div className="flex items-center gap-1">
            {EVENT_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="qs-meta rounded px-2 py-0.5 transition-colors"
                style={{
                  cursor: 'pointer',
                  color: filter === f.key ? 'var(--color-ink)' : 'var(--color-ink-faint)',
                  background: filter === f.key ? 'var(--color-signal-soft)' : 'transparent',
                }}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          {filter === 'all' && evtCount > 0 ? (
            <button
              type="button"
              className="qs-meta flex items-center gap-1 rounded px-2 py-0.5 transition-colors hover:opacity-70"
              style={{ color: 'var(--color-ink-faint)', cursor: 'pointer' }}
              onClick={() => setShowEvents((v) => !v)}
            >
              {evtCount} 条系统事件 {showEvents ? '▴' : '▾'}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="qs-meta text-center py-8" style={{ color: 'var(--color-ink-faint)' }}>
            {chatTarget.kind === 'group' ? '电商工作群 · 事件与协作播报汇集于此' : `与 ${agents.find((a) => a.id === chatTarget.to)?.name ?? chatTarget.to} 的私聊`}
          </div>
        ) : (
          <>
            {messages.map((m) => {
              if (m.kind === 'receipt') {
                // 回执属于非 evt 内容：「事件」筛选时隐藏
                if (filter === 'evt') return null;
                return <ReceiptLine key={m.id} m={m} />;
              }
              if (m.kind === 'evt') {
                // 「消息」筛选：只显示非 evt，事件行全部隐藏
                if (filter === 'msg') return null;
                // 「事件」筛选：直接展开显示全部 evt 行
                if (filter === 'evt') return renderEvt(m);
                // 「全部」筛选：折叠行已在固定区显示，此处仅展开态下原位显示 evt
                return showEvents ? renderEvt(m) : null;
              }
              // 署名消息 / 用户消息：非 evt，「事件」筛选时隐藏
              if (filter === 'evt') return null;
              const isMe = m.from === '你';
              const agent = agents.find((a) => a.name === m.from || a.id === m.from);
              const time = new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
              if (isMe) {
                // 右侧：用户消息 = 黑底白字气泡（无头像）
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[78%] rounded-[4px] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ background: 'var(--color-ink)', color: 'var(--color-inverse)', borderRadius: 4 }}>
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
                    <div className="rounded-[4px] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ background: 'var(--color-sunken)', color: 'var(--color-ink)', borderRadius: 4 }}>
                      {m.body}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
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
