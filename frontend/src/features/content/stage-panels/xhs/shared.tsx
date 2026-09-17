import { useState } from 'react';
import type { Deliverable } from '@workbench/shared';
import { stagesOf } from '@workbench/shared';
import { Badge, Btn, Card, Empty, Spinner } from '../../../../components/ui.tsx';
import { parseImages } from '../../../../lib/api.ts';

/* XHS 阶段面板共享件（图片网格 + 决策条 + 灰态占位）
   与电商内容交付完全隔离：这里的新增/修改不会影响电商面板。 */

export interface ParsedImg {
  id: string;
  name: string;
  kind: string;
  url: string;
  status: string;
  note?: string;
  error?: string;
  attempts?: number;
}

/** 与后端 MAX_IMAGE_ATTEMPTS 对齐 */
export const MAX_IMAGE_ATTEMPTS = 3;

/**
 * 按工作流声明的并行分组顺序重排图片（D-22）：
 * 后端交付物内的图片数组按「并行完成先后」push，顺序不稳定；这里按该阶段
 * groups 声明顺序（组序 + 组内 items 顺序）重排，未声明的条目保持原相对顺序（稳定排序）。
 * 图片 name 与 groups items 同名（后端 produceImages 用 itemId 作为图片名）。
 */
export function sortImagesByDeclaredOrder(imgs: ParsedImg[], workflowId: string | undefined, stage: string): ParsedImg[] {
  const node = stagesOf(workflowId).find((n) => n.id === stage);
  const declared: string[] = [];
  node?.parallelGroups?.forEach((g) => declared.push(...g.items));
  if (declared.length === 0) return imgs;
  const out = [...imgs];
  const rank = (name: string) => declared.indexOf(name);
  out.sort((a, b) => {
    const ai = rank(a.name);
    const bi = rank(b.name);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return out;
}

/** 取某阶段全部 image 交付物中的图片条目（同阶段可能多个交付物/多版本），按 groups 声明顺序重排 */
export function imagesForStage(dels: Deliverable[], stage: string, workflowId?: string): ParsedImg[] {
  const out: ParsedImg[] = [];
  for (const d of dels) {
    if (d.stage === stage && d.kind === 'image') {
      const list = parseImages(d);
      if (list) out.push(...list);
    }
  }
  return sortImagesByDeclaredOrder(out, workflowId, stage);
}

/**
 * 任务信息条的参考图来源（两条工作流统一，用户定案 2026-09-14）：
 * 有用户上传参考图 → 用上传图；没有 → 用 AI 生成的首图（第一张已生成/已采纳，failed 自动排除）。
 * aiImages：该工作流的首图阶段图片（电商传 main-image 的，小红书传 xhs-cover 的）。
 */
export function resolveInfoBarRef(
  referenceImage: string | undefined,
  aiImages: ParsedImg[],
): { src: string | null; isUploaded: boolean } {
  if (referenceImage) return { src: referenceImage, isUploaded: true };
  const first = aiImages.find((img) => (img.status === 'pending' || img.status === 'approved') && !!img.url) ?? null;
  return { src: first?.url ?? null, isUploaded: false };
}

/** 面板状态：none 未产出 / working 生成中 / pending 待确认 / done 已采纳 / rejected 已打回返工 */
export type PanelState = 'none' | 'working' | 'pending' | 'done' | 'rejected';

/** 所有 XHS 面板的公共入参 */
export interface PanelCommon {
  state: PanelState;
  busy: boolean;
  onDecide: (kind: 'copy' | 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, note?: string) => void;
}

/** 取某阶段最新 copy 交付物的原始 JSON（XHS 各阶段用不同结构，交给各自面板解析） */
export function copyJsonForStage<T>(dels: Deliverable[], stage: string): T | null {
  const hit = dels.filter((d) => d.stage === stage && d.kind === 'copy').at(-1);
  if (!hit) return null;
  try {
    return JSON.parse(hit.content) as T;
  } catch {
    return null;
  }
}

/** 未开始阶段的灰态占位（不显示「生成中」，避免阶段时序矛盾）；h-full 撑满列高，与并排的白卡对齐 */
export function PendingCard({ label, wait }: { label: string; wait?: string }) {
  return <MutedPlaceholder text={`${label} · ${wait ?? '待上一阶段确认后自动开始'}`} />;
}

/** 通用灰态虚线占位卡（小红书与电商未产出态共用同一视觉形式；h-full 撑满并排列高） */
export function MutedPlaceholder({ text }: { text: string }) {
  return (
    <div
      className="flex h-full min-h-[96px] items-center gap-2.5 rounded-[4px] border border-dashed px-3.5 py-3 text-[12px]"
      style={{ borderColor: 'var(--color-line-strong)', borderStyle: 'dashed', color: 'var(--color-ink-faint)' }}
    >
      <span aria-hidden="true">○</span>
      <span>{text}</span>
    </div>
  );
}

/** 阶段面板统一外壳（标题 + 状态角标）；h-full 保证并排两卡等高（内容矮的一侧撑满） */
export function PanelCard({
  title,
  badge,
  footer,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card title={title} extra={badge} className="h-full">
      {children}
      {footer ? (
        <div className="mt-3.5 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/** 状态角标（未产出 / 生成中 / 待确认 / 已采纳 / 已打回 / 自动放行） */
export function StateBadge({ state }: { state: 'none' | 'working' | 'pending' | 'done' | 'rejected' }) {
  if (state === 'pending') return <Badge tone="warn">待确认</Badge>;
  if (state === 'done') return <Badge tone="ok">已采纳</Badge>;
  if (state === 'rejected') return <Badge tone="no">已打回 · 返工中</Badge>;
  if (state === 'working') return <Badge tone="warn">生成中</Badge>;
  return <Badge>未产出</Badge>;
}

function ImgThumb({ img, onZoom }: { img: ParsedImg; onZoom: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const isPlaceholder = img.url.startsWith('data:image/svg');
  if (isPlaceholder || !img.url) {
    // 占位格不放「模拟占位」类文案（用户定案）：仅图名，状态由下方徽标与失败说明表达
    return (
      <div
        className="relative flex aspect-square flex-col items-center justify-center gap-1 border px-1"
        style={{ borderColor: 'var(--color-line)', borderStyle: 'dashed', background: 'var(--color-canvas)' }}
      >
        <span className="qs-meta max-w-full truncate text-[10px]">{img.name}</span>
      </div>
    );
  }
  return (
    <div className="relative aspect-square overflow-hidden border" style={{ borderColor: 'var(--color-line)' }}>
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--color-canvas)' }}>
          <Spinner label="图片加载中…" />
        </div>
      ) : null}
      <img
        src={img.url}
        alt={img.name}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`h-full w-full cursor-zoom-in object-cover ${loaded ? '' : 'opacity-0'}`}
        onClick={onZoom}
      />
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[11px]" style={{ background: 'color-mix(in srgb, var(--color-ink) 75%, transparent)', color: 'var(--color-inverse)' }}>
        {img.name}
      </div>
    </div>
  );
}

/** 图片网格：支持逐张采纳/打回/重试/跳过（与电商一致的失败与重试上限处理） */
export function ImageGrid({
  imgs,
  canDecide,
  busy,
  retrying,
  onDecide,
  onRetry,
  onZoom,
}: {
  imgs: ParsedImg[];
  canDecide: boolean;
  busy: boolean;
  retrying: string | null;
  onDecide: (kind: 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, note?: string) => void;
  onRetry: (imageId: string) => void;
  onZoom: (img: ParsedImg) => void;
}) {
  if (imgs.length === 0) return <Empty text="该板块图片尚未产出" />;
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');

  return (
    <div className="grid grid-cols-3 gap-3">
      {imgs.map((img) => {
        const failed = img.status === 'failed';
        const decided = img.status === 'approved' || img.status === 'rejected' || img.status === 'skipped';
        return (
          <div key={img.id} className="space-y-1.5">
            <ImgThumb img={img} onZoom={() => onZoom(img)} />
            <div className="flex items-center gap-1.5">
              {img.status === 'approved' ? <Badge tone="ok">已采纳</Badge> : null}
              {img.status === 'rejected' ? <Badge tone="no">已打回 · 返工中</Badge> : null}
              {img.status === 'skipped' ? <Badge>已跳过</Badge> : null}
              {img.status === 'pending' ? <Badge>待确认</Badge> : null}
              {failed ? <Badge tone="no">生成失败</Badge> : null}
            </div>
            {failed ? (
              <div className="qs-meta text-[10px]" style={{ color: 'var(--color-danger)' }}>
                已尝试 {img.attempts ?? MAX_IMAGE_ATTEMPTS}/{MAX_IMAGE_ATTEMPTS} 次
              </div>
            ) : null}
            {canDecide && (img.status === 'pending' || failed) ? (
              <div className="space-y-1.5">
                {rejecting === img.id ? (
                  <>
                    <input
                      className="qs-input"
                      autoFocus
                      placeholder="打回原因（将发给设计师重新输出）…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="flex gap-1.5">
                      <Btn size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                        取消
                      </Btn>
                      <Btn
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => {
                          onDecide('image', 'reject', img.id, note);
                          setRejecting(null);
                          setNote('');
                        }}
                      >
                        确认打回
                      </Btn>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {!failed ? (
                      <Btn size="sm" variant="primary" disabled={busy} onClick={() => onDecide('image', 'approve', img.id)}>
                        采纳
                      </Btn>
                    ) : null}
                    {failed ? (
                      <>
                        {(img.attempts ?? 0) < MAX_IMAGE_ATTEMPTS ? (
                          <Btn size="sm" variant="signal" disabled={busy || retrying !== null} onClick={() => onRetry(img.id)}>
                            {retrying === img.id ? '重试中…' : '重试'}
                          </Btn>
                        ) : (
                          <span className="qs-meta self-center text-[10px]" title="该图已连续 3 次生成失败，达到重试上限">
                            已达上限
                          </span>
                        )}
                        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => onDecide('image', 'skip', img.id)}>
                          跳过
                        </Btn>
                      </>
                    ) : null}
                    {!decided ? (
                      <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(img.id)}>
                        打回重做
                      </Btn>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
