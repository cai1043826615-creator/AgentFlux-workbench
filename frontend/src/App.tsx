import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isXhsWorkflow, type AgentOnlineStatus, type TaskKbRefInput } from '@workbench/shared';
import { WorkbenchProvider, useWorkbench } from './store/useWorkbench.tsx';
import { Avatar, Badge, Btn, Field, Glyph, Modal, ModalFooter, type GlyphName } from './components/ui.tsx';
import { AvatarStatus } from './components/AvatarStatus.tsx';
import { api } from './lib/api.ts';
import { onWindowFocus } from './lib/approval-notify.ts';
import { LeftPanel } from './features/LeftPanel.tsx';
import { ChatPanel } from './features/chat/ChatPanel.tsx';
import { WorkstationBar } from './features/workstation/WorkstationBar.tsx';
import { BoardView } from './features/board/BoardView.tsx';
import { TaskDetailView } from './features/status/TaskDetailView.tsx';
import { ObservabilityView } from './features/observability/ObservabilityView.tsx';
import { KnowledgeView } from './features/knowledge/KnowledgeView.tsx';
import { KnowledgeGraphView } from './features/knowledge/KnowledgeGraphView.tsx';
import { HotView } from './features/knowledge/HotView.tsx';
import { KbRefPicker } from './features/knowledge/KbRefPicker.tsx';
import { ToastHost, ActionToastStack } from './components/Toast.tsx';
import { DocPreviewModal } from './components/DocPreviewModal.tsx';

/** 折叠态头像列：状态点/文案映射（与 ChatPanel 顶部头像一致） */
const AGENT_DOT: Record<AgentOnlineStatus, string> = {
  busy: 'busy',
  idle: 'idle',
  online: 'ok',
  unconfigured: 'no',
};
const AGENT_STATUS: Record<AgentOnlineStatus, string> = {
  busy: '忙碌中',
  idle: '待命',
  online: '在线',
  unconfigured: '未连接API',
};

/** 栏宽拖拽约束（意见4：最小 120 / 最大 420） */
const PANEL_MIN = 120;
const PANEL_MAX = 420;

/** 顶栏（Quiet Signal 精简版：logo + 产品名 + 任务 + 连接状态点）
 *  P1·3.1：通知授权控件已移入「运行设置 → 通知」分区，顶栏不再渲染。
 *  P1·3.5：任务角标改为有含义文案「N 待确认」，不再是裸数字。 */
function TopBar() {
  const { connected, reconnect, backToBoard, tasks } = useWorkbench();
  // 待确认角标从任务派生（column === 'awaiting' 且未归档，与 applyTaskFilters 口径一致），
  // 确保与看板「待确认」列数字一致（不再用 WS 推送的 approvalQueue；归档任务不参与主视图计数）
  const pendingCount = tasks.filter((t) => t.column === 'awaiting' && !t.archived).length;
  return (
    <header className="flex items-center gap-3 px-4 h-[52px] border-b shrink-0" style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}>
      <img src="/logo.png" alt="logo" className="h-7 w-7 object-contain" style={{ imageRendering: 'auto' }} />
      <span className="font-display text-[17px] font-bold leading-none" style={{ fontFamily: 'var(--font-display)' }}>
        电商工作台
      </span>
      <div className="flex-1" />
      <Btn size="sm" variant="ghost" onClick={backToBoard} title="回到任务看板">
        任务
      </Btn>
      {pendingCount > 0 ? (
        <span className="qs-meta inline-flex items-center gap-1.5" style={{ color: 'var(--color-signal-strong)' }} title="全部工作流的待确认任务数（含当前看板列，口径与看板列一致）">
          <span className="tabular font-semibold">{pendingCount}</span> 待确认（全部工作流）
        </span>
      ) : null}
      {/* 连接状态：Connected 时只留安静的状态点；断开才升级为可点击的重连徽章（与聊天框共用同一状态） */}
      {connected ? (
        <span className="qs-dot ok" title="实时连接" />
      ) : (
        <Btn size="sm" variant="danger" title="已断开 · 点击立即重连" onClick={reconnect}>
          已断开 · 点击重连
        </Btn>
      )}
    </header>
  );
}

/** 可选目标平台（多选） */
const PLATFORM_OPTIONS = ['天猫', '京东', '拼多多', '抖音小店', '小红书', '其他'];

