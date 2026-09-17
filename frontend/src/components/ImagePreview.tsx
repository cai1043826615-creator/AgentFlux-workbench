/**
 * 【新增组件前置声明】
 * 1. 现有组件为何不行：查过 §3 组件注册表——Modal 是通用弹窗（含头部/底部/内容区），
 *    不提供"深色遮罩 + 图片 contain + 白描边 + 右上关闭"这一图片放大专门形态；
 *    ImagePreview 的职责单一且视觉固定（遮罩色/描边/文字透明度都是特定值）。
 * 2. 复用范围：2 处（ContentDeliveryView 主图/详情图预览、XhsDeliveryView 小红书图预览），
 *    且后续工作流（直播上架/跨境选品）的图片交付页会继续复用。
 * 3. 是否应提升为通用组件：是。它是「媒体类」通用组件，已登记入规范 §3.2。
 *
 * 抽取来源：ContentDeliveryView.tsx + XhsDeliveryView.tsx 两处重复实现（原各 13 行）。
 * 唯一差异：状态文案（内容交付页显示「已采纳/已打回/…」，小红书页不显示）→ statusLabel 可选。
 */
import type { ReactNode } from 'react';

export interface ImagePreviewItem {
  url: string;
  name: string;
  /** 可选的状态文案（如「已采纳」）。不传则只显示文件名。 */
  statusLabel?: string;
}

export function ImagePreview({
  preview,
  onClose,
  className = '',
}: {
  /** 为 null 时不渲染 */
  preview: ImagePreviewItem | null;
  onClose: () => void;
  className?: string;
}) {
  if (!preview) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-6 ${className}`}
      /* ui-rules-ignore 大图预览遮罩：规范允许的遮罩类语义色（AGENTS.md U5 例外） */
      style={{ background: 'rgba(10,10,10,0.72)' }}
      onClick={onClose}
    >
      <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
        <img
          src={preview.url}
          alt={preview.name}
          className="max-h-[76vh] max-w-full border object-contain"
          /* ui-rules-ignore 遮罩上元素描边：半透明白，属遮罩内配色 */
          style={{ borderColor: 'rgba(255,255,255,0.25)' }}
        />
        <button type="button" className="qs-btn sm absolute -top-10 right-0" onClick={onClose} aria-label="关闭">
          ✕
        </button>
        {/* ui-rules-ignore 遮罩上元信息文字：半透明白，属遮罩内配色 */}
        <div className="qs-meta mt-2 text-center" style={{ color: 'rgba(255,255,255,0.72)' }}>
          {preview.name}
          {preview.statusLabel ? <> · {preview.statusLabel}</> : null}
        </div>
      </div>
    </div>
  );
}

/** 交付物状态的通用文案映射（原 ContentDeliveryView 内联三元，抽出来共用） */
export function deliverableStatusLabel(status?: string): string {
  switch (status) {
    case 'approved':
      return '已采纳';
    case 'rejected':
      return '已打回 · 返工中';
    case 'skipped':
      return '已跳过';
    case 'ref':
      return '参考图';
    default:
      return '待确认';
  }
}
