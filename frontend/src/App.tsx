import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { AgentOnlineStatus, TaskKbRefInput } from '@workbench/shared';
import { WorkbenchProvider, useWorkbench } from './store/useWorkbench.tsx';
import { Avatar, Badge, Btn, Field, Glyph, Modal, ModalFooter, type GlyphName } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { isAlertsEnabled, notificationPermission, onWindowFocus, requestNotificationPermission, setAlertsEnabled } from './lib/approval-notify.ts';
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
import { ToastHost } from './components/Toast.tsx';

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

/** 通知开关 + 权限入口（B9 · 13.1/12.5：状态存 localStorage；仅显式点击才申请权限） */
function NotifyControl() {
  const [enabled, setEnabled] = useState(() => isAlertsEnabled());
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission());
  const request = async () => {
    const r = await requestNotificationPermission();
    if (r) setPerm(r);
  };
  return (
    <span className="flex items-center gap-2">
      <label
        className="qs-meta flex cursor-pointer select-none items-center gap-1.5"
        title="待确认浏览器通知（本地保存，不落库）"
      >
        <input
          type="checkbox"
          className="h-3.5 w-3.5 accent-[var(--color-signal)]"
          aria-label="浏览器通知"
          checked={enabled}
          onChange={(e) => {
            const v = e.target.checked;
            setAlertsEnabled(v);
            setEnabled(v);
          }}
        />
      </label>
      {perm === 'default' ? (
        <Btn size="sm" variant="ghost" onClick={() => void request()}>
          开启通知
        </Btn>
      ) : perm === 'granted' ? (
        <Badge tone="ok">已授权</Badge>
      ) : perm === 'denied' ? (
        <Badge tone="no">已拒绝</Badge>
      ) : (
        <span className="qs-meta hidden md:inline" style={{ color: 'var(--color-ink-faint)' }}>
          浏览器不支持
        </span>
      )}
    </span>
  );
}

/** 顶栏（Quiet Signal 精简版：logo + 产品名 + 任务 + 通知开关 + 连接状态点） */
function TopBar() {
  const { approvalQueue, connected, backToBoard } = useWorkbench();
  return (
    <header className="flex items-center gap-3 px-4 h-[52px] border-b shrink-0" style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}>
      <img src="/logo.png" alt="logo" className="h-7 w-7 object-contain" style={{ imageRendering: 'auto' }} />
      <span className="font-display text-[17px] font-bold leading-none" style={{ fontFamily: 'var(--font-display)' }}>
        电商工作台
      </span>
      <div className="flex-1" />
      {/* B9 · 12.5/13.1：通知开关与权限入口（「任务」按钮附近） */}
      <NotifyControl />
      <button type="button" className="qs-btn sm ghost" onClick={backToBoard} style={{ position: 'relative' }}>
        任务
        {approvalQueue.length > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: 'var(--color-signal)' }}
          >
            {approvalQueue.length}
          </span>
        ) : null}
      </button>
      {/* 连接状态：仅保留状态点（色 + title 双通道，不依赖单一颜色） */}
      <span className={`qs-dot ${connected ? 'ok' : 'no'}`} title={connected ? '实时连接' : '离线'} />
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

/** 新建任务：三步弹窗（第1步 表单 → 第2步 关联知识库资料 → 第3步 确认摘要 → 确认并开工）
 *  第2步是板块 A/B 的唯一耦合点；知识库未连接时该步骤仅提示并可跳过，流程与既有完全一致。 */