/**
 * 折叠态图标列单项：与展开态左栏的选项逐项一一对应。
 * disabled 用于占位项（直播带货上架 / 跨境选品）——展示位置但不可点，与展开态的置灰占位一致。
 */
function RailIcon({ glyph, title, active, disabled, onClick }: { glyph: GlyphName; title: string; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      className={`qs-rail-icon ${active ? 'active' : ''}`}
      title={title}
      aria-label={title}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Glyph name={glyph} size={18} />
    </button>
  );
}

/** 新建任务：三步弹窗（第1步 表单 → 第2步 关联知识库资料 → 第3步 确认摘要 → 确认创建任务）
 *  第2步是板块 A/B 的唯一耦合点；知识库未连接时该步骤仅提示并可跳过，流程与既有完全一致。 */
function NewTaskModal() {
  const { createTask, newTask, closeNewTask, workflows, currentWorkflowId } = useWorkbench();
  const open = newTask.open;
  const [step, setStep] = useState<'form' | 'kb' | 'confirm'>('form');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [refDataUrl, setRefDataUrl] = useState<string | null>(null);
  const [kbRefs, setKbRefs] = useState<TaskKbRefInput[]>([]);
  const [busy, setBusy] = useState(false);
  /** 所选工作流（打开时预置为左栏当前工作流） */
  const [workflowId, setWorkflowId] = useState<string>(currentWorkflowId);
  /** 小红书专属字段（电商不使用 → brief 传 null，不影响既有链路） */
  const [contentType, setContentType] = useState<string>('种草安利');
  const [audience, setAudience] = useState('');
  const [product, setProduct] = useState('');
  /** 配图数量（总数，含首图；2-7，默认 3）——首图固定 1 张，内页图 = 该值 − 1 */
  const [imageCount, setImageCount] = useState(3);
  // §6.3：校验提示仅在用户交互后出现，避免"打开即满屏红字"
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isXhs = isXhsWorkflow(workflowId);
  /** 切换工作流时重置专属字段，避免电商/小红书字段互相污染 */
  const switchWorkflow = (id: string) => {
    setWorkflowId(id);
    setContentType('种草安利');
    setAudience('');
    setProduct('');
    setImageCount(3);
  };

  // 打开时重置表单（无任何预填——热点不得预填新建任务表单）
  useEffect(() => {
    if (!open) return;
    setStep('form');
    setTitle('');
    setDesc('');
    setPlatforms([]);
    setRefDataUrl(null);
    setKbRefs([]);
    setTouched(false);
    setWorkflowId(currentWorkflowId); // 每次打开同步左栏当前工作流
    if (fileRef.current) fileRef.current.value = '';
  }, [open]);

  // 小红书：平台天然是小红书（表单不显示该字段），参考图允许留空（纯文字起号）
  // 电商：平台必选 + 参考图必传（原行为不变）
  const canNext = title.trim() !== '' && (isXhs || platforms.length > 0) && (isXhs || refDataUrl !== null);
  /** 实际提交的平台：小红书固定为「小红书」，电商取用户勾选 */
  const effectivePlatforms = isXhs ? ['小红书'] : platforms;

  const reset = () => {
    setStep('form');
    setTitle('');
    setDesc('');
    setPlatforms([]);
    setRefDataUrl(null);
    setKbRefs([]);
    setTouched(false);
    if (fileRef.current) fileRef.current.value = '';
    closeNewTask();
  };

  const togglePlatform = (p: string) => {
    setTouched(true);
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    setTouched(true);
    const reader = new FileReader();
    reader.onload = () => setRefDataUrl(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!canNext || busy) return;
    setBusy(true);
    try {
      let referenceImage: string | undefined = refDataUrl ?? undefined;
      // 优先上传换取 /uploads 地址；后端未实现（404 等）时回退为直接存 dataURL。
      // report-driven-fixes 1.5（D-06）：未选参考图（小红书工作流允许无图）时不发带空图的 400 请求。
      if (refDataUrl) {
        try {
          const { url } = await api.uploadImage(refDataUrl);
          if (url) referenceImage = url;
        } catch (err) {
          console.warn('[新建任务] 参考图上传失败，回退为 dataURL', err);
        }
      }
      // 仅在小红书工作流带 brief；电商固定为 null，后端链路不变
      const brief = isXhs ? { contentType, audience: audience.trim() || undefined, product: product.trim() || undefined, imageCount } : null;
      await createTask({ title: title.trim(), description: desc.trim(), platforms: effectivePlatforms, referenceImage, kbRefs, workflowId, brief });
      reset();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const stepTitle = step === 'form' ? '新建任务' : step === 'kb' ? '关联知识库资料' : '确认任务内容';
  return (
    <Modal open title={stepTitle} onClose={reset} width={460}>
      {step === 'form' ? (
        <>
          {/* 工作流只读展示：跟随左栏当前选择，弹窗内不再切换（用户定案：只显示当前工作流） */}
          <div
            className="mb-3 flex items-center gap-2 rounded-[4px] border px-3 py-2"
            style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}
          >
            <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>工作流</span>
            <span className="text-[13px] font-medium">{workflows.find((w) => w.id === workflowId)?.name ?? workflowId}</span>
            <span className="qs-meta min-w-0 flex-1 truncate" style={{ color: 'var(--color-ink-faint)' }}>
              {(workflows.find((w) => w.id === workflowId)?.nodes ?? []).map((n) => n.label).join(' → ')}
            </span>
          </div>
          {isXhs ? (
            <>
              <Field label="笔记主题" required>
                <input className="qs-input" value={title} onChange={(e) => { setTouched(true); setTitle(e.target.value); }} placeholder="如：办公室即溶咖啡真实体验分享" autoFocus />
              </Field>
              <Field label="内容类型">
                <select className="qs-input" value={contentType} onChange={(e) => setContentType(e.target.value)}>
                  {['种草安利', '测评对比', '干货教程', '好物合集', '平替推荐'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="产品 / 品牌（选填）">
                <input className="qs-input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="如：某品牌即溶咖啡" />
              </Field>
              <Field label="目标人群（选填）">
                <input className="qs-input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="如：18-30 上班族、学生党" />
              </Field>
              <Field label="配图数量">
                <select className="qs-input" value={imageCount} onChange={(e) => setImageCount(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>{n} 张</option>
                  ))}
                </select>
                <span className="qs-meta mt-1 block" style={{ color: 'var(--color-ink-faint)' }}>
                  总数含首图：首图固定 1 张，内页图 {imageCount - 1} 张；确认首图后再生成内页图
                </span>
              </Field>
              <Field label="笔记要求 / 卖点素材">
                <textarea className="qs-input min-h-[90px]" value={desc} onChange={(e) => { setTouched(true); setDesc(e.target.value); }} placeholder="想突出的卖点、真实体验、避免提到的点…" />
              </Field>
            </>
          ) : (
            <>
              <Field label="任务标题" required>
                <input className="qs-input" value={title} onChange={(e) => { setTouched(true); setTitle(e.target.value); }} placeholder="如：无线磁吸充电宝新品上架全套物料" autoFocus />
              </Field>
              <Field label="产品资料 / 任务描述">
                <textarea className="qs-input min-h-[90px]" value={desc} onChange={(e) => { setTouched(true); setDesc(e.target.value); }} placeholder="品名/类目/卖点素材…" />
              </Field>
            </>
          )}
          {/* 目标平台：小红书工作流不需要（平台天然就是小红书），仅在电商工作流显示 */}
          {isXhs ? null : (
            <div className="mb-3">
              <span className="qs-label">
                目标平台（可多选）
                <span aria-hidden="true" style={{ color: 'var(--color-danger)', marginLeft: 3 }} title="必填">*</span>
              </span>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {PLATFORM_OPTIONS.map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-1.5 text-[13px] select-none">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-[var(--color-signal)]"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                  />
                  {p}
                </label>
              ))}
            </div>
            </div>
          )}
          <Field label={isXhs ? '参考图（选填，有图更像真实分享）' : '参考图（后续全部产出基于此图）'} required={!isXhs}>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
            <div className="flex items-center gap-3">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border"
                style={{ borderColor: 'var(--color-line-strong)', background: 'var(--color-sunken)' }}
              >
                {refDataUrl ? <img src={refDataUrl} alt="参考图预览" className="h-full w-full object-cover" /> : <span className="qs-meta">无图</span>}
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <Btn size="sm" onClick={() => fileRef.current?.click()}>
                  选择图片
                </Btn>
                {refDataUrl ? (
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRefDataUrl(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                  >
                    移除图片
                  </Btn>
                ) : null}
                <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>PNG / JPG，上传后由本地代理转存</span>
              </div>
            </div>
          </Field>
          <p className="qs-meta mt-2" style={{ color: touched && !canNext ? 'var(--color-danger)' : 'var(--color-ink-faint)' }}>
            {touched && !canNext ? (
              `● ${!title.trim() ? (isXhs ? '请先填写笔记主题' : '请先填写任务标题') : !isXhs && platforms.length === 0 ? '请至少选择一个目标平台' : '请上传参考图'}，方可进入下一步`
            ) : (
              /* report-driven-fixes 1.4（D-05）：建单行为 = 任务进入「规划中」待确认，并非立即开工；
                 文案与行为对齐，不再说「确认后 AI 才开工」 */
              <>提交后将展示任务内容摘要，<b>确认创建后进入「规划中」</b></>
            )}
          </p>
          <ModalFooter>
            <Btn onClick={reset}>取消</Btn>
            <Btn variant="primary" onClick={() => setStep('kb')} disabled={!canNext}>
              下一步：关联知识库资料
            </Btn>
          </ModalFooter>
        </>
      ) : step === 'kb' ? (
        <>
          <KbRefPicker value={kbRefs} onChange={setKbRefs} />
          <p className="qs-meta mt-3" style={{ color: 'var(--color-ink-faint)' }}>
            关联的资料会在 Agent 生成时作为只读事实参考注入上下文；本步骤可选，直接跳过不影响开工。
          </p>
          <ModalFooter>
            <Btn onClick={() => setStep('form')}>返回修改</Btn>
            <Btn variant="primary" onClick={() => setStep('confirm')}>
              下一步：确认内容
            </Btn>
          </ModalFooter>
        </>
      ) : (
        <>
          <div className="rounded border px-3 py-2.5 space-y-1.5" style={{ borderColor: 'var(--color-line)' }}>
            {isXhs ? (
              <>
                <div className="text-[13px]"><b>笔记主题：</b>{title}</div>
                <div className="text-[13px]">
                  <b>内容类型：</b>{contentType}
                  {product.trim() ? ` · 产品：${product.trim()}` : ''}
                  {audience.trim() ? ` · 人群：${audience.trim()}` : ''}
                  {` · 配图：共 ${imageCount} 张（首图 1 + 内页 ${imageCount - 1}）`}
                </div>
                <div className="text-[13px]"><b>笔记要求：</b>{desc || '（未填写，按主题自由发挥）'}</div>
              </>
            ) : (
              <div className="text-[13px]"><b>标题：</b>{title}</div>
            )}
            <div className="text-[13px]">
              <b>工作流：</b>
              {workflows.find((w) => w.id === workflowId)?.name ?? workflowId}
            </div>
            {isXhs ? null : <div className="text-[13px]"><b>描述：</b>{desc || '新品上架全套物料'}</div>}
            <div className="text-[13px]"><b>平台：</b>{effectivePlatforms.join(' / ')}</div>
            <div className="flex items-center gap-2 text-[13px]">
              <b>参考图：</b>
              {refDataUrl ? (
                <img src={refDataUrl} alt="参考图" className="h-12 w-12 border object-cover" style={{ borderColor: 'var(--color-line-strong)' }} />
              ) : (
                <span className="qs-meta" style={{ color: 'var(--color-danger)' }}>未上传</span>
              )}
            </div>
            <div className="text-[13px]">
              <b>关联资料：</b>
              {kbRefs.length === 0 ? (
                <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>未关联</span>
              ) : (
                <span>{kbRefs.length} 份（{kbRefs.map((r) => (r.anchor ? `章节「${r.anchor}」` : '整篇')).join(' / ')}）</span>
              )}
            </div>
          </div>
          {/* report-driven-fixes 1.4（D-05）：建单行为 = 任务进入「规划中」列待确认（POST /api/tasks 建 planned 列，
              仅看板「确认开工」才真正启动 Agent）；文案与行为对齐 */}
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            确认后任务将进入「规划中」，需在任务看板点击「确认开工」后 AI 才会开始工作
          </p>
          <ModalFooter>
            <Btn onClick={() => setStep('kb')}>返回修改</Btn>
            <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? '创建中…' : '确认创建任务'}</Btn>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function Shell() {
  const { view, selectedTaskId, backToBoard, openTask, agents, chatTarget, selectChat, setView, openNewTask, workflows, currentWorkflowId, setCurrentWorkflowId, chatPanelOpen, setChatPanelOpen } = useWorkbench();
  const [showLeft, setShowLeft] = useState(true);
  // 右栏聊天面板展开状态提升到 store（第三方复核 P2 修复）：知识库「和依依对话」按钮需要远程展开面板，
  // 因此这里不再持有本地 state，改为引用 store 的 chatPanelOpen / setChatPanelOpen。
  const showRight = chatPanelOpen;
  const setShowRight = setChatPanelOpen;
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(280);
  const [settingsSignal, setSettingsSignal] = useState(0);

  // B9 · 12.7/12.8：窗口聚焦 → 复位标题并停止闪烁定时器
  useEffect(() => {
    const onFocus = () => onWindowFocus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  /** 拖拽改栏宽（pointerdown 后挂 document 级 move/up，主区自适应，夹 120~420） */
  const startResize = (side: 'left' | 'right') => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = side === 'left' ? leftWidth : rightWidth;
    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(PANEL_MIN, Math.min(PANEL_MAX, side === 'left' ? startWidth + delta : startWidth - delta));
      if (side === 'left') setLeftWidth(next);
      else setRightWidth(next);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const workflowActive = view === 'board' || view === 'task';
  const isGroupChat = chatTarget.kind === 'group';

  /** 左栏折叠态图标：跳转/行为 + 同时展开左栏 */
  const openLeftFlow = () => {
    backToBoard();
    setShowLeft(true);
  };
  const openLeftObservability = () => {
    setView('observability');
    setShowLeft(true);
  };
  const openLeftKnowledge = () => {
    setView('knowledge');
    setShowLeft(true);
  };
  const openLeftKnowledgeGraph = () => {
    setView('knowledge-graph');
    setShowLeft(true);
  };
  const openLeftHot = () => {
    setView('hot');
    setShowLeft(true);
  };
  const openLeftSettings = () => {
    setShowLeft(true);
    setSettingsSignal((n) => n + 1);
  };

  /** 右栏折叠态头像：展开右栏 + 切换会话 */
  const openGroup = () => {
    selectChat({ kind: 'group', to: '全体' });
    setShowRight(true);
  };
  const openPrivate = (id: string) => {
    selectChat({ kind: 'private', to: id });
    setShowRight(true);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        {/* 左栏（知识库 + 工作流 + 通用）；展开态可拖宽，折叠态为图标列（分组顺序与展开态一致） */}
        {showLeft ? (
          <aside className="relative flex shrink-0 flex-col border-r" style={{ borderColor: 'var(--color-line)', width: leftWidth }}>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <LeftPanel onNew={() => openNewTask()} onBack={backToBoard} openSettingsSignal={settingsSignal} />
            </div>
            <button
              type="button"
              className="block w-full shrink-0 border-t py-2 qs-meta text-center cursor-pointer"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
              onClick={() => setShowLeft(false)}
            >
              ◀ 折叠
            </button>
            <div className="qs-resize-handle" style={{ right: -3 }} title="拖动调整左栏宽度" onPointerDown={startResize('left')} />
          </aside>
        ) : (
          <div className="flex w-12 shrink-0 flex-col items-center overflow-y-auto border-r py-3" style={{ borderColor: 'var(--color-line)' }}>
            <div className="flex flex-col items-center gap-1">
              {/* 38：分组标签不再常驻显示，改由各图标 tooltip 承载（分隔线保留分组语义） */}
              {/* 知识库分区：与展开态逐项对应 */}
              <RailIcon glyph="box" title="知识库 · 浏览与检索" active={view === 'knowledge'} onClick={openLeftKnowledge} />
              <RailIcon glyph="graph" title="知识库 · 知识星图" active={view === 'knowledge-graph'} onClick={openLeftKnowledgeGraph} />
              <RailIcon glyph="trend" title="知识库 · 每日热点" active={view === 'hot'} onClick={openLeftHot} />
              <div className="my-1.5 w-6 border-t" style={{ borderColor: 'var(--color-line-strong)' }} />
              {/* 工作流分区（report-driven-fixes 2.12 D-30：不再硬编码占位，由 workflows.map() 派生，与展开态同源；
                  首个=当前工作流看板，其余=点击直接切到该工作流并回到看板） */}
              {workflows.map((wf, i) => (
                <RailIcon
                  key={wf.id}
                  glyph="flow"
                  title={i === 0 ? `工作流 · ${wf.name}看板` : `工作流 · ${wf.name}`}
                  active={workflowActive && wf.id === currentWorkflowId}
                  onClick={() => {
                    if (wf.id !== currentWorkflowId) setCurrentWorkflowId(wf.id);
                    openLeftFlow();
                  }}
                />
              ))}
              <div className="my-1.5 w-6 border-t" style={{ borderColor: 'var(--color-line-strong)' }} />
              <RailIcon glyph="pulse" title="通用 · Agent 状态" active={view === 'observability'} onClick={openLeftObservability} />
              <RailIcon glyph="gear" title="通用 · 设置 · 编排模式" onClick={openLeftSettings} />
            </div>
            <button
              type="button"
              className="qs-meta qs-clickable mt-auto flex flex-col items-center gap-1 transition-colors"
              style={{ color: 'var(--color-ink-soft)' }}
              title="展开左栏"
              onClick={() => setShowLeft(true)}
            >
              <span aria-hidden="true" className="text-[12px] leading-none">▶</span>
              <span>展开</span>
            </button>
          </div>
        )}

        {/* 中栏：工位栏（仅任务看板常驻，意见2）+ 主视图 */}
        <main className="flex flex-1 min-w-0 flex-col p-4">
          {view === 'board' && <WorkstationBar />}
          <div className="flex-1 min-h-0 overflow-auto">
            {view === 'board' && <BoardView onOpen={openTask} onNew={() => openNewTask()} />}
            {view === 'task' && selectedTaskId != null && (
              <TaskDetailView key={selectedTaskId} taskId={selectedTaskId} onBack={backToBoard} onNotFound={backToBoard} />
            )}
            {view === 'observability' && <ObservabilityView />}
            {view === 'knowledge' && <KnowledgeView />}
            {view === 'knowledge-graph' && <KnowledgeGraphView />}
            {view === 'hot' && <HotView />}
          </div>
        </main>

        {/* 右栏聊天（可折叠）；展开态可拖宽，折叠态为头像列 */}
        {showRight ? (
          <aside className="relative flex shrink-0 flex-col border-l min-h-0" style={{ borderColor: 'var(--color-line)', width: rightWidth }}>
            <div className="min-h-0 flex-1">
              <ChatPanel />
            </div>
            <button
              type="button"
              className="block w-full shrink-0 border-t py-2 qs-meta text-center cursor-pointer"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
              onClick={() => setShowRight(false)}
            >
              ▶ 折叠
            </button>
            <div className="qs-resize-handle" style={{ left: -3 }} title="拖动调整右栏宽度" onPointerDown={startResize('right')} />
          </aside>
        ) : (
          <div className="flex w-12 shrink-0 flex-col items-center border-l py-3" style={{ borderColor: 'var(--color-line)' }}>
            <div className="flex flex-col items-center gap-3">
              {/* 电商工作群头像（h-8 w-8 圆头像；当前群聊用紫 outline 选中态；hover 浅紫/缩放/阴影） */}
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 hover:scale-105 hover:bg-[var(--color-signal-soft)] hover:shadow-md"
                title="电商工作群 · 事件与协作播报汇集于此"
                onClick={openGroup}
              >
                <span
                  className="block h-8 w-8 overflow-hidden rounded-full"
                  style={{ outline: isGroupChat ? '2px solid var(--color-signal)' : 'none', outlineOffset: 2 }}
                >
                  <img src="/groups/ecom.png" alt="电商工作群" className="h-full w-full object-cover" />
                </span>
              </button>
              {agents.map((a) => {
                const active = !isGroupChat && chatTarget.to === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 hover:scale-105 hover:bg-[var(--color-signal-soft)] hover:shadow-md"
                    title={`${a.name}（${a.role}）· ${AGENT_STATUS[a.onlineStatus]}`}
                    onClick={() => openPrivate(a.id)}
                  >
                    <AvatarStatus
                      active={active}
                      name={a.name}
                      id={a.id}
                      size={32}
                      statusClass={AGENT_DOT[a.onlineStatus]}
                      avatarTitle={`${a.name}（${a.role}）· ${AGENT_STATUS[a.onlineStatus]}`}
                    />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="qs-meta qs-clickable mt-auto flex flex-col items-center gap-1 transition-colors"
              style={{ color: 'var(--color-ink-soft)' }}
              title="展开聊天栏"
              onClick={() => setShowRight(true)}
            >
              <span aria-hidden="true" className="text-[12px] leading-none">◀</span>
              <span>展开</span>
            </button>
          </div>
        )}
      </div>
      <NewTaskModal />
      <DocPreviewModal />
      <ToastHost />
      <ActionToastStack />
    </div>
  );
}

export default function App() {
  return (
    <WorkbenchProvider>
      <Shell />
    </WorkbenchProvider>
  );
}
