import { useEffect, useRef, useState } from 'react';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Avatar } from '../../components/ui.tsx';

/** 聊天侧栏：工作群 / 私聊（含 Agent 事件播报） */
export function ChatPanel() {
  const { agents, messages, chatTarget, selectChat, sendChat, connected } = useWorkbench();
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
      {/* 会话切换：工作群 + 各 Agent 私聊 */}
      <div className="flex items-center gap-1 px-3 py-2 border-b overflow-x-auto" style={{ borderColor: 'var(--color-line)' }}>
        <button
          type="button"
          className={`qs-btn sm shrink-0 ${chatTarget.kind === 'group' ? 'primary' : ''}`}
          onClick={() => selectChat({ kind: 'group', to: '全体' })}
        >
          工作群
        </button>
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`qs-btn sm shrink-0 ${chatTarget.kind === 'private' && chatTarget.to === a.id ? 'primary' : ''}`}
            onClick={() => selectChat({ kind: 'private', to: a.id })}
          >
            @{a.name}
          </button>
        ))}
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 ? (
          <div className="qs-meta text-center py-8" style={{ color: 'var(--color-ink-faint)' }}>
            {chatTarget.kind === 'group' ? '工作群 · 事件与协作播报汇集于此' : `与 ${agents.find((a) => a.id === chatTarget.to)?.name ?? chatTarget.to} 的私聊`}
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === 'evt') {
              return (
                <div key={m.id} className="qs-meta px-2 py-1 text-center" style={{ color: 'var(--color-ink-faint)' }}>
                  ── {m.body} ──
                </div>
              );
            }
            const isMe = m.from === '你';
            const agent = agents.find((a) => a.name === m.from || a.id === m.from);
            return (
              <div key={m.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                {!isMe && <Avatar name={m.from} size={26} />}
                <div className={`max-w-[80%] rounded px-3 py-2 text-[13px] leading-relaxed ${isMe ? '' : 'bg-black/5'}`} style={{ background: isMe ? 'var(--color-ink)' : 'rgba(0,0,0,0.045)', color: isMe ? '#fff' : 'var(--color-ink)', borderRadius: 4 }}>
                  {!isMe && (
                    <div className="qs-meta mb-0.5" style={{ color: agent?.onlineStatus === 'online' ? 'var(--color-signal)' : 'var(--color-ink-faint)' }}>
                      {m.from} · {new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
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
