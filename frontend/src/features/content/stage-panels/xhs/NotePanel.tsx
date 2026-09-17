import { useState } from 'react';
import type { XhsNote } from '@workbench/shared';
import { Badge, Btn } from '../../../../components/ui.tsx';
import { PanelCard, StateBadge, type PanelCommon } from './shared.tsx';

/* 笔记撰写：标题（≤20 字含 emoji）+ 正文 + 话题标签 + 采纳/打回 */

export function NotePanel({ note, state, busy, onDecide }: PanelCommon & { note: XhsNote | null }) {
  const [note_, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  return (
    <PanelCard
      title="笔记文案"
      badge={<StateBadge state={state} />}
      footer={
        state === 'pending' ? (
          <div className="space-y-2">
            <div className="qs-meta">打回将重置本阶段产出 · 采纳后进入「首图设计」</div>
            {rejecting ? (
              <>
                <input
                  className="qs-input"
                  autoFocus
                  placeholder="打回原因（将发给文案 Agent 重新输出）…"
                  value={note_}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-1.5">
                  <Btn size="sm" variant="ghost" onClick={() => setRejecting(false)}>
                    取消
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      onDecide('copy', 'reject', undefined, note_);
                      setRejecting(false);
                      setNote('');
                    }}
                  >
                    确认打回
                  </Btn>
                </div>
              </>
            ) : (
              <div className="flex gap-1.5">
                <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
                  打回重做
                </Btn>
                <Btn size="sm" variant="primary" disabled={busy} onClick={() => onDecide('copy', 'approve')}>
                  采纳
                </Btn>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {note ? (
        <>
          <div className="mb-2 text-[15px] font-semibold">{note.title}</div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
            {note.body}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {note.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        </>
      ) : (
        <div className="qs-meta">笔记尚未产出</div>
      )}
    </PanelCard>
  );
}
