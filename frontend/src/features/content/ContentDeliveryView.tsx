import { useEffect, useMemo, useState } from 'react';
import type { Deliverable, Task } from '@workbench/shared';
import { BOARD_COLUMNS, WORKFLOW_STAGE_LABELS } from '@workbench/shared';
import { Badge, Btn, Card, Empty, SectionTitle, Spinner } from '../../components/ui.tsx';
import { parseCopy, parseImages } from '../../lib/api.ts';
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

/** 板块状态：none 未产出 / working 生成中 / pending 待拍板 / done 已采纳 / rejected 已打回返工 */
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
  if (stageIndex(task.stage) > stageIndex('copy')) return 'done'; // 拍板点1 已过 → 文案必已采纳
  return 'none';
}

function imgBlockState(task: Task | null): BlockState {
  if (!task) return 'none';
  if (task.stage === 'main-image') {
    if (task.column === 'awaiting') return 'pending';
    if (task.column === 'progress') return 'working';
    return 'none';
  }
  if (stageIndex(task.stage) > stageIndex('main-image')) return 'done'; // 拍板点2 已过 → 主图必已采纳
  return 'none';
}

interface ParsedImg {
  id: string;
  name: string;
  kind: string;
  url: string;
  status: string;
  note?: string;
}

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

/** 缩略图：dataURL 加载完成前显示 Spinner；hover 出现「放大」按钮（几何符号 + 文字） */
function Thumb({ src, name, onZoom }: { src: string; name: string; onZoom?: () => void }) {
  const [loaded, setLoaded] = useState(false);
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
          style={{ background: 'rgba(0,0,0,0.55)' }}
        >
          <span aria-hidden="true" className="text-[12px] leading-none">⊕</span>
          放大
        </button>
      ) : null}
    </div>
  );
}

