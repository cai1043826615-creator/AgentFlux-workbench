import { useState } from 'react';
import { WorkbenchProvider, useWorkbench } from './store/useWorkbench.tsx';
import { Badge, Btn, Field, Modal, ModalFooter } from './components/ui.tsx';
import { LeftPanel } from './features/LeftPanel.tsx';
import { ChatPanel } from './features/chat/ChatPanel.tsx';
import { WorkstationBar } from './features/workstation/WorkstationBar.tsx';
import { BoardView } from './features/board/BoardView.tsx';
import { TaskDetailView } from './features/status/TaskDetailView.tsx';
import { ObservabilityView } from './features/observability/ObservabilityView.tsx';

/** 顶栏（对齐线框 topbar：logo + 任务信号点 + 在岗 + 连接） */
function TopBar() {
  const { approvalQueue, connected, agents, backToBoard } = useWorkbench();
  const busyCount = agents.filter((a) => a.onlineStatus === 'busy').length;
  return (
    <header className="flex items-center gap-3 px-4 h-[52px] border-b shrink-0" style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}>
      <span className="flex h-7 w-7 items-center justify-center font-display text-[15px] font-bold text-white" style={{ background: 'var(--color-ink)' }}>
        电
      </span>
      <span className="font-display text-[17px] font-bold leading-none" style={{ fontFamily: 'var(--font-display)' }}>
        电商工作台
      </span>
      <span className="qs-meta hidden md:inline">MULTI-AGENT E-COMMERCE</span>
      <div className="flex-1" />
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
      <span className="qs-meta hidden sm:inline" style={{ color: 'var(--color-ink-soft)' }}>
        在岗 <span className="tabular font-semibold" style={{ color: 'var(--color-ink)' }}>{agents.length}</span>
        <span className="mx-1.5" style={{ color: 'var(--color-line-strong)' }}>|</span>
        <span className="qs-dot signal inline-block align-middle mr-1" title={busyCount ? '有 Agent 忙碌中' : '全部待命'} />
        忙碌 <span className="tabular font-semibold" style={{ color: 'var(--color-ink)' }}>{busyCount}</span>
      </span>
      <Badge tone={connected ? 'ok' : 'no'}>{connected ? '实时连接' : '离线'}</Badge>
    </header>
  );
}

/** 新建任务：两步弹窗（对齐线框 form → 确认内容 → 确认并开工） */
function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createTask } = useWorkbench();
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [platform, setPlatform] = useState('天猫+京东');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep('form');
    setTitle('');
    setDesc('');
    setPlatform('天猫+京东');
    onClose();
  };

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await createTask({ title: title.trim(), description: desc.trim(), platform: platform.trim() });
      reset();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal open title={step === 'form' ? '新建任务' : '确认任务内容'} onClose={reset} width={460}>
      {step === 'form' ? (
        <>
          <Field label="任务标题">
            <input className="qs-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：无线磁吸充电宝新品上架全套物料" autoFocus />
          </Field>
          <Field label="产品资料 / 任务描述">
            <textarea className="qs-input min-h-[90px]" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="品名/类目/卖点素材…" />
          </Field>
          <Field label="目标平台">
            <input className="qs-input" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="如：天猫+京东" />
          </Field>
          <Field label="工作流">
            <select className="qs-input" defaultValue="电商新品上架 · 6阶段（默认）">
              <option>电商新品上架 · 6阶段（默认）</option>
            </select>
          </Field>
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            提交后将展示任务内容摘要，<b>确认后 AI 才开工</b>
          </p>
          <ModalFooter>
            <Btn onClick={reset}>取消</Btn>
            <Btn variant="primary" onClick={() => setStep('confirm')} disabled={!title.trim()}>
              下一步：确认内容
            </Btn>
          </ModalFooter>
        </>
      ) : (
        <>
          <div className="rounded border px-3 py-2.5 space-y-1" style={{ borderColor: 'var(--color-line)' }}>
            <div className="text-[13px]"><b>标题：</b>{title}</div>
            <div className="text-[13px]"><b>描述：</b>{desc || '新品上架全套物料'}</div>
            <div className="text-[13px]"><b>平台：</b>{platform || '天猫+京东'}</div>
          </div>
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            确认后 AI 将开始工作（未确认前不会启动任何 Agent）
          </p>
          <ModalFooter>
            <Btn onClick={() => setStep('form')}>返回修改</Btn>
            <Btn variant="primary" onClick={submit} disabled={busy}>{busy ? '开工中…' : '确认并开工'}</Btn>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

function Shell() {
  const { view, selectedTaskId, backToBoard, openTask } = useWorkbench();
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [newOpen, setNewOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex flex-1 min-h-0">
        {/* 左栏（线框式：工作流 + 通用） */}
        {showLeft ? (
          <aside className="w-[220px] shrink-0 border-r overflow-y-auto" style={{ borderColor: 'var(--color-line)' }}>
            <LeftPanel onNew={() => setNewOpen(true)} onBack={backToBoard} />
            <button
              type="button"
              className="block w-full border-t py-2 qs-meta text-center"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
              onClick={() => setShowLeft(false)}
            >
              ◀ 折叠左栏
            </button>
          </aside>
        ) : (
          <div className="w-12 shrink-0 border-r flex items-start justify-center pt-3" style={{ borderColor: 'var(--color-line)' }}>
            <button type="button" className="qs-meta" style={{ color: 'var(--color-ink-soft)' }} title="展开左栏" onClick={() => setShowLeft(true)}>
              ▶
            </button>
          </div>
        )}

        {/* 中栏：工位栏（固定）+ 主视图 */}
        <main className="flex flex-1 min-w-0 flex-col p-4">
          <WorkstationBar />
          <div className="flex-1 min-h-0 overflow-auto">
            {view === 'board' && <BoardView onOpen={openTask} onNew={() => setNewOpen(true)} />}
            {view === 'task' && selectedTaskId != null && (
              <TaskDetailView key={selectedTaskId} taskId={selectedTaskId} onBack={backToBoard} onNotFound={backToBoard} />
            )}
            {view === 'observability' && <ObservabilityView />}
          </div>
        </main>

        {/* 右栏聊天（可折叠） */}
        {showRight ? (
          <aside className="w-[280px] shrink-0 border-l min-h-0" style={{ borderColor: 'var(--color-line)' }}>
            <ChatPanel />
            <button
              type="button"
              className="block w-full border-t py-1.5 qs-meta text-center"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-ink-soft)' }}
              onClick={() => setShowRight(false)}
            >
              ▶ 折叠聊天栏
            </button>
          </aside>
        ) : (
          <div className="w-12 shrink-0 border-l flex items-start justify-center pt-3" style={{ borderColor: 'var(--color-line)' }}>
            <button type="button" className="qs-meta" style={{ color: 'var(--color-ink-soft)' }} title="展开聊天栏" onClick={() => setShowRight(true)}>
              ◀
            </button>
          </div>
        )}
      </div>
      <NewTaskModal open={newOpen} onClose={() => setNewOpen(false)} />
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
