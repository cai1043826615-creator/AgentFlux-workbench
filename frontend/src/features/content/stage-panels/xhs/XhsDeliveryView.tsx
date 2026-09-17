import { useEffect, useMemo, useState } from 'react';
import type { Deliverable, Task, TopicOption, XhsNote } from '@workbench/shared';
import { WORKFLOW_STAGE_LABELS, XHS_STAGE_COPY, XHS_STAGE_COVER, XHS_STAGE_DELIVER, XHS_STAGE_INNER, XHS_STAGE_REVIEW, XHS_STAGE_TOPIC, stageIndexOf, stageKeysOf } from '@workbench/shared';
import { Btn, Empty, Spinner } from '../../../../components/ui.tsx';
import { useWorkbench } from '../../../../store/useWorkbench.tsx';
import { useDownloadPackage } from '../../../../lib/useDownloadPackage.ts';
import { ImagePanel } from './ImagePanel.tsx';
import { NotePanel } from './NotePanel.tsx';
import { TopicPanel } from './TopicPanel.tsx';
import { CompliancePanel, parseCompliance } from './CompliancePanel.tsx';
import { TaskInfoBar } from './TaskInfoBar.tsx';
import { PendingCard, copyJsonForStage, imagesForStage, resolveInfoBarRef, type PanelState, type ParsedImg } from './shared.tsx';

/* 小红书种草笔记 · 内容交付（按阶段纵向序列，与电商两栏并排布局相互独立）
   阶段顺序（用户定案 2026-09-14）：
     选题策划 → 笔记撰写 → 首图设计 → 内页设计 → 主管校对 → 交付完成
   - 首图与内页图分两段：先只生成 1 张首图，确认后再生成内页图
   - 主管校对与交付完成均为自动节点：校对通过后自动归档，交付包用「导出交付包」取回
   - 底部紫条是快捷操作：待确认阶段提供「一键采纳」（右置），不替代内容卡内逐项操作 */

const STAGES = [XHS_STAGE_TOPIC, XHS_STAGE_COPY, XHS_STAGE_COVER, XHS_STAGE_INNER, XHS_STAGE_REVIEW, XHS_STAGE_DELIVER];

/** 依据当前阶段与列推导某阶段面板状态 */
function stateOf(task: Task, stage: string): PanelState {
  const cur = task.stage;
  const curIdx = STAGES.indexOf(cur);
  const idx = STAGES.indexOf(stage);
  if (idx < 0 || curIdx < 0) return 'none';
  if (task.column === 'done') return 'done';
  if (idx > curIdx) return 'none'; // 未开始 → 灰态占位，不显示生成中
  if (idx < curIdx) return 'done';
  if (task.column === 'awaiting') return 'pending';
  if (task.column === 'progress') return 'working';
  return 'none';
}

