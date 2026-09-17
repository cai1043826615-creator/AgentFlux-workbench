import { useEffect, useState, type ReactNode } from 'react';

/* ===== Quiet Signal 风格轻量 UI 基座（design.md D6.1：大结构直角、4px 小控件、无阴影、衬线标题） ===== */

export function Btn({ children, onClick, variant = 'default', size, disabled, title, loading = false, className = '' }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'ghost' | 'danger' | 'signal'; size?: 'sm'; disabled?: boolean; title?: string; loading?: boolean; className?: string }) {
  const cls = ['qs-btn', variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : variant === 'signal' ? 'signal' : '', variant === 'danger' ? 'danger' : '', size === 'sm' ? 'sm' : '', loading ? 'is-loading' : '', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled || loading} title={title} aria-busy={loading || undefined}>
      {loading ? (
        <>
          <span className="qs-btn-spinner" aria-hidden="true" />
          {children}
        </>
      ) : (
        children
      )}
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

/**
 * 表单字段。`required` 为真时在标签后渲染红色星号（必填标识）。
 * 用参数而非在标签文本里手写「*」，保证全站必填标识样式一致。
 */
export function Field({ label, children, required = false }: { label: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block mb-3">
      <span className="qs-label">
        {label}
        {required ? (
          <span aria-hidden="true" style={{ color: 'var(--color-danger)', marginLeft: 3 }} title="必填">
            *
          </span>
        ) : null}
      </span>
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
                  color: state === 'done' ? 'var(--color-inverse)' : state === 'current' ? 'var(--color-signal)' : 'var(--color-ink-faint)',
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

/* QS 灰紫系头像色板（SPEC §4.1：主体黑灰 + 紫色焦点，克制）
   注意：本数组是「颜色定义源」（性质同 index.css 的 @theme），故用 var() 引用而非裸 hex。
   校验脚本 check-ui-rules.mjs 对 index.css 放行 hex；本文件已是定义源，改用令牌后同样合规。 */
const AVATAR_COLORS = [
  'var(--color-signal)',
  'var(--color-ink)',
  'var(--color-ink-soft)',
  'var(--color-signal-strong)',
  'var(--color-ink-faint)',
  'var(--color-signal)',
];

/**
 * Agent 头像映射（意见1 前端部分）：
 * id 含 'copy' 或名含「美美」→ /avatars/meimei.png
 * id 含 'design' 或名含「平平」→ /avatars/pingping.png
 * id 含 'supervisor' 或名含「波波」→ /avatars/bobo.png
 * 其余保持字母头像兜底；图片加载失败（如资源未就绪）也自动回退字母头像。
 */
function avatarUrl(id: string | undefined, name: string): string | null {
  const hay = `${id ?? ''} ${name}`;
  if ((id ?? '').includes('copy') || hay.includes('美美')) return '/avatars/meimei.png';
  if ((id ?? '').includes('design') || hay.includes('平平')) return '/avatars/pingping.png';
  if ((id ?? '').includes('supervisor') || hay.includes('波波')) return '/avatars/bobo.png';
  // P2·新1：知识库小助理「依依」（圆框眼镜 + 知性气质，与三人同款 3D 渲染风格）
  if ((id ?? '').includes('assistant') || hay.includes('依依')) return '/avatars/yiyi.png';
  return null;
}

/**
 * 头像。
 * `title`：悬停提示文案，默认取 name；需要「名字（岗位）」这类更完整提示时由调用方传入。
 * 注意：提示必须设在 Avatar 自身的元素上——在外层再包一层设 title 不会生效（浏览器只取最近的那个）。
 */
export function Avatar({ name, size = 28, id, title }: { name: string; size?: number; id?: string; title?: string }) {
  const url = avatarUrl(id, name);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [url]);
  const idx = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const color = AVATAR_COLORS[idx % AVATAR_COLORS.length];
  const tip = title ?? name;
  const baseCls = 'flex items-center justify-center text-white shrink-0 overflow-hidden';
  if (url && !imgFailed) {
    return (
      <div className={baseCls} style={{ width: size, height: size, borderRadius: '50%' }} title={tip}>
        <img
          src={url}
          alt={name}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setImgFailed(true)}
          style={{ width: size, height: size, objectFit: 'cover', display: 'block', borderRadius: '50%' }}
        />
      </div>
    );
  }
  return (
    <div
      className={baseCls}
      style={{ width: size, height: size, borderRadius: '50%', background: color, fontSize: size * 0.42, fontFamily: 'var(--font-display)' }}
      title={tip}
    >
      {name.slice(0, 1)}
    </div>
  );
}

/* 几何小图标（无 emoji，stroke 风格；参考图2 左栏菜单图标） */
const GLYPH_PATHS: Record<string, ReactNode> = {
  flow: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" />
      <rect x="9" y="9" width="4.5" height="4.5" />
      <path d="M7 4.75h2M7 11.25h2M4.75 7v2M11.25 7v2" />
    </>
  ),
  pulse: <path d="M1.5 12h3l2.2-7 2.8 10 2.2-6.5 1.2 3.5h3.1" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.2v2.2M8 12.6v2.2M1.2 8h2.2M12.6 8h2.2M3.6 3.6l1.6 1.6M10.8 10.8l1.6 1.6M12.4 3.6l-1.6 1.6M5.2 10.8l-1.6 1.6" />
    </>
  ),
  box: (
    <>
      <path d="M3 5.2 8 2.6l5 2.6v5.6L8 13.4 3 10.8z" />
      <path d="M3 5.2l5 2.6 5-2.6M8 7.8v5.6" />
    </>
  ),
  /* 知识星图：节点网络（与 flow 的四宫格区分） */
  graph: (
    <>
      <circle cx="4" cy="4.4" r="1.9" />
      <circle cx="12.2" cy="6.4" r="1.9" />
      <circle cx="6.4" cy="12" r="1.9" />
      <path d="M5.7 5.1 10.5 5.8M5.1 6.2 5.9 10.2M10.9 7.9 7.9 10.7" />
    </>
  ),
  /* 每日热点：趋势折线 + 箭头（与 pulse 的心跳折线区分） */
  trend: (
    <>
      <path d="M1.8 12 5.8 7.6l2.5 2.3 4.1-5.1" />
      <path d="M9.4 4.8h3v3" />
    </>
  ),
  chevron: <path d="M10.5 3.5 5 8l5.5 4.5" />,
};

