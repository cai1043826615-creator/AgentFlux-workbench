import { useState } from 'react';
import type { NotePackage } from '@workbench/shared';
import { Badge, Btn } from '../../../../components/ui.tsx';
import { PanelCard, StateBadge, type PanelCommon } from './shared.tsx';

/* 发布包装：最终发布包（标题 + 正文 + 标签 + 图片顺序清单）+ 复制 / 确认交付 */

export function PackagePanel({ pack, state, busy, onDecide }: PanelCommon & { pack: NotePackage | null }) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const text = pack ? [pack.title, '', pack.body, '', pack.tags.join(' ')].join('\n') : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <PanelCard
      title="发布包"
      badge={<StateBadge state={state} />}
      footer={
        state === 'pending' ? (
          <div className="space-y-2">
            <div className="qs-meta">最终确认点 · 确认后归档交付</div>
            {rejecting ? (
              <>
                <input
                  className="qs-input"
                  autoFocus
                  placeholder="打回原因（将发给文案 Agent 重新包装）…"
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
                <Btn size="sm" variant="ghost" disabled={busy || !pack} onClick={() => void copy()}>
                  {copied ? '已复制 ✓' : '复制发布包'}
                </Btn>
                <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(true)}>
                  打回
                </Btn>
                <Btn size="sm" variant="primary" disabled={busy} onClick={() => onDecide('copy', 'approve')}>
                  确认交付 ✓
                </Btn>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {pack ? (
        <>
          <div
            className="border p-3 text-[13px]"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}
          >
            <div className="mb-1.5 font-semibold">{pack.title}</div>
            <div className="whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
              {pack.body}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pack.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </div>
          <div className="qs-meta mt-2.5">
            发布图片顺序 ·{' '}
            {pack.imageOrder.length > 0 ? (
              pack.imageOrder.map((id, i) => (
                <span key={id}>
                  {i + 1}. {id}
                  {i < pack.imageOrder.length - 1 ? ' · ' : ''}
                </span>
              ))
            ) : (
              <span>暂无图片</span>
            )}
          </div>
        </>
      ) : (
        <div className="qs-meta">发布包尚未产出</div>
      )}
    </PanelCard>
  );
}
