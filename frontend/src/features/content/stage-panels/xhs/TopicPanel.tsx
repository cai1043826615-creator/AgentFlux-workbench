import { useState } from 'react';
import type { TopicOption } from '@workbench/shared';
import { Btn } from '../../../../components/ui.tsx';
import { PanelCard, StateBadge, type PanelCommon } from './shared.tsx';

/* 选题策划：3 个方向单选 + 确认 / 重出选题 */

export function TopicPanel({ topics, state, busy, onDecide }: PanelCommon & { topics: TopicOption[] }) {
  const [sel, setSel] = useState(0);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // 仅「待确认」态可操作：已推进 / 已交付的任务禁止再改选题（避免误以为能改历史）
  const canInteract = state === 'pending';
  // 未产出（阶段还没跑到）→ 不给按钮，避免「点了没反应」
  if (topics.length === 0) {
    return (
      <PanelCard title="选题方向" badge={<StateBadge state={state} />}>
        {state === 'working' ? <div className="qs-meta">文案 Agent 正在生成选题方向…</div> : <div className="qs-meta">选题尚未产出</div>}
      </PanelCard>
    );
  }

  const cur = topics[Math.min(sel, topics.length - 1)];

  return (
    <PanelCard
      title="选题方向"
      badge={<StateBadge state={state} />}
      footer={
        state === 'pending' ? (
          <div className="space-y-2">
            <div className="qs-meta">确认后进入「笔记撰写」</div>
            {rejecting ? (
              <>
                <input
                  className="qs-input"
                  autoFocus
                  placeholder="打回重做的要求（将发给文案 Agent）…"
                  value={note}
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
                      onDecide('copy', 'reject', undefined, note);
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
      {canInteract ? (
        <p className="qs-meta mb-2.5">文案 Agent 生成 {topics.length} 个方向，点击选择后确认：</p>
      ) : (
        <p className="qs-meta mb-2.5">已采纳方向（本阶段已确认，不可再修改）：</p>
      )}
      <div className="space-y-2">
        {topics.map((t, i) => {
          const picked = i === sel;
          return (
            <label
              key={`${t.angle}-${i}`}
              className={`flex items-start gap-2 rounded-[4px] border px-3 py-2.5 ${canInteract ? 'cursor-pointer' : ''}`}
              style={{
                borderColor: picked ? 'var(--color-signal)' : 'var(--color-line-strong)',
                background: picked ? 'var(--color-signal-soft)' : 'var(--color-surface)',
                opacity: canInteract || picked ? 1 : 0.6,
              }}
            >
              <input
                type="radio"
                name="xhs-topic"
                className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-signal)]"
                checked={picked}
                disabled={!canInteract}
                onChange={() => canInteract && setSel(i)}
              />
              <span className="text-[13px] leading-snug">
                <span className="block font-medium">
                  {String.fromCharCode(65 + i)} · {t.angle}
                </span>
                <span className="qs-meta block" style={{ color: 'var(--color-ink-faint)' }}>
                  {t.desc}
                </span>
                {t.anchors.length > 0 ? (
                  <span className="qs-meta mt-1 block" style={{ color: 'var(--color-signal)' }}>
                    {t.anchors.join(' ')}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {cur && state !== 'pending' ? (
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
          <div className="qs-meta mb-1">写笔记时采用的方向</div>
          <div className="text-[13px] font-medium">
            {String.fromCharCode(65 + Math.min(sel, topics.length - 1))} · {cur.angle}
          </div>
          <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-faint)' }}>
            {cur.desc}
          </div>
        </div>
      ) : null}
    </PanelCard>
  );
}
