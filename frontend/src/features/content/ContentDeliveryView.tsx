import { useEffect, useMemo, useState } from 'react';
import type { CopyPackage, Deliverable, DeliverableDiff, DeliverableVersion, ProvenanceResult, Task } from '@workbench/shared';
import { BOARD_COLUMNS, WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { Badge, Btn, Card, Empty, SectionTitle, Spinner, Tabs } from '../../components/ui.tsx';
import { ImagePreview, deliverableStatusLabel } from '../../components/ImagePreview.tsx';
import { fmtTime } from '../../lib/format.ts';
import { MutedPlaceholder, resolveInfoBarRef } from './stage-panels/xhs/shared.tsx';
import { TaskInfoBar } from './stage-panels/xhs/TaskInfoBar.tsx';
import { api, parseCopy, parseImages } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';

/* ===== 内容交付视图（组7 · 任务 7.1-7.6：左右等宽分栏 + 逐张审批 + 终审回退） ===== */

const STAGE_ORDER = ['requirement', 'copy', 'main-image', 'detail-image', 'review', 'deliver'];
const ROLLBACK_TARGETS = ['copy', 'main-image', 'detail-image'];

const COLUMN_LABELS: Record<string, string> = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.key, c.label]));
const COLUMN_TONES: Record<string, 'default' | 'ok' | 'no' | 'warn' | 'signal'> = {
  planned: 'default',
  progress: 'warn',
  awaiting: 'signal',
  done: 'ok',
};

function stageIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? -1 : i;
}

function stageTone(stage: string): 'default' | 'ok' | 'no' | 'warn' | 'signal' {
  if (stage === 'copy' || stage === 'main-image') return 'signal';
  if (stage === 'review') return 'warn';
  if (stage === 'deliver') return 'ok';
  return 'default';
}

/** 板块状态：none 未产出 / working 生成中 / pending 待确认 / done 已采纳 / rejected 已打回返工 */
type BlockState = 'none' | 'working' | 'pending' | 'done' | 'rejected';

function copyBlockState(task: Task | null, copyDel: Deliverable | undefined): BlockState {
  if (!task) return 'none';
  if (copyDel?.status === 'approved') return 'done';
  if (copyDel?.status === 'rejected') return 'rejected';
  if (task.stage === 'copy') {
    if (task.column === 'awaiting') return 'pending';
    if (task.column === 'progress') return 'working';
    return 'none';
  }
  if (stageIndex(task.stage) > stageIndex('copy')) return 'done'; // 确认点1 已过 → 文案必已采纳
  return 'none';
}

function imgBlockState(task: Task | null): BlockState {
  if (!task) return 'none';
  if (task.stage === 'main-image' || task.stage === 'detail-image') {
    if (task.column === 'awaiting') return 'pending';
    if (task.column === 'progress') return 'working';
    return 'none';
  }
  if (stageIndex(task.stage) > stageIndex('detail-image')) return 'done'; // 详情图确认已过 → 主图与详情图必已采纳
  return 'none';
}

interface ParsedImg {
  id: string;
  name: string;
  kind: string;
  url: string;
  status: string;
  note?: string;
  error?: string;
  attempts?: number;
}

/** 生图失败最大尝试次数（与后端 MAX_IMAGE_ATTEMPTS 对齐；界面据此决定是否还可重试） */
const MAX_IMAGE_ATTEMPTS = 3;

/** 合并某阶段全部 image 交付物中的图片条目（同一阶段可能多个交付物/多版本） */
function imagesForStage(dels: Deliverable[], stage: string): ParsedImg[] {
  const out: ParsedImg[] = [];
  for (const d of dels) {
    if (d.stage === stage && d.kind === 'image') {
      const list = parseImages(d);
      if (list) out.push(...list);
    }
  }
  return out;
}

/** 缩略图：dataURL 加载完成前显示 Spinner；hover 出现「放大」按钮（几何符号 + 文字）
 *  data:image/svg 开头 = mock 模式的「模拟占位」图（非成品）→ 灰底虚线框 + 「模拟占位」，不渲染放大 */
