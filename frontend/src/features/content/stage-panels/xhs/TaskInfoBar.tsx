import { useState } from 'react';

/** 参考图缩略：加载失败显示灰底「图片失效」，不破版；key=src 由父组件保证换图复位 */
function RefThumb({ src, name, onZoom }: { src: string; name: string; onZoom?: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="qs-meta flex h-14 w-14 shrink-0 items-center justify-center border" style={{ borderColor: 'var(--color-line-strong)' }}>
        图片失效
      </span>
    );
  }
  return (
    <button
      type="button"
      className="h-14 w-14 shrink-0 overflow-hidden border transition-colors hover:border-[var(--color-signal)]"
      style={{ borderColor: 'var(--color-line-strong)', cursor: onZoom ? 'pointer' : 'default' }}
      title={onZoom ? '点击放大参考图' : undefined}
      aria-label={onZoom ? '点击放大参考图' : undefined}
      onClick={onZoom}
    >
      <img src={src} alt={name} onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </button>
  );
}

/**
 * 任务信息条（内容交付顶部；小红书与电商共用，形式统一）。
 * 内容保持原电商信息条三要素：参考图缩略（可放大）+ 目标平台 + 参考图说明。
 * （2026-09-14 用户定案：不加工作流/阶段/负责人/创建时间等额外信息。）
 */
export function TaskInfoBar({
  platforms,
  refThumbSrc,
  refThumbName,
  refThumbNote,
  onZoomRef,
}: {
  /** 目标平台展示文本（调用方解析好多选/单数兼容） */
  platforms: string;
  /** 参考图缩略地址（无则显示「暂无参考图」空态格） */
  refThumbSrc?: string | null;
  /** 缩略图角标名（如「参考图」「AI 生成主图」） */
  refThumbName?: string;
  /** 参考图说明行（如「AI 产出将基于参考图生成」） */
  refThumbNote?: string;
  onZoomRef?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
      <div className="flex shrink-0 flex-col items-center gap-1">
        {refThumbSrc ? (
          <RefThumb src={refThumbSrc} name={refThumbName ?? '参考图'} onZoom={onZoomRef} />
        ) : (
          <span className="qs-meta flex h-14 w-14 shrink-0 items-center justify-center border" style={{ borderColor: 'var(--color-line-strong)' }}>
            暂无参考图
          </span>
        )}
        {refThumbName ? <span className="qs-meta text-[10px] leading-none">{refThumbName}</span> : null}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-medium">目标平台 · {platforms}</div>
        <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
          {refThumbNote ?? (refThumbSrc ? 'AI 产出将基于参考图生成' : '暂无参考图 · 产出由 Agent 生成')}
        </div>
      </div>
    </div>
  );
}