export type GlyphName = 'flow' | 'pulse' | 'gear' | 'box' | 'chevron' | 'graph' | 'trend';

export function Glyph({ name, size = 14, className = '' }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {GLYPH_PATHS[name]}
    </svg>
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

/**
 * 空状态占位（knowledge-ux A5）：
 * - 既有用法 `Empty text="..."` 行为与升级前完全一致（不产生额外节点）。
 * - 可选 `hint`（下一步指引）与 `emptyKey`（场景标识）：text 渲染在 `data-qs-empty="<key>"` 节点上，
 *   hint 渲染在 `data-qs-empty-next="<key>"` 节点上，供自动化断言（可见即可断言）。
 */
export function Empty({ text = '暂无数据', hint, emptyKey }: { text?: string; hint?: string; emptyKey?: string }) {
  return (
    <div className="py-10 text-center qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
      {emptyKey ? (
        <>
          <div data-qs-empty={emptyKey}>{text}</div>
          {hint ? (
            <div className="mt-1 leading-relaxed" data-qs-empty-next={emptyKey}>
              {hint}
            </div>
          ) : null}
        </>
      ) : (
        text
      )}
    </div>
  );
}

/** 通用弹层按钮组（底部右对齐） */
export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 mt-4">{children}</div>;
}

/* ===== 下划线式标签页 Tabs（QS：焦点信号为 2px 紫下划线；支持可选角标计数） ===== */

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  /** 可选角标计数，如 (3) */
  count?: number;
}

export function Tabs<K extends string>({ items, activeKey, onChange, className = '' }: { items: TabItem<K>[]; activeKey: K; onChange: (key: K) => void; className?: string }) {
  return (
    <div className={`flex gap-1 border-b ${className}`} style={{ borderColor: 'var(--color-line)' }}>
      {items.map((it) => {
        const active = activeKey === it.key;
        return (
          <button
            key={it.key}
            type="button"
            className={`-mb-px cursor-pointer px-3 py-2 text-[13px] transition-colors ${active ? 'font-semibold' : 'opacity-55 hover:opacity-100'}`}
            style={{
              borderBottom: active ? '2px solid var(--color-signal)' : '2px solid transparent',
              color: active ? 'var(--color-ink)' : 'var(--color-ink-soft)',
            }}
            onClick={() => onChange(it.key)}
          >
            {it.label}
            {it.count !== undefined ? <span className="qs-meta tabular ml-1">({it.count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}