export function ContentDeliveryView({ taskId }: { taskId: number }) {
  const { tasks, deliverablesByTask, openTask, decide, review } = useWorkbench();
  const [imageTab, setImageTab] = useState<'main' | 'detail'>('main');
  const [rejectingCopy, setRejectingCopy] = useState(false);
  const [copyNote, setCopyNote] = useState('');
  const [rejectingImg, setRejectingImg] = useState<string | null>(null);
  const [imgNotes, setImgNotes] = useState<Record<string, string>>({});
  const [rollbackStage, setRollbackStage] = useState('copy');
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** 大图预览（缩略图 hover 放大 / 参考图点击） */
  const [preview, setPreview] = useState<{ url: string; name: string; status: string } | null>(null);

  const task = useMemo(() => tasks.find((t) => t.id === taskId) ?? null, [tasks, taskId]);

  // 选中任务 → 加载交付物与事件
  useEffect(() => {
    openTask(taskId);
  }, [taskId, openTask]);

  const deliverables = useMemo(() => (taskId != null ? deliverablesByTask[taskId] ?? [] : []), [deliverablesByTask, taskId]);

  const copyDeliverables = useMemo(() => deliverables.filter((d) => d.stage === 'copy' && d.kind === 'copy'), [deliverables]);
  const copyDeliverable = copyDeliverables[copyDeliverables.length - 1]; // 最新版本
  const copy = parseCopy(copyDeliverable);
  const copyState = copyBlockState(task, copyDeliverable);

  const mainImages = useMemo(() => imagesForStage(deliverables, 'main-image'), [deliverables]);
  const detailImages = useMemo(() => imagesForStage(deliverables, 'detail-image'), [deliverables]);
  const imgState = imgBlockState(task);

  const reviewDeliverables = useMemo(() => deliverables.filter((d) => d.stage === 'review' && d.kind === 'copy'), [deliverables]);
  const reviewOutline = parseCopy(reviewDeliverables[reviewDeliverables.length - 1])?.outline;

  const doDecide = async (kind: 'copy' | 'image', decision: 'approve' | 'reject', imageId?: string, note?: string) => {
    if (!task || busy) return;
    setBusy(true);
    try {
      await decide(task.id, kind, decision, imageId, note || undefined);
      if (kind === 'copy') setRejectingCopy(false);
      else setRejectingImg(null);
    } catch (err) {
      console.warn('[内容交付] decide 失败', err);
    } finally {
      setBusy(false);
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
     审批重构：卡片内「采纳」点击即推进；审批条仅保留说明 + 打回意见输入 + 打回按钮，不再重复「采纳并推进」 */
  const approveBox =
    task && task.column === 'awaiting' ? (
      <div className="rounded-[4px] border px-3 py-2.5" style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-soft)' }}>
        <div className="mb-1.5 text-[12px] font-bold" style={{ color: 'var(--color-signal-strong)' }}>
          审批 · 待你拍板 {WORKFLOW_STAGE_LABELS[task.stage] ?? task.stage} #{task.id}
        </div>
        <div className="mb-2 text-[13px]" style={{ color: 'var(--color-ink-soft)' }}>
          {task.stage === 'copy'
            ? `采纳按钮在下方文案卡内，点击即推进下一阶段；打回需填写修改意见，将发给 ${task.ownerName || '文案 Agent'} 重新输出。`
            : '采纳按钮在下方图片卡内逐张点击，全部采纳后自动推进；打回需在对应图片卡内操作。'}
        </div>
        {task.stage === 'copy' ? (
          <div className="flex items-center gap-2">
            <input
              className="qs-input flex-1"
              placeholder="修改意见（打回时填写）…"
              value={copyNote}
              onChange={(e) => setCopyNote(e.target.value)}
            />
            <Btn variant="danger" onClick={() => void doDecide('copy', 'reject', undefined, copyNote || '请按修改意见调整')}>
              打回并发送意见
            </Btn>
          </div>
        ) : null}
      </div>
    ) : null;

  /* ---------- 左栏：卖点文案 ---------- */
  const copyBadge =
    copyState === 'pending' ? (
      <Badge tone="signal">待你拍板</Badge>
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
      return <Empty text="文案尚未产出 · 待进入卖点文案阶段" />;
    }
    if (copyState === 'working') {
      return (
        <div className="py-6 text-center">
          <Spinner label="文案 Agent 正在撰写卖点文案…" />
          <div className="qs-meta mt-2">生成完成后将在此展示，供你整包拍板</div>
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
          <div className="qs-meta mt-1">版本 v{copyDeliverable.version} · {new Date(copyDeliverable.updatedAt).toLocaleString('zh-CN')}</div>
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

        {copyState === 'pending' ? (
          <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--color-line)' }}>
            <div className="flex items-center gap-2">
              <Btn variant="danger" size="sm" disabled={busy} onClick={() => setRejectingCopy(true)}>
                打回
              </Btn>
              <Btn variant="primary" size="sm" disabled={busy} onClick={() => void doDecide('copy', 'approve')}>
                采纳
              </Btn>
            </div>
            {rejectingCopy ? (
              <div className="mt-2 space-y-2">
                <input
                  className="qs-input"
                  placeholder="修改意见（将发给文案 Agent 重新输出）…"
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
      <Badge tone="signal">待逐张拍板</Badge>
    ) : imgState === 'done' ? (
      <Badge tone="ok">已采纳</Badge>
    ) : imgState === 'working' ? (
      <Badge tone="warn">生成中</Badge>
    ) : (
      <Badge>未产出</Badge>
    );

  const renderGrid = (imgs: ParsedImg[], canDecide: boolean) => {
    if (imgs.length === 0) return <Empty text="该板块图片尚未产出" />;
    return (
      <div className="grid grid-cols-3 gap-2">
        {imgs.map((img) => (
          <div key={img.id} className="border p-1.5" style={{ borderColor: 'var(--color-line)' }}>
            <Thumb src={img.url} name={img.name} onZoom={() => setPreview({ url: img.url, name: img.name, status: img.status })} />
            <div className="mt-1.5 flex items-center justify-between gap-1">
              <span className="truncate text-[11px]" title={img.name}>
                {img.name}
              </span>
              <Badge tone={img.status === 'approved' ? 'ok' : img.status === 'rejected' ? 'no' : canDecide ? 'signal' : 'default'}>
                {img.status === 'approved' ? '已采纳' : img.status === 'rejected' ? '已打回' : canDecide ? '待拍板' : '未决'}
              </Badge>
            </div>
            {img.status === 'rejected' && img.note ? <div className="qs-meta mt-1">原因 · {img.note}</div> : null}
            {canDecide && img.status === 'pending' ? (
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
                  <div className="flex gap-1.5">
                    <Btn size="sm" variant="primary" disabled={busy} onClick={() => void doDecide('image', 'approve', img.id)}>
                      采纳
                    </Btn>
                    <Btn size="sm" variant="ghost" disabled={busy} onClick={() => setRejectingImg(img.id)}>
                      打回
                    </Btn>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const imageBlock = (() => {
    if (imgState === 'none') {
      return <Empty text="图片尚未产出 · 待文案拍板后进入主图设计" />;
    }
    if (imgState === 'working') {
      return (
        <div className="py-6 text-center">
          <Spinner label="设计师正在生成主图…" />
          <div className="qs-meta mt-2">生成完成后将在此展示，供你逐张拍板</div>
        </div>
      );
    }
    const canDecide = imgState === 'pending' && task?.stage === 'main-image';
    return (
      <>
        <div className="mb-3 flex items-center gap-1 border-b" style={{ borderColor: 'var(--color-line)' }}>
          {(
            [
              ['main', '主图', mainImages.length],
              ['detail', '详情图', detailImages.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              onClick={() => setImageTab(key)}
              className="-mb-px border-b-2 px-3 py-1.5 text-[13px]"
              style={{
                borderColor: imageTab === key ? 'var(--color-signal)' : 'transparent',
                color: imageTab === key ? 'var(--color-ink)' : 'var(--color-ink-soft)',
                fontWeight: imageTab === key ? 500 : 400,
              }}
            >
              {label}
              <span className="qs-meta tabular ml-1">({count})</span>
            </button>
          ))}
        </div>
        {imageTab === 'main' ? renderGrid(mainImages, canDecide) : renderGrid(detailImages, false)}
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
              放行 → 交付归档
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
          {/* 任务信息条：参考图（可点击放大）+ 目标平台（platforms 多选；兼容单数 platform） */}
          <div className="flex items-center gap-3 rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
            {task.referenceImage ? (
              <button
                type="button"
                className="h-14 w-14 shrink-0 overflow-hidden border transition-colors hover:border-[var(--color-signal)]"
                style={{ borderColor: 'var(--color-line-strong)' }}
                title="点击放大参考图"
                onClick={() => setPreview({ url: task.referenceImage as string, name: '参考图', status: 'ref' })}
              >
                <img src={task.referenceImage} alt="参考图" className="h-full w-full object-cover" />
              </button>
            ) : (
              <span className="qs-meta flex h-14 w-14 shrink-0 items-center justify-center border" style={{ borderColor: 'var(--color-line-strong)' }}>
                无参考图
              </span>
            )}
            <div className="min-w-0">
              <div className="text-[12px] font-medium">
                目标平台 · {task.platforms && task.platforms.length > 0 ? task.platforms.join(' / ') : task.platform || '—'}
              </div>
              <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
                {task.referenceImage ? 'AI 产出将基于参考图生成' : '未提供参考图，产出由 Agent 按产品资料生成'}
              </div>
            </div>
          </div>

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

      {/* 大图预览 overlay（深色半透明遮罩 + 居中大图 + 关闭） */}
      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(10,10,10,0.72)' }}
          onClick={() => setPreview(null)}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <img src={preview.url} alt={preview.name} className="max-h-[76vh] max-w-full border object-contain" style={{ borderColor: 'rgba(255,255,255,0.25)' }} />
            <button type="button" className="qs-btn sm absolute -top-10 right-0" onClick={() => setPreview(null)}>
              ✕ 关闭
            </button>
            <div className="qs-meta mt-2 text-center" style={{ color: 'rgba(255,255,255,0.72)' }}>
              {preview.name} ·{' '}
              {preview.status === 'approved' ? '已采纳' : preview.status === 'rejected' ? '已打回' : preview.status === 'ref' ? '参考图' : '待拍板'}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
