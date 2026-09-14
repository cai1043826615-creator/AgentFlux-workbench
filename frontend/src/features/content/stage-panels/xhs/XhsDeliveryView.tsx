import { useEffect, useMemo, useState } from 'react';
import type { Deliverable, Task, TopicOption, XhsNote } from '@workbench/shared';
import { XHS_STAGE_COPY, XHS_STAGE_DELIVER, XHS_STAGE_IMAGE, XHS_STAGE_PACKAGE, XHS_STAGE_REVIEW, XHS_STAGE_TOPIC, stageIndexOf } from '@workbench/shared';
import { Btn, Empty, Spinner } from '../../../../components/ui.tsx';
import { useWorkbench } from '../../../../store/useWorkbench.tsx';
import { ImagePanel } from './ImagePanel.tsx';
import { NotePanel } from './NotePanel.tsx';
import { TopicPanel } from './TopicPanel.tsx';
import { PendingCard, copyJsonForStage, imagesForStage, type PanelState, type ParsedImg } from './shared.tsx';

/* 小红书种草笔记 · 内容交付（按阶段纵向序列，与电商两栏并排布局相互独立）
   阶段顺序严格取自 XHS 图定义，不引用电商常量。
   合规审核已移至「任务详情」页顶部；发布包装为自动节点，不再出卡片。 */

const STAGES = [XHS_STAGE_TOPIC, XHS_STAGE_COPY, XHS_STAGE_IMAGE, XHS_STAGE_REVIEW, XHS_STAGE_PACKAGE, XHS_STAGE_DELIVER];

/** 依据当前阶段与列推导某阶段面板状态 */
function stateOf(task: Task, stage: string): PanelState {
  const cur = task.stage;
  const curIdx = STAGES.indexOf(cur);
  const idx = STAGES.indexOf(stage);
  if (idx < 0 || curIdx < 0) return 'none';
  if (task.column === 'done') return 'done';
  if (idx > curIdx) return 'none'; // 未开始 → 灰态占位，不显示生成中
  if (idx < curIdx) return 'done';
  // 当前阶段
  if (task.column === 'awaiting') return 'pending';
  if (task.column === 'progress') return 'working';
  return 'none';
}

export function XhsDeliveryView({ task, deliverables }: { task: Task; deliverables: Deliverable[] }) {
  const { decide, retryImage, pushToast } = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const wfId = task.workflowId;
  const stageIdx = stageIndexOf(wfId, task.stage);
  const delivered = useMemo(() => deliverables, [deliverables]);

  // 各阶段产出解析（失败降级为 null，不阻塞渲染）
  const topics = useMemo(() => {
    const raw = copyJsonForStage<{ points?: string[]; keywords?: string[] }>(delivered, XHS_STAGE_TOPIC);
    if (!raw?.points) return [] as TopicOption[];
    return raw.points.map((p, i) => {
      const [angle, desc] = p.split('｜');
      return { angle: angle ?? `方向 ${i + 1}`, desc: desc ?? '', anchors: raw.keywords ?? [] };
    });
  }, [delivered]);

  const note = useMemo<XhsNote | null>(() => {
    const raw = copyJsonForStage<{ title?: string; outline?: string; keywords?: string[] }>(delivered, XHS_STAGE_COPY);
    if (!raw?.title) return null;
    return { title: raw.title, body: raw.outline ?? '', tags: raw.keywords ?? [] };
  }, [delivered]);

  const imgs = useMemo(() => imagesForStage(delivered, XHS_STAGE_IMAGE), [delivered]);

  // 任务切换时清理本地态
  useEffect(() => {
    setPreview(null);
    setRetrying(null);
  }, [task.id]);

  const doDecide = async (kind: 'copy' | 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, noteText?: string) => {
    setBusy(true);
    try {
      await decide(task.id, kind, decision, imageId, noteText);
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : '操作失败', tone: 'no' });
    } finally {
      setBusy(false);
    }
  };

  const doRetry = async (imageId: string) => {
    setRetrying(imageId);
    try {
      await retryImage(task.id, imageId);
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : '重试失败', tone: 'no' });
    } finally {
      setRetrying(null);
    }
  };

  if (!task) return <Empty text="任务不存在" />;

  const stTopic = stateOf(task, XHS_STAGE_TOPIC);
  const stCopy = stateOf(task, XHS_STAGE_COPY);
  const stImage = stateOf(task, XHS_STAGE_IMAGE);
  const isDelivered = task.column === 'done';

  return (
    <div className="space-y-3.5">
      {/* 当前阶段横幅 */}
      <div
        className="rounded-[4px] border px-3.5 py-2.5"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-signal-soft)' }}
      >
        <div className="text-[13px] font-semibold" style={{ color: 'var(--color-signal-strong)' }}>
          当前阶段 · 第 {Math.max(0, stageIdx) + 1}/{STAGES.length} 段
        </div>
        <div className="qs-meta mt-0.5">
          {task.column === 'awaiting' ? '等待你确认' : task.column === 'done' ? '已交付' : 'Agent 推进中'}
        </div>
      </div>

      <TopicPanel topics={topics} state={stTopic} busy={busy} onDecide={doDecide} />
      {stCopy === 'none' ? <PendingCard label="笔记撰写" /> : <NotePanel note={note} state={stCopy} busy={busy} onDecide={doDecide} />}
      {stImage === 'none' ? (
        <PendingCard label="封面配图" />
      ) : (
        <ImagePanel
          imgs={imgs}
          state={stImage}
          busy={busy}
          retrying={retrying}
          onDecide={doDecide}
          onRetry={doRetry}
          onZoom={(img: ParsedImg) => setPreview({ url: img.url, name: img.name })}
        />
      )}
      {/* 合规审核与发布包装均为自动节点，不在内容交付里出卡片：
          合规审核 → 任务详情页顶部；发布包装 → 自动跑完直接交付，交付包从右上角下载 */}

      {/* 加载态：当前阶段生成中且无产出时的统一提示 */}
      {task.column === 'progress' ? (
        <div className="flex items-center gap-2">
          <Spinner label="Agent 推进中…" />
        </div>
      ) : null}

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(10,10,10,0.72)' }}
          onClick={() => setPreview(null)}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[76vh] max-w-full border object-contain"
              style={{ borderColor: 'rgba(255,255,255,0.25)' }}
            />
            <button type="button" className="qs-btn sm absolute -top-10 right-0" onClick={() => setPreview(null)}>
              ✕ 关闭
            </button>
            <div className="qs-meta mt-2 text-center" style={{ color: 'rgba(255,255,255,0.72)' }}>
              {preview.name}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 交付包下载入口是否可用（未到交付完成时置灰） */
export function XhsDownloadButton({ task }: { task: Task }) {
  const done = task.column === 'done';
  return (
    <Btn size="sm" disabled={!done} title={done ? '下载发布包' : '任务交付完成后可下载'}>
      下载交付包
    </Btn>
  );
}