export function XhsDeliveryView({ task, deliverables }: { task: Task & { ownerName?: string }; deliverables: Deliverable[] }) {
  const { decide, retryImage, pushToast } = useWorkbench();
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const { download, busy: packing } = useDownloadPackage(task.id);

  const wfId = task.workflowId;
  const stageIdx = stageIndexOf(wfId, task.stage);
  const delivered = useMemo(() => deliverables, [deliverables]);
  const isDone = task.column === 'done';
  const awaiting = task.column === 'awaiting';

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

  const coverImgs = useMemo(() => imagesForStage(delivered, XHS_STAGE_COVER), [delivered]);
  const innerImgs = useMemo(() => imagesForStage(delivered, XHS_STAGE_INNER), [delivered]);
  /** 合规审核结果（主管校对报告；shared 解析口径与任务详情一致） */
  const compliance = useMemo(() => parseCompliance(delivered), [delivered]);
  /** 信息条参考图：上传图优先，无则回退 AI 生成的首图（与电商逻辑统一） */
  const infoRef = useMemo(() => resolveInfoBarRef(task.referenceImage, coverImgs), [task.referenceImage, coverImgs]);

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

  /** 当前阶段是否「需人工确认且可一键采纳」 */
  const stTopic = stateOf(task, XHS_STAGE_TOPIC);
  const stCopy = stateOf(task, XHS_STAGE_COPY);
  const stCover = stateOf(task, XHS_STAGE_COVER);
  const stInner = stateOf(task, XHS_STAGE_INNER);
  /** 阶段的中文名（优先用共享标签，避免旧阶段 key 显示英文） */
  const stageLabelOf: Record<string, string> = {
    ...WORKFLOW_STAGE_LABELS,
    // 历史任务可能停在已废弃的 xhs-image / xhs-package（结构变更前创建）
    'xhs-image': '封面配图（旧）',
    'xhs-package': '发布包装（旧）',
  };
  const stageName = stageLabelOf[task.stage] ?? task.stage;
  /**
   * 一键采纳 = 快捷操作，不替代内容卡内的原有逐项操作（用户定案）。
   * 显示条件：任务待确认且非交付阶段。
   * （历史任务停在已废弃阶段的，在渲染前已整体降级提前 return，不会走到这里。）
   *
   * 实现注意（bug 修复）：图片阶段必须**逐张**调用决策（带 imageId）——
   * 之前一次 `decide('image','approve')` 不带 imageId，后端匹配不到任何一张图，
   * `allImagesDecided` 为 false → 不推进，用户被迫再点一次（即「采纳后不进下一步」的根因）。
   * 循环策略：pending → approve；failed → skip（计为已决策，不触发返工）；
   * 全部决策完由后端自动推进，紫条随 column 离开 awaiting 自然消失。
   */
  const canOneClickAdopt = awaiting && task.stage !== XHS_STAGE_DELIVER;
  const isImageStage = task.stage === XHS_STAGE_COVER || task.stage === XHS_STAGE_INNER;
  const oneClickAdopt = async () => {
    setBusy(true);
    try {
      if (isImageStage) {
        const all = [...coverImgs, ...innerImgs];
        const undecided = all.filter((i) => i.status === 'pending' || i.status === 'failed');
        for (const img of undecided) {
          await decide(task.id, 'image', img.status === 'failed' ? 'skip' : 'approve', img.id);
        }
        // 全部已决策（含此前手动决策过的）→ 后端在最后一次决策时已自动推进
        if (undecided.length === 0) {
          await decide(task.id, 'image', 'approve', all[0]?.id ?? '');
        }
      } else {
        await decide(task.id, 'copy', 'approve');
      }
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : '采纳失败', tone: 'no' });
    } finally {
      setBusy(false);
    }
  };

  if (!task) return <Empty text="任务不存在" />;

  /**
   * 历史任务降级（用户截图反馈）：任务停在结构变更前的废弃阶段（如 xhs-image）时，
   * stageIdx=-1，面板网格对它全部显示灰态、一键采纳也无从操作——整体降级为提示，
   * 不再渲染四张空卡（避免「模拟占位/未产出」等误导内容）。
   */
  const stageKnown = stageKeysOf(task.workflowId).includes(task.stage);
  if (!stageKnown) {
    return (
      <div className="space-y-3.5">
        <div
          className="rounded-[4px] border px-3.5 py-3"
          style={{ borderColor: 'var(--color-warn)', background: 'var(--color-warn-soft)' }}
        >
          <div className="text-[13px] font-bold" style={{ color: 'var(--color-warn)' }}>
            旧版本任务
          </div>
          <div className="qs-meta mt-1" style={{ color: 'var(--color-ink-soft)' }}>
            本任务创建于工作流结构调整之前（停留在「{stageName}」），与新流程的阶段不对应，无法在新界面中继续操作。交付物与事件记录仍完整保留，可在「任务详情」查看；如需继续产出，请新建任务。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* 任务信息条（与电商共用组件；替代原「当前阶段 · 第 N/6 段」横幅）
          参考图来源统一：有上传图用上传图，没有用 AI 生成的首图 */}
      <TaskInfoBar
        platforms={task.platforms && task.platforms.length > 0 ? task.platforms.join(' / ') : task.platform || '—'}
        refThumbSrc={infoRef.src}
        refThumbName={infoRef.isUploaded ? '参考图' : infoRef.src ? 'AI 生成首图' : undefined}
        refThumbNote={
          infoRef.isUploaded
            ? '配图将基于参考图主体生成，主管校对自动核对比对'
            : infoRef.src
              ? '未提供参考图 · 已用 AI 生成首图作为参考'
              : '未提供参考图 · 配图由 Agent 按笔记内容生成'
        }
      />

      {/* 合规审核（自动节点）：紧跟当前阶段信息条展示，无决策按钮 */}
      {(() => {
        const cur = STAGES.indexOf(task.stage);
        const rIdx = STAGES.indexOf(XHS_STAGE_REVIEW);
        const rState: PanelState = task.column === 'done' || (rIdx >= 0 && cur > rIdx) ? 'done' : compliance ? 'done' : cur === rIdx ? 'working' : 'none';
        return <CompliancePanel data={compliance} state={rState} />;
      })()}

      {/* 第一行：选题方向 | 笔记文案（等宽并排） */}
      <div className="grid grid-cols-2 items-stretch gap-4">
        <div className="flex flex-col">
          {stTopic === 'none' ? <PendingCard label="选题策划" wait="任务确认后自动开始" /> : <TopicPanel topics={topics} state={stTopic} busy={busy} onDecide={doDecide} />}
        </div>
        <div className="flex flex-col">
          {stCopy === 'none' ? <PendingCard label="笔记撰写" wait="待选题确认后自动开始" /> : <NotePanel note={note} state={stCopy} busy={busy} onDecide={doDecide} />}
        </div>
      </div>

      {/* 第二行：首图设计 | 内页设计（等宽并排；首图 1 张确认后再生成内页） */}
      <div className="grid grid-cols-2 items-stretch gap-4">
        <div className="flex flex-col">
          {stCover === 'none' ? (
            <PendingCard label="首图设计" wait="待笔记确认后自动开始" />
          ) : (
            <ImagePanel
              imgs={coverImgs}
              title="首图设计"
              state={stCover}
              busy={busy}
              retrying={retrying}
              onDecide={doDecide}
              onRetry={doRetry}
              onZoom={(img: ParsedImg) => setPreview({ url: img.url, name: img.name })}
            />
          )}
        </div>
        <div className="flex flex-col">
          {stInner === 'none' ? (
            <PendingCard label="内页设计" wait="待首图确认后自动开始" />
          ) : (
            <ImagePanel
              imgs={innerImgs}
              title="内页设计"
              state={stInner}
              busy={busy}
              retrying={retrying}
              onDecide={doDecide}
              onRetry={doRetry}
              onZoom={(img: ParsedImg) => setPreview({ url: img.url, name: img.name })}
            />
          )}
        </div>
      </div>

      {/* 主管校对为自动节点：卡片在「任务详情」页顶部，此处不出卡片 */}

      {/* 底部紫色条（快捷操作，不替代内容卡内的逐项操作）：
          待确认 → 「一键采纳」右置（采纳后后端自动推进，紫条随之消失，无需重复操作）；
          交付阶段/已交付 → 「导出交付包」 */}
      {canOneClickAdopt ? (
        <div
          className="flex items-center gap-3 rounded-[4px] border px-3.5 py-3"
          style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-soft)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold" style={{ color: 'var(--color-signal-strong)' }}>
              待你确认 · {stageName}
            </div>
            <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-soft)' }}>
              在上方内容卡内逐项「采纳 / 打回」，全部采纳后自动进入下一阶段；失败可打回重做。
            </div>
          </div>
          <Btn variant="primary" className="shrink-0" disabled={busy} onClick={() => void oneClickAdopt()}>
            {busy ? '处理中…' : '一键采纳'}
          </Btn>
        </div>
      ) : null}

      {/* 交付阶段：主管校对通过后自动归档（自动节点），此处只提供导出 */}
      {!isDone && task.stage === XHS_STAGE_DELIVER ? (
        <div
          className="flex items-center gap-3 rounded-[4px] border px-3.5 py-3"
          style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-soft)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold" style={{ color: 'var(--color-signal-strong)' }}>
              交付归档中 · #{task.id}
            </div>
            <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-soft)' }}>
              主管校对已通过，正在归档。归档完成后可导出交付包（文案 + 全部已采纳图片）。
            </div>
          </div>
          <Btn variant="primary" className="shrink-0" disabled={packing} onClick={() => void download()}>
            {packing ? '打包中…' : '导出交付包'}
          </Btn>
        </div>
      ) : null}

      {isDone ? (
        <div
          className="flex items-center gap-3 rounded-[4px] border px-3.5 py-3"
          style={{ borderColor: 'var(--color-signal)', background: 'var(--color-signal-soft)' }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold" style={{ color: 'var(--color-signal-strong)' }}>
              已交付 · 任务 #{task.id}
            </div>
            <div className="qs-meta mt-0.5" style={{ color: 'var(--color-ink-soft)' }}>
              主管校对已通过，发布包与图片已归档。交付包 ZIP 内含文案与全部已采纳配图。
            </div>
          </div>
          <Btn variant="primary" className="shrink-0" disabled={packing} onClick={() => void download()}>
            {packing ? '打包中…' : '导出交付包'}
          </Btn>
        </div>
      ) : null}

      {/* 加载态：当前阶段生成中且无产出时的统一提示 */}
      {task.column === 'progress' ? (
        <div className="flex items-center gap-2">
          <Spinner label="Agent 推进中…" />
        </div>
      ) : null}

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          /* ui-rules-ignore 大图预览遮罩：规范允许的遮罩类语义色（AGENTS.md 二.5 例外） */
          style={{ background: 'rgba(10,10,10,0.72)' }}
          onClick={() => setPreview(null)}
        >
          <div className="relative max-h-full max-w-full" onClick={(e) => e.stopPropagation()}>
            <img
              src={preview.url}
              alt={preview.name}
              className="max-h-[76vh] max-w-full border object-contain"
              /* ui-rules-ignore 遮罩上元素描边：半透明白，属遮罩内配色（AGENTS.md 二.5 例外） */
              style={{ borderColor: 'rgba(255,255,255,0.25)' }}
            />
            <button type="button" className="qs-btn sm absolute -top-10 right-0" onClick={() => setPreview(null)}>
              ✕ 关闭
            </button>
            {/* ui-rules-ignore 遮罩上元信息文字：半透明白，属遮罩内配色（AGENTS.md 二.5 例外） */}
            <div className="qs-meta mt-2 text-center" style={{ color: 'rgba(255,255,255,0.72)' }}>
              {preview.name}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