function NewTaskModal() {
  const { createTask, newTask, closeNewTask } = useWorkbench();
  const open = newTask.open;
  const [step, setStep] = useState<'form' | 'kb' | 'confirm'>('form');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [refDataUrl, setRefDataUrl] = useState<string | null>(null);
  const [kbRefs, setKbRefs] = useState<TaskKbRefInput[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 打开时重置表单（无任何预填——热点不得预填新建任务表单）
  useEffect(() => {
    if (!open) return;
    setStep('form');
    setTitle('');
    setDesc('');
    setPlatforms([]);
    setRefDataUrl(null);
    setKbRefs([]);
    if (fileRef.current) fileRef.current.value = '';
  }, [open]);

  const canNext = title.trim() !== '' && platforms.length > 0 && refDataUrl !== null;

  const reset = () => {
    setStep('form');
    setTitle('');
    setDesc('');
    setPlatforms([]);
    setRefDataUrl(null);
    setKbRefs([]);
    if (fileRef.current) fileRef.current.value = '';
    closeNewTask();
  };

  const togglePlatform = (p: string) =>
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setRefDataUrl(String(reader.result));
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!canNext || busy) return;
    setBusy(true);
    try {
      let referenceImage: string | undefined = refDataUrl ?? undefined;
      // 优先上传换取 /uploads 地址；后端未实现（404 等）时回退为直接存 dataURL
      try {
        const { url } = await api.uploadImage(refDataUrl as string);
        if (url) referenceImage = url;
      } catch (err) {
        console.warn('[新建任务] 参考图上传失败，回退为 dataURL', err);
      }
      await createTask({ title: title.trim(), description: desc.trim(), platforms, referenceImage, kbRefs });
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
          <Field label="任务标题">
            <input className="qs-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：无线磁吸充电宝新品上架全套物料" autoFocus />
          </Field>
          <Field label="产品资料 / 任务描述">
            <textarea className="qs-input min-h-[90px]" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="品名/类目/卖点素材…" />
          </Field>
          <div className="mb-3">
            <span className="qs-label">目标平台（必填，可多选）</span>
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
            {platforms.length === 0 ? (
              <span className="qs-meta mt-1 block" style={{ color: 'var(--color-danger)' }}>
                ● 请至少选择一个目标平台
              </span>
            ) : null}
          </div>
          <Field label="参考图（必填，后续全部产出基于此图）">
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
          {canNext ? (
            <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
              提交后将展示任务内容摘要，<b>确认后 AI 才开工</b>
            </p>
          ) : (
            <p className="qs-meta mt-2" style={{ color: 'var(--color-danger)' }}>
              ● {!title.trim() ? '请先填写任务标题' : platforms.length === 0 ? '请至少选择一个目标平台' : '请上传参考图'}，方可进入下一步
            </p>
          )}
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
            <div className="text-[13px]"><b>标题：</b>{title}</div>
            <div className="text-[13px]"><b>描述：</b>{desc || '新品上架全套物料'}</div>
            <div className="text-[13px]"><b>平台：</b>{platforms.join(' / ')}</div>
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
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            确认后 AI 将开始工作（未确认前不会启动任何 Agent）
          </p>
          <ModalFooter>
            <Btn onClick={() => setStep('kb')}>返回修改</Btn>
            <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? '开工中…' : '确认并开工'}</Btn>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function Shell() {
  const { view, selectedTaskId, backToBoard, openTask, agents, chatTarget, selectChat, setView, openNewTask } = useWorkbench();
  const [showLeft, setShowLeft] = useState(true);
  // 右栏聊天面板默认收起：首屏把横向空间让给主视图（可随时展开）
  const [showRight, setShowRight] = useState(false);
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
              {/* 知识库分区：与展开态逐项对应 */}
              <span className="qs-meta mb-0.5" style={{ color: 'var(--color-ink-faint)' }}>知识库</span>
              <RailIcon glyph="box" title="知识库 · 浏览与检索" active={view === 'knowledge'} onClick={openLeftKnowledge} />
              <RailIcon glyph="graph" title="知识星图 · 知识关联图谱" active={view === 'knowledge-graph'} onClick={openLeftKnowledgeGraph} />
              <RailIcon glyph="trend" title="每日热点 · 电商关注域" active={view === 'hot'} onClick={openLeftHot} />
              <div className="my-1.5 w-6 border-t" style={{ borderColor: 'var(--color-line-strong)' }} />
              {/* 工作流分区（占位项展示但不可点，与展开态一致） */}
              <span className="qs-meta mb-0.5" style={{ color: 'var(--color-ink-faint)' }}>工作流</span>
              <RailIcon glyph="flow" title="电商工作流 · 看板" active={workflowActive} onClick={openLeftFlow} />
              <RailIcon glyph="box" title="直播带货上架（占位）" disabled />
              <RailIcon glyph="box" title="跨境选品（占位）" disabled />
              <div className="my-1.5 w-6 border-t" style={{ borderColor: 'var(--color-line-strong)' }} />
              <span className="qs-meta mb-0.5" style={{ color: 'var(--color-ink-faint)' }}>通用</span>
              <RailIcon glyph="pulse" title="Agent 状态" active={view === 'observability'} onClick={openLeftObservability} />
              <RailIcon glyph="gear" title="设置 · 编排模式" onClick={openLeftSettings} />
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

        {/* 中栏：工位栏（仅看板页常驻，意见2）+ 主视图 */}
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
                    title={`${a.name} · ${AGENT_STATUS[a.onlineStatus]}`}
                    onClick={() => openPrivate(a.id)}
                  >
                    <span className="relative" style={{ outline: active ? '2px solid var(--color-signal)' : 'none', outlineOffset: 2, borderRadius: 999 }}>
                      <Avatar name={a.name} id={a.id} size={32} />
                      <span className={`qs-dot absolute -bottom-0.5 -right-0.5 ${AGENT_DOT[a.onlineStatus]}`} style={{ boxShadow: '0 0 0 2px var(--color-surface)' }} />
                    </span>
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
      <ToastHost />
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