function Thumb({ src, name, onZoom }: { src: string; name: string; onZoom?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  if (src.startsWith('data:image/svg')) {
    return (
      <div
        className="relative aspect-square overflow-hidden border"
        style={{ borderColor: 'var(--color-line)', borderStyle: 'dashed', background: 'var(--color-canvas)' }}
      >
        {/* 占位格不放「模拟占位」类文案（用户定案）：仅图名 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-1">
          <span className="qs-meta max-w-full truncate text-[10px]">{name}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="group relative aspect-square overflow-hidden border" style={{ borderColor: 'var(--color-line)' }}>
      {!loaded ? (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--color-canvas)' }}>
          <Spinner label="图片加载中" />
        </div>
      ) : null}
      <img
        src={src}
        alt={name}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className={`h-full w-full object-cover ${loaded ? '' : 'opacity-0'}`}
      />
      {loaded && onZoom ? (
        <button
          type="button"
          onClick={onZoom}
          className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 py-1 text-[11px] text-white opacity-0 transition-opacity duration-160 group-hover:opacity-100 focus-visible:opacity-100"
          /* ui-rules-ignore 悬浮操作条遮罩：规范允许的遮罩类语义色（AGENTS.md 二.5 例外） */
          style={{ background: 'rgba(0,0,0,0.55)', cursor: 'pointer' }}
        >
          <span aria-hidden="true" className="text-[12px] leading-none">⊕</span>
          放大
        </button>
      ) : null}
    </div>
  );
}

export function ContentDeliveryView({ taskId }: { taskId: number }) {
  const { tasks, deliverablesByTask, openTask, decide, retryImage, review, pushToast } = useWorkbench();
  const [imageTab, setImageTab] = useState<'main' | 'detail'>('main');
  const [rejectingCopy, setRejectingCopy] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const [rejectingImg, setRejectingImg] = useState<string | null>(null);
  const [imgNotes, setImgNotes] = useState<Record<string, string>>({});
  const [rollbackStage, setRollbackStage] = useState('copy');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  /** 大图预览（缩略图 hover 放大 / 参考图点击） */
  const [preview, setPreview] = useState<{ url: string; name: string; status: string } | null>(null);
  /** 产出溯源结果（B1）：未关联资料时 hasRefs=false 触发「参数由模型生成，请人工核对」警示 */
  const [provenance, setProvenance] = useState<ProvenanceResult | null>(null);

  const task = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId]);

  // 选中任务 → 加载交付物与事件
  useEffect(() => {
    openTask(taskId);
  }, [taskId, openTask]);

  // B1 · 2.7：内容交付视图加载溯源结果（未关联资料时展示核对警示；无 provenance 行时静默）
  useEffect(() => {
    if (taskId == null) {
      setProvenance(null);
      return;
    }
    let alive = true;
    void api
      .taskProvenance(taskId)
      .then((r) => {
        if (alive) setProvenance(r.provenance);
      })
      .catch(() => {
        if (alive) setProvenance(null);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  const deliverables = useMemo(() => (taskId != null ? deliverablesByTask[taskId] ?? [] : []), [deliverablesByTask, taskId]);

  const copyDeliverables = useMemo(() => deliverables.filter((d) => d.stage === 'copy' && d.kind === 'copy'), [deliverables]);
  const copyDeliverable = copyDeliverables[copyDeliverables.length - 1]; // 最新版本
  const copy = parseCopy(copyDeliverable);
  const copyState = copyBlockState(task, copyDeliverable);

  const mainImages = useMemo(() => imagesForStage(deliverables, 'main-image'), [deliverables]);
  const detailImages = useMemo(() => imagesForStage(deliverables, 'detail-image'), [deliverables]);
  const imgState = imgBlockState(task);

  /** 信息条参考图来源（shared 统一逻辑）：上传图优先，无则回退 AI 生成主图（main-image 第一张已生成/已采纳） */
  const infoRef = useMemo(() => resolveInfoBarRef(task?.referenceImage, mainImages), [task?.referenceImage, mainImages]);
  const refFallbackImg = useMemo<ParsedImg | null>(() => (infoRef.isUploaded ? null : mainImages.find((img) => img.url === infoRef.src) ?? null), [infoRef, mainImages]);
  const refSrc = infoRef.src;

  const reviewDeliverables = useMemo(() => deliverables.filter((d) => d.stage === 'review' && d.kind === 'copy'), [deliverables]);
  const reviewOutline = parseCopy(reviewDeliverables[reviewDeliverables.length - 1])?.outline;

  const doDecide = async (kind: 'copy' | 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, note?: string) => {
    if (!task || busy) return;
    setBusy(true);
    try {
      await decide(task.id, kind, decision, imageId, note || undefined);
      if (decision === 'approve') {
        pushToast({ message: kind === 'copy' ? '文案已采纳，已推进下一阶段' : '图片已采纳', tone: 'ok', duration: 4000 });
      } else if (decision === 'reject') {
        pushToast({ message: kind === 'copy' ? '文案已打回，返工中' : '图片已打回，返工中', tone: 'no', duration: 5000 });
      } else if (decision === 'skip') {
        pushToast({ message: '已跳过该图，不触发返工', tone: 'default', duration: 4000 });
      }
      if (kind === 'copy') setRejectingCopy(false);
      else setRejectingImg(null);
    } catch (err) {
      console.warn('[内容交付] decide 失败', err);
      pushToast({ message: '操作失败，请重试', tone: 'no', duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  /** 单张图片重试（B11 · 4.10）：只重新生成目标 failed 图；错误（非失败图/已达上限）以行内警示展示 */
  const doRetry = async (imageId: string) => {
    if (!task || busy || retrying) return;
    setRetrying(imageId);
    setRetryError(null);
    try {
      await retryImage(task.id, imageId);
      pushToast({ message: '已开始重新生成该图片', tone: 'signal', duration: 4000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '重试失败';
      setRetryError(msg);
      pushToast({ message: `重试失败：${msg}`, tone: 'no', duration: 5000 });
    } finally {
      setRetrying(null);
    }
  };

  const doReview = async (decision: 'pass' | 'rollback') => {
    if (!task || busy) return;
    setBusy(true);
    try {
      await review(task.id, decision, decision === 'rollback' ? rollbackStage : undefined, decision === 'rollback' ? reviewNote || undefined : undefined);
    } catch (err) {
      console.warn('[内容交付] review 失败', err);
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 审批条（对齐线框 approve-box；QS 焦点信号） ----------
     用户验收定案（P1-4 打回）：审批条只作提醒，不承载决策按钮——
     采纳/打回统一在上方内容卡内操作。条内只保留一行短说明。
     注：审批条渲染在两栏卡片**之下**，故文案为「上方」（此前误写「下方」）。 */
  const pendingKind: 'copy' | 'image' | null =
    task && task.column === 'awaiting' ? (task.stage === 'copy' ? 'copy' : 'image') : null;

  const approveBox =
    task && task.column === 'awaiting' ? (
      <div className="flex items-center gap-3 rounded-[4px] border px-3 py-2.5" style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-soft)' }}>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[12px] font-bold" style={{ color: 'var(--color-signal-strong)' }}>
            审批 · 待你确认 {WORKFLOW_STAGE_LABELS[task.stage] ?? task.stage} #{task.id}
          </div>
          <div className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
            {pendingKind === 'copy'
              ? '待你确认 · 采纳后自动进入图片设计（在上方文案卡内操作）；失败可打回重做。'
              : '待逐张确认 · 全部采纳后自动推进（在上方图片卡内逐张操作）；失败可打回重做。'}
          </div>
        </div>
        {/* 一键采纳（快捷操作，与上方内容卡内逐项操作并存；采纳后自动推进，条随之消失） */}
        <Btn variant="primary" className="shrink-0" disabled={busy} onClick={() => void doDecide(pendingKind === 'copy' ? 'copy' : 'image', 'approve')}>
          {busy ? '处理中…' : '一键采纳'}
        </Btn>
      </div>
    ) : null;

  /* ---------- 左栏：卖点文案 ---------- */
  const copyBadge =
    copyState === 'pending' ? (
      <Badge tone="signal">待你确认</Badge>
    ) : copyState === 'done' ? (
      <Badge tone="ok">已采纳</Badge>
    ) : copyState === 'rejected' ? (
      <Badge tone="no">已打回 · 返工中</Badge>
    ) : copyState === 'working' ? (
      <Badge tone="warn">生成中</Badge>
    ) : (
      <Badge>未产出</Badge>
    );

  const copyBlock = (() => {
    if (copyState === 'none') {
      // 未产出态与小红书工作流同款灰态虚线卡（用户定案：形式统一）
      return <MutedPlaceholder text="文案尚未产出 · 待进入卖点文案阶段" />;
    }
    if (copyState === 'working') {
      return (
        <div className="py-6 text-center">
          <Spinner label="文案 Agent 正在撰写卖点文案…" />
          <div className="qs-meta mt-2">生成完成后将在此展示，供你整包确认</div>
        </div>
      );
    }
    if (!copy) {
      return <Empty text="文案包尚未产出，请稍候…" />;
    }
    return (
      <div>
        <h4 className="font-display text-xl font-semibold leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
          {copy.title}
        </h4>
        {copyDeliverable ? (
          <div className="qs-meta mt-1">版本 v{copyDeliverable.version} · {fmtTime(copyDeliverable.updatedAt)}</div>
        ) : null}

        <ol className="mt-4 space-y-2">
          {copy.points.map((p, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
              <span
                className="tabular mt-0.5 inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center border px-1 text-[11px]"
                style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}
              >
                {i + 1}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <div className="qs-meta mb-1">详情大纲</div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
            {copy.outline}
          </div>
        </div>

        <div className="mt-4">
          <div className="qs-meta mb-1.5">关键词</div>
          <div className="flex flex-wrap gap-1.5">
            {copy.keywords.map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
          </div>
        </div>

        {/* B3 · 3.8：版本切换与差异对照（追加式）。P0-4.1/4.2：移至当前正文之后且默认收起，避免与当前版本混淆 */}
        {task ? <CopyVersionPanel taskId={task.id} /> : null}

        {copyState === 'pending' ? (
          <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
            <div className="flex items-center gap-2">
              <Btn variant="danger" size="sm" disabled={busy} onClick={() => setRejectingCopy(true)}>
                打回重做
              </Btn>
              <Btn variant="primary" size="sm" disabled={busy} onClick={() => void doDecide('copy', 'approve')}>
                采纳
              </Btn>
            </div>
            {rejectingCopy ? (
              <div className="mt-2 space-y-2">
                <input
                  className="qs-input"
                  placeholder="打回原因（将发给文案 Agent 重新输出）…"
                  value={copyNote}
                  onChange={(e) => setCopyNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <Btn variant="ghost" size="sm" onClick={() => setRejectingCopy(false)}>
                    取消
                  </Btn>
                  <Btn variant="danger" size="sm" disabled={busy} onClick={() => void doDecide('copy', 'reject', undefined, copyNote)}>
                    确认打回
                  </Btn>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  })();

  /* ---------- 右栏：图片交付（主图 / 详情图） ---------- */
  const imgBadge =
    imgState === 'pending' ? (
      <Badge tone="signal">待逐张确认</Badge>
    ) : imgState === 'done' ? (
      <Badge tone="ok">已采纳</Badge>
    ) : imgState === 'working' ? (
      <Badge tone="warn">生成中</Badge>
    ) : (
      <Badge>未产出</Badge>
    );

  const renderGrid = (imgs: ParsedImg[], canDecide: boolean) => {
    if (imgs.length === 0) return <Empty text="该板块图片尚未产出" />;
    const failedImgs = imgs.filter((i) => i.status === 'failed');
    const allFailed = failedImgs.length === imgs.length;
    return (
      <div>
        {/* B11 · 4.5/4.6 界面警示：失败图片不阻塞拍板点，但必须可见 */}
        {failedImgs.length > 0 ? (
          <div
            className="mb-2 flex items-start gap-2 rounded-[4px] border px-3 py-2 text-[12px]"
            style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-soft)', color: 'var(--color-ink-soft)' }}
          >
            <span aria-hidden="true">⚠</span>
            <span>
              {allFailed ? '全部图片生成失败 · 可按「跳过」不触发返工地推进，或「打回」让设计师重新产出' : `${failedImgs.length} 张图片生成失败 · 不影响其他图片决策，可「跳过」或「打回」`}
            </span>
          </div>
        ) : null}
        {retryError ? (
          <div
            className="mb-2 rounded-[4px] border px-3 py-2 text-[12px]"
            style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
          >
            重试失败：{retryError}
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-2">
          {imgs.map((img) => {
            const failed = img.status === 'failed';
            const skipped = img.status === 'skipped';
            return (
              <div key={img.id} className="border p-1.5" style={{ borderColor: failed ? 'var(--color-danger)' : 'var(--color-line)' }}>
                {/* failed 图不可放大；svg 模拟占位由 Thumb 内部识别为占位样式 */}
                <Thumb src={img.url} name={img.name} onZoom={failed ? undefined : () => setPreview({ url: img.url, name: img.name, status: img.status })} />
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span className="truncate text-[11px]" title={img.name}>
                    {img.name}
                  </span>
                  <Badge
                    tone={failed ? 'no' : skipped ? 'default' : img.status === 'approved' ? 'ok' : img.status === 'rejected' ? 'no' : canDecide ? 'signal' : 'default'}
                  >
                    {failed ? '生成失败' : skipped ? '已跳过' : img.status === 'approved' ? '已采纳' : img.status === 'rejected' ? '已打回' : canDecide ? '待确认' : '未决'}
                  </Badge>
                </div>
                {failed ? (
                  <div className="qs-meta mt-1" style={{ color: 'var(--color-danger)' }}>
                    生成失败 · 已尝试 {(img.attempts ?? MAX_IMAGE_ATTEMPTS).toLocaleString('zh-CN')}/{MAX_IMAGE_ATTEMPTS} 次
                  </div>
                ) : null}
                {failed && img.error ? (
                  <div className="qs-meta mt-0.5 truncate" title={img.error}>
                    {img.error}
                  </div>
                ) : null}
                {img.status === 'rejected' && img.note ? <div className="qs-meta mt-1">原因 · {img.note}</div> : null}
                {/* 操作区：pending → 采纳/打回；failed → 重试（未超限）/跳过/打回；skipped 已决策不提供操作 */}
                {canDecide && !skipped && (img.status === 'pending' || failed) ? (
                  <div className="mt-1.5">
                    {rejectingImg === img.id ? (
                      <div className="space-y-1.5">
                        <input
                          className="qs-input"
                          autoFocus
                          placeholder="打回原因（将发给设计师重新输出）…"
                          value={imgNotes[img.id] ?? ''}
                          onChange={(e) => setImgNotes((p) => ({ ...p, [img.id]: e.target.value }))}
                        />
                        <div className="flex gap-1.5">
                          <Btn variant="ghost" size="sm" onClick={() => setRejectingImg(null)}>
                            取消
                          </Btn>
                          <Btn variant="danger" size="sm" disabled={busy} onClick={() => void doDecide('image', 'reject', img.id, imgNotes[img.id])}>
                            确认打回
                          </Btn>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {!failed ? (
                          <Btn size="sm" variant="primary" disabled={busy} onClick={() => void doDecide('image', 'approve', img.id)}>
                            采纳
                          </Btn>
                        ) : null}
                        {failed ? (
                          <>
                            {(img.attempts ?? 0) < MAX_IMAGE_ATTEMPTS ? (
                              <Btn size="sm" variant="signal" disabled={busy || retrying !== null} onClick={() => void doRetry(img.id)}>
                                {retrying === img.id ? '重试中…' : '重试'}
                              </Btn>
                            ) : (
                              <span className="qs-meta self-center text-[10px]" title="该图已连续 3 次生成失败，达到重试上限">
                                已达上限
                              </span>
                            )}
                            <Btn size="sm" variant="ghost" disabled={busy} onClick={() => void doDecide('image', 'skip', img.id)}>
                              跳过
                            </Btn>
                          </>
                        ) : null}
                        <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setRejectingImg(img.id)}>
                          打回重做
                        </Btn>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const imageBlock = (() => {
    if (imgState === 'none') {
      // 未产出态与小红书工作流同款灰态虚线卡（用户定案：形式统一）
      return <MutedPlaceholder text="图片尚未产出 · 待文案确认后进入主图设计" />;
    }
    if (imgState === 'working') {
      return (
        <div className="py-6 text-center">
          <Spinner label={task?.stage === 'detail-image' ? '设计师正在生成详情图…' : '设计师正在生成主图…'} />
          <div className="qs-meta mt-2">生成完成后将在此展示，供你逐张确认</div>
        </div>
      );
    }
    // 图片确认点：main-image 与 detail-image 均为确认点（详情图审批，意见7）；awaiting 待确认时图卡可采纳/打回
    const canDecide = imgState === 'pending' && (task?.stage === 'main-image' || task?.stage === 'detail-image');
    return (
      <>
        <Tabs
          className="mb-3"
          items={[
            { key: 'main', label: '主图', count: mainImages.length },
            { key: 'detail', label: '详情图', count: detailImages.length },
          ]}
          activeKey={imageTab}
          onChange={(k) => setImageTab(k)}
        />
        {imageTab === 'main' ? renderGrid(mainImages, canDecide) : renderGrid(detailImages, canDecide)}
      </>
    );
  })();

  /* ---------- 底部：主管校对终审 ---------- */
  const reviewBlock =
    task?.stage === 'review' ? (
      <Card
        title="主管校对 · 终审"
        extra={
          <Badge tone={task.column === 'done' ? 'ok' : task.column === 'awaiting' ? 'signal' : 'warn'}>
            {task.column === 'done' ? '已放行' : task.column === 'awaiting' ? '待终审' : '校对中'}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="qs-meta mb-1.5">校对报告</div>
            {reviewOutline ? (
              <div
                className="whitespace-pre-wrap border p-3 text-[13px] leading-relaxed"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
              >
                {reviewOutline}
              </div>
            ) : (
              <div>
                <Spinner label="主管校对进行中…" />
                <div className="qs-meta mt-2">报告产出后即可在此终审放行或回退</div>
              </div>
            )}
          </div>
          <div>
            <div className="qs-meta mb-1.5">终审操作</div>
            <Btn variant="primary" disabled={busy} onClick={() => void doReview('pass')}>
              放行 → 交付完成
            </Btn>
            <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
              <div className="qs-meta mb-1.5">回退（发现问题打回对应阶段重新输出）</div>
              <div className="flex items-center gap-2">
                <select className="qs-input" style={{ width: 'auto' }} value={rollbackStage} onChange={(e) => setRollbackStage(e.target.value)}>
                  {ROLLBACK_TARGETS.map((s) => (
                    <option key={s} value={s}>
                      {WORKFLOW_STAGE_LABELS[s] ?? s}
                    </option>
                  ))}
                </select>
                <Btn variant="danger" disabled={busy} onClick={() => void doReview('rollback')}>
                  回退
                </Btn>
              </div>
              <input
                className="qs-input mt-2"
                placeholder="回退原因（将发给对应 Agent）…"
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </div>
          </div>
        </div>
      </Card>
    ) : null;

  return (
    <div className="space-y-4">
      {task ? (
        <>
          {/* 任务信息条（与小红书工作流共用组件）
              参考图优先级：用户上传图 → AI 生成主图（main-image 第一张已生成/已采纳）→ 暂无参考图空态 */}
          <TaskInfoBar
            platforms={task.platforms && task.platforms.length > 0 ? task.platforms.join(' / ') : task.platform || '—'}
            refThumbSrc={refSrc}
            refThumbName={task.referenceImage ? '参考图' : refFallbackImg ? 'AI 生成主图' : undefined}
            refThumbNote={
              task.referenceImage
                ? 'AI 产出将基于参考图生成'
                : refFallbackImg
                  ? '未提供参考图，产出由 Agent 按产品资料生成'
                  : '暂无参考图 · 产出由 Agent 生成'
            }
            onZoomRef={() =>
              refSrc
                ? setPreview({
                    url: refSrc,
                    name: task.referenceImage ? '参考图' : refFallbackImg?.name ?? '参考图',
                    status: task.referenceImage ? 'ref' : refFallbackImg?.status ?? 'ref',
                  })
                : undefined
            }
          />

          {/* 「未关联知识库资料」警示已移至「任务详情」页顶部（用户定案 2026-09-14，两条工作流统一） */}

          {/* 两卡等高：grid items-stretch + 每 Card 内部 grid 行撑满 */}
          <div className="grid grid-cols-2 items-stretch gap-4">
            <Card className="grid grid-rows-[auto_1fr]" title="卖点文案" extra={copyBadge}>
              <div className="flex h-full flex-col">{copyBlock}</div>
            </Card>
            <Card className="grid grid-rows-[auto_1fr]" title="图片交付" extra={imgBadge}>
              <div className="flex h-full flex-col">{imageBlock}</div>
            </Card>
          </div>
          {approveBox}
          {reviewBlock}
        </>
      ) : null}

      {/* 大图预览（抽为 ImagePreview 组件，消除与 XhsDeliveryView 的重复实现） */}
      <ImagePreview
        preview={preview ? { url: preview.url, name: preview.name, statusLabel: deliverableStatusLabel(preview.status) } : null}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}

/* ===== B3 · 3.8 文案版本切换与差异对照（追加式） ===== */

function parseCopyVersion(content: string): CopyPackage | null {
  try {
    return JSON.parse(content) as CopyPackage;
  } catch {
    return null;
  }
}

/**
 * 版本下拉（含版本号与产出时间）+ 选中版本内容 + 「与上一版对比」面板：
 * 新增/删除/保留卖点行分组、标题/大纲/关键词变化；仅有 v1 时显示「无上一版可对比」。
 * P0-4.2：默认收起，仅渲染标题栏控件，点击后就地展开（挂在当前正文下方）。
 */
function CopyVersionPanel({ taskId }: { taskId: number }) {
  const [versions, setVersions] = useState<DeliverableVersion[] | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [diff, setDiff] = useState<DeliverableDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  /** P0-4.2：历史版本默认收起，避免抢占当前正文的注意力 */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setVersions(null);
    setDiff(null);
    void api
      .deliverableVersions(taskId, 'copy')
      .then((r) => {
        if (!alive) return;
        setVersions(r.versions);
        setSel(r.versions[r.versions.length - 1]?.version ?? null);
      })
      .catch(() => {
        if (alive) setVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [taskId]);

  if (!versions || versions.length === 0) return null;

  const cur = versions.find((v) => v.version === sel) ?? versions[versions.length - 1];
  const curCopy = cur ? parseCopyVersion(cur.content) : null;

  const loadDiff = async () => {
    setDiffLoading(true);
    try {
      const r = await api.deliverableDiff(taskId, 'copy');
      setDiff(r.diff);
    } catch {
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <div className="mt-4 border-t pt-2.5" style={{ borderColor: 'var(--color-line)' }}>
      <button
        type="button"
        className="qs-clickable qs-meta flex items-center gap-1.5"
        style={{ color: 'var(--color-ink-soft)' }}
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        title={open ? '收起历史版本' : '展开历史版本与差异对照'}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        历史版本 ({versions.length})
      </button>

      {open ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
              历史版本
            </span>
            <select
              className="qs-input"
              style={{ width: 'auto' }}
              value={sel ?? ''}
              onChange={(e) => setSel(Number(e.target.value))}
              title="切换查看历史版本内容"
            >
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version} · {fmtTime(v.createdAt)}
                </option>
              ))}
            </select>
            <Btn size="sm" variant="ghost" disabled={diffLoading} onClick={() => void loadDiff()}>
              {diffLoading ? '对比中…' : '与上一版对比'}
            </Btn>
          </div>

      {curCopy ? (
        <div className="mt-2 rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
          <div className="qs-meta mb-1 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            v{cur.version} 内容预览
          </div>
          <div className="text-[13px] font-semibold">{curCopy.title}</div>
          <ol className="mt-1 space-y-0.5">
            {curCopy.points.map((p, i) => (
              <li key={i} className="text-[12px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
                · {p}
              </li>
            ))}
          </ol>
          {curCopy.outline ? (
            <div className="qs-meta mt-1 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              大纲：{curCopy.outline}
            </div>
          ) : null}
          {curCopy.keywords.length > 0 ? (
            <div className="qs-meta mt-1 text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
              关键词：{curCopy.keywords.join('、')}
            </div>
          ) : null}
        </div>
      ) : null}

      {diff ? (
        <div className="mt-2 rounded-[4px] border p-2.5" style={{ borderColor: 'var(--color-line)' }}>
          <div className="qs-meta mb-1.5 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
            v{diff.fromVersion ?? '—'} → v{diff.toVersion} 对比
          </div>
          {!diff.hasPrevious ? (
            <div className="qs-meta text-[12px]">无上一版可对比</div>
          ) : diff.identical ? (
            <div className="qs-meta text-[12px]">与上一版一致</div>
          ) : (
            <div className="space-y-1.5 text-[12px] leading-relaxed">
              {diff.titleChanged && diff.title ? (
                <div>
                  标题：<span className="line-through" style={{ color: 'var(--color-danger)' }}>{diff.title.from}</span>
                  <span className="mx-1" style={{ color: 'var(--color-ink-faint)' }}>→</span>
                  <span style={{ color: 'var(--color-ok)' }}>{diff.title.to}</span>
                </div>
              ) : null}
              {diff.outlineChanged && diff.outline ? (
                <div>
                  大纲：<span className="line-through" style={{ color: 'var(--color-danger)' }}>{diff.outline.from}</span>
                  <span className="mx-1" style={{ color: 'var(--color-ink-faint)' }}>→</span>
                  <span style={{ color: 'var(--color-ok)' }}>{diff.outline.to}</span>
                </div>
              ) : null}
              {diff.addedPoints.length > 0 ? (
                <div>
                  新增卖点：
                  {diff.addedPoints.map((p) => (
                    <span key={p} className="ml-1 rounded-[4px] px-1.5 py-0.5" style={{ background: 'var(--color-ok-soft)', color: 'var(--color-ok)' }}>
                      +{p}
                    </span>
                  ))}
                </div>
              ) : null}
              {diff.removedPoints.length > 0 ? (
                <div>
                  删除卖点：
                  {diff.removedPoints.map((p) => (
                    <span
                      key={p}
                      className="ml-1 line-through rounded-[4px] px-1.5 py-0.5"
                      style={{ background: 'var(--color-danger-soft)', color: 'var(--color-danger)' }}
                    >
                      −{p}
                    </span>
                  ))}
                </div>
              ) : null}
              {diff.keptPoints.length > 0 ? (
                <div>
                  保留卖点：
                  {diff.keptPoints.map((p) => (
                    <span key={p} className="ml-1" style={{ color: 'var(--color-ink-soft)' }}>
                      {p}
                    </span>
                  ))}
                </div>
              ) : null}
              {diff.keywordChanges.added.length > 0 ? <div>新增关键词：{diff.keywordChanges.added.join('、')}</div> : null}
              {diff.keywordChanges.removed.length > 0 ? <div>删除关键词：{diff.keywordChanges.removed.join('、')}</div> : null}
            </div>
          )}
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}
