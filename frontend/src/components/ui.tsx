import { useEffect, type ReactNode } from 'react';

/* ===== Quiet Signal 风格轻量 UI 基座（design.md D6.1：大结构直角、4px 小控件、无阴影、衬线标题） ===== */

export function Btn({ children, onClick, variant = 'default', size, disabled, title }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm'; disabled?: boolean; title?: string }) {
  const cls = ['qs-btn', variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : '', variant === 'danger' ? 'danger' : '', size === 'sm' ? 'sm' : ''].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export type BadgeTone = 'default' | 'ok' | 'no' | 'warn' | 'signal';
export function Badge({ tone = 'default', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`qs-badge ${tone}`}>{children}</span>;
}

export function Card({ children, className = '', title, extra }: { children: ReactNode; className?: string; title?: string; extra?: ReactNode }) {
  return (
    <section className={`qs-card ${className}`}>
      {title ? (
        <header className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'var(--color-line)' }}>
          <h3 className="font-display text-[15px] font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            {title}
          </h3>
          {extra}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Modal({ open, title, onClose, children, width = 520 }: { open: boolean; title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[10vh]" onClick={onClose}>
      <div className="qs-card w-full" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: 'var(--color-line)' }}>
          <h3 className="font-display text-base font-semibold">{title}</h3>
          <Btn variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Btn>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="qs-label">{label}</span>
      {children}
    </label>
  );
}

export function SectionTitle({ meta, children }: { meta?: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      {meta ? <div className="qs-meta mb-0.5">{meta}</div> : null}
      <h3 className="font-display text-lg font-semibold leading-tight">{children}</h3>
    </div>
  );
}

/** 6 阶段流程条（requirement → deliver） */
export function StageFlow({ stages, current, done }: { stages: { id: string; label: string }[]; current: string; done: boolean }) {
  const curIdx = stages.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-0 select-none">
      {stages.map((s, i) => {
        const state = done || i < curIdx ? 'done' : i === curIdx ? 'current' : 'todo';
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 min-w-[52px]">
              <div
                className="h-[22px] w-[22px] rounded-full border flex items-center justify-center text-[11px]"
                style={{
                  borderColor: state === 'todo' ? 'var(--color-line-strong)' : 'var(--color-signal)',
                  background: state === 'done' ? 'var(--color-signal)' : 'transparent',
                  color: state === 'done' ? '#fff' : state === 'current' ? 'var(--color-signal)' : 'var(--color-ink-faint)',
                }}
              >
                {state === 'done' ? '✓' : i + 1}
              </div>
              <span className="qs-meta text-[10px] text-center leading-tight" style={{ color: state === 'todo' ? 'var(--color-ink-faint)' : 'var(--color-ink)' }}>
                {s.label}
              </span>
            </div>
            {i < stages.length - 1 ? (
              <div className="h-px flex-1 mx-1 mb-4" style={{ background: i < curIdx ? 'var(--color-signal)' : 'var(--color-line-strong)' }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* QS 灰紫系头像色板（SPEC §4.1：主体黑灰 + 紫色焦点，克制） */
const AVATAR_COLORS = ['#7C3AED', '#0A0A0A', '#52525B', '#6D28D9', '#A1A1AA', '#8B5CF6'];
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  return (
    <div
      className="rounded-full flex items-center justify-center text-white shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.42, fontFamily: 'var(--font-display)' }}
      title={name}
    >
      {name.slice(0, 1)}
    </div>
  );
}

export function Spinner({ label = '处理中…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--color-ink-soft)' }}>
      <span className="inline-block h-3 w-3 rounded-full border-2 border-transparent border-t-current animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="py-10 text-center qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
      {text}
    </div>
  );
}

/** 通用弹层按钮组（底部右对齐） */
export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 mt-4">{children}</div>;
}
