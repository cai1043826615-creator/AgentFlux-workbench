import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WORKFLOW_STAGE_LABELS, type Agent, type Deliverable, type Message, type Task, type TaskCreateInput, type TaskEvent, type WSServerMessage } from '@workbench/shared';
import { api } from '../lib/api.ts';
import { connectWs } from '../lib/ws.ts';
import { mergeTaskUpdate, taskWithMeta, type TaskWithMeta } from '../lib/taskMerge.ts';
import type { TaskFilters } from '../lib/taskFilters.ts';
import { DEFAULT_FILTERS } from '../lib/taskFilters.ts';
import { handleApprovalPrompt, syncPendingTaskIds } from '../lib/approval-notify.ts';

export type { TaskWithMeta } from '../lib/taskMerge.ts';

export type WorkbenchView = 'board' | 'task' | 'observability' | 'knowledge' | 'knowledge-graph' | 'hot';
export type TaskTab = 'detail' | 'deliver';
export type ChatTarget = { kind: 'group'; to: string } | { kind: 'private'; to: string };
/** 看板 / 列表 视图切换（B5 · 5.1） */
export type BoardMode = 'board' | 'list';

/** 新建任务弹窗状态（打开/关闭；表单内容由弹窗内部管理，无外部预填） */
export interface NewTaskState {
  open: boolean;
}

/** Agent 渠道配置状态（后端 isAgentConfigured 权威判定：面板 key 或 .env 默认渠道回退） */
export type AgentWithChannel = Agent & { channelConfigured: boolean };

interface WorkbenchState {
  tasks: TaskWithMeta[];
  agents: AgentWithChannel[];
  connected: boolean;
  /** 手动重连 WS（顶栏状态徽章与聊天框共用同一 connected 状态，避免各处判断不一致） */
  reconnect: () => void;
  view: WorkbenchView;
  selectedTaskId: number | null;
  taskTab: TaskTab;
  chatTarget: ChatTarget;
  messages: Message[];
  deliverablesByTask: Record<number, Deliverable[]>;
  eventsByTask: Record<number, TaskEvent[]>;
  approvalQueue: { taskId: number; stage: string; title: string }[];
  settings: Record<string, unknown>;
  loading: boolean;
  /** 知识库阅读定位（星图/任务详情跳转原文用） */
  kbDocPath: string | null;
  /** 星图选中节点 id */
  kbNodeId: string | null;
  /** 新建任务弹窗（含热点预填） */
  newTask: NewTaskState;
  /** 看板/列表 视图与筛选（B5；跨视图保留，5.3） */
  boardMode: BoardMode;
  filters: TaskFilters;
  refresh: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<Task>;
  confirmTask: (id: number) => Promise<void>;
  decide: (taskId: number, kind: 'copy' | 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, note?: string) => Promise<void>;
  review: (taskId: number, decision: 'pass' | 'rollback', targetStage?: string, note?: string) => Promise<void>;
  /** 单张图片重试（B11）：只重新生成目标 failed 图；错误（非失败图/超上限）抛给调用方展示 */
  retryImage: (taskId: number, imageId: string) => Promise<void>;
  archiveTask: (id: number) => Promise<void>;
  restoreTask: (id: number) => Promise<void>;
  sendChat: (body: string) => void;
  selectChat: (target: ChatTarget) => void;
  setView: (v: WorkbenchView) => void;
  /** 打开知识库并定位到指定文档阅读 */
  openKbDoc: (path: string | null) => void;
  setKbNodeId: (id: string | null) => void;
  openNewTask: () => void;
  closeNewTask: () => void;
  openTask: (id: number) => void;
  backToBoard: () => void;
  setTaskTab: (t: TaskTab) => void;
  setBoardMode: (m: BoardMode) => void;
  setFilters: (f: TaskFilters) => void;
  clearFilters: () => void;
}

const VIEWS: WorkbenchView[] = ['board', 'task', 'observability', 'knowledge', 'knowledge-graph', 'hot'];
function viewFromHash(): { view: WorkbenchView; taskId: number | null } {
  const h = location.hash.replace('#/', '');
  if (h.startsWith('task/')) {
    const id = Number(h.slice(5));
    return { view: 'task', taskId: Number.isFinite(id) ? id : null };
  }
  return { view: (VIEWS as string[]).includes(h) ? (h as WorkbenchView) : 'board', taskId: null };
}

const Ctx = createContext<WorkbenchState | null>(null);

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [agents, setAgents] = useState<AgentWithChannel[]>([]);
  const [connected, setConnected] = useState(false);
  const [initialHash] = useState(viewFromHash);
  const [view, setViewState] = useState<WorkbenchView>(initialHash.view);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(initialHash.taskId);
  const [taskTab, setTaskTabState] = useState<TaskTab>('detail');
  const [chatTarget, setChatTarget] = useState<ChatTarget>({ kind: 'group', to: '全体' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [deliverablesByTask, setDeliverablesByTask] = useState<Record<number, Deliverable[]>>({});
  const [eventsByTask, setEventsByTask] = useState<Record<number, TaskEvent[]>>({});
  const [approvalQueue, setApprovalQueue] = useState<{ taskId: number; stage: string; title: string }[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [kbDocPath, setKbDocPath] = useState<string | null>(null);
  const [kbNodeId, setKbNodeId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<NewTaskState>({ open: false });
  const [boardMode, setBoardModeState] = useState<BoardMode>('board');
  const [filters, setFiltersState] = useState<TaskFilters>(DEFAULT_FILTERS);
  const wsRef = useRef<(() => void) | null>(null);
  /** 供 WS 回调读取最新任务列表（避免闭包过期）：取任务标题用于通知与 Toast */
  const tasksRef = useRef<TaskWithMeta[]>([]);
  /** 最近一次「本应用自己写入」的 hash：用于让 hashchange 回绑跳过自触发，避免重复拉取任务详情 */
  const appliedHashRef = useRef<string>('');
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const upsertTask = useCallback((task: Task) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = mergeTaskUpdate(next[idx], task);
        return next;
      }
      return [taskWithMeta(task), ...prev];
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [t, a, s] = await Promise.all([api.listTasks(), api.listAgents(), api.getSettings()]);
      setTasks(t.tasks);
      setAgents(a.agents);
      setSettings(s);
    } finally {
      setLoading(false);
    }
  }, []);

  /** WS 消息处理（抽成稳定回调，便于重连时复用） */
  const handleWsMessage = useCallback(
    (msg: WSServerMessage) => {
      switch (msg.type) {
        case 'task:update':
          upsertTask(msg.task);
          break;
        case 'event:new':
          setEventsByTask((prev) => ({ ...prev, [msg.event.taskId]: [...(prev[msg.event.taskId] ?? []), msg.event] }));
          break;
        case 'deliverable:update':
          setDeliverablesByTask((prev) => {
            const list = prev[msg.deliverable.taskId] ?? [];
            const idx = list.findIndex((d) => d.id === msg.deliverable.id);
            const next = idx >= 0 ? list.map((d, i) => (i === idx ? msg.deliverable : d)) : [...list, msg.deliverable];
            return { ...prev, [msg.deliverable.taskId]: next };
          });
          break;
        case 'agent:status':
          setAgents((prev) => prev.map((a) => (a.id === msg.agent.id ? { ...a, ...msg.agent, channelConfigured: a.channelConfigured } : a)));
          break;
        case 'chat:message':
          setMessages((prev) => [...prev, msg.message]);
          break;
        case 'chat:history':
          setMessages(msg.messages);
          break;
        case 'approval:prompt': {
          setApprovalQueue((prev) => (prev.some((x) => x.taskId === msg.taskId && x.stage === msg.stage) ? prev : [...prev, { taskId: msg.taskId, stage: msg.stage, title: `任务 #${msg.taskId}` }]));
          // B9 · 12.x：待确认浏览器通知（发送判定/标题闪烁降级在模块内完成）
          const t = tasksRef.current.find((x) => x.id === msg.taskId);
          handleApprovalPrompt({ taskId: msg.taskId, stage: msg.stage, taskTitle: t?.title }, (id) => openTaskRef.current(id));
          break;
        }
        case 'error':
          console.warn('[ws error]', msg.message);
          break;
        default:
          break;
      }
    },
    [upsertTask],
  );

  /** 建立 WS 连接（重连前先关掉旧连接，避免重复订阅） */
  const startWs = useCallback(() => {
    wsRef.current?.();
    wsRef.current = connectWs(handleWsMessage, setConnected);
  }, [handleWsMessage]);

  // WS 订阅
  useEffect(() => {
    startWs();
    void refresh();
    return () => {
      wsRef.current?.();
      wsRef.current = null;
    };
  }, [refresh, startWs]);

  /** 手动重连：顶栏状态徽章与聊天框共用同一个 connected 状态，断开后可立即重试 */
  const reconnect = useCallback(() => {
    setConnected(false);
    startWs();
  }, [startWs]);

  // B9 · 12.8：待确认集合变化 → 同步模块计数（清空即停闪烁复位标题）
  useEffect(() => {
    syncPendingTaskIds(approvalQueue.map((x) => x.taskId));
  }, [approvalQueue]);

  const setBoardMode = useCallback((m: BoardMode) => {
    setBoardModeState(m);
  }, []);

  const setFilters = useCallback((f: TaskFilters) => {
    setFiltersState(f);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(DEFAULT_FILTERS);
  }, []);

  const loadTaskDetail = useCallback(async (taskId: number) => {
    const [d, e] = await Promise.all([api.taskDeliverables(taskId), api.taskEvents(taskId)]);
    setDeliverablesByTask((prev) => ({ ...prev, [taskId]: d.deliverables }));
    setEventsByTask((prev) => ({ ...prev, [taskId]: e.events }));
  }, []);

  // hash 路由回绑：修复浏览器前进/后退、分享链接、刷新保持视图（原先只有写入没有读取）
  useEffect(() => {
    const applyHash = () => {
      const h = location.hash;
      if (h === appliedHashRef.current) return; // 本应用自己写入的，忽略
      appliedHashRef.current = h;
      const { view: v, taskId } = viewFromHash();
      setViewState(v);
      setSelectedTaskId(taskId);
      if (v === 'task' && taskId != null) void loadTaskDetail(taskId);
    };
    window.addEventListener('hashchange', applyHash);
    window.addEventListener('popstate', applyHash);
    applyHash(); // 首载对齐（含直接打开 #/task/:id 时补齐详情拉取）
    return () => {
      window.removeEventListener('hashchange', applyHash);
      window.removeEventListener('popstate', applyHash);
    };
  }, [loadTaskDetail]);

  const createTask = useCallback(
    async (input: TaskCreateInput) => {
      const { task } = await api.createTask(input);
      upsertTask(task);
      await refresh();
      return task;
    },
    [refresh, upsertTask],
  );

  const confirmTask = useCallback(
    async (id: number) => {
      const { task } = await api.confirmTask(id);
      upsertTask(task);
      void loadTaskDetail(id);
    },
    [upsertTask, loadTaskDetail],
  );

  const decide = useCallback(
    async (taskId: number, kind: 'copy' | 'image', decision: 'approve' | 'reject' | 'skip', imageId?: string, note?: string) => {
      // 决策后移除该任务对应阶段的待确认条目（copy 决策移除 copy；image 决策移除图片确认阶段）
      const removeQueue = (prev: { taskId: number; stage: string; title: string }[]) =>
        prev.filter((x) => x.taskId !== taskId || (kind === 'copy' ? x.stage !== 'copy' : x.stage !== 'main-image' && x.stage !== 'detail-image'));
      // 打回（reject）→ 乐观移除：请求发起即清理旧条目，避免后端返工（decideDeliverable 会同步等待重产出）
      // 完成后新广播的 approval:prompt 条目被本响应回调误清；返工完成的新条目仍会正常触发 Toast
      if (decision === 'reject') setApprovalQueue(removeQueue);
      const { task, deliverables } = await api.decideDeliverable(taskId, kind, decision, imageId, note);
      upsertTask(task);
      setDeliverablesByTask((prev) => ({ ...prev, [taskId]: deliverables }));
      // 采纳/跳过（approve/skip）→ 响应后移除（任务已推进/处理完毕）
      if (decision === 'approve' || decision === 'skip') setApprovalQueue(removeQueue);
    },
    [upsertTask],
  );

  const retryImage = useCallback(
    async (taskId: number, imageId: string) => {
      const { deliverables } = await api.retryImage(taskId, imageId);
      setDeliverablesByTask((prev) => ({ ...prev, [taskId]: deliverables }));
      void loadTaskDetail(taskId);
    },
    [loadTaskDetail],
  );

  const review = useCallback(
    async (taskId: number, decision: 'pass' | 'rollback', targetStage?: string, note?: string) => {
      const { task } = await api.reviewDecision(taskId, decision, targetStage, note);
      upsertTask(task);
    },
    [upsertTask],
  );

  const sendChat = useCallback(
    (body: string) => {
      if (!body.trim()) return;
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'chat:send', chatKind: chatTarget.kind, to: chatTarget.to, body }));
        setTimeout(() => ws.close(), 200);
      };
      // 本地乐观追加
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          chatKind: chatTarget.kind,
          from: '你',
          to: chatTarget.to,
          body,
          kind: 'msg' as const,
          createdAt: new Date().toISOString(),
        } satisfies Message,
      ]);
    },
    [chatTarget],
  );

  const selectChat = useCallback(
    (target: ChatTarget) => {
      setChatTarget(target);
      void api.chatHistory(target.kind, target.to).then((r) => setMessages(r.messages));
    },
    [],
  );

  const openTask = useCallback((id: number) => {
    setViewState('task');
    setSelectedTaskId(id);
    appliedHashRef.current = `#/task/${id}`;
    location.hash = appliedHashRef.current;
    void loadTaskDetail(id);
  }, [loadTaskDetail]);

  /** 供 WS 回调使用 openTask（通知点击跳转；WS effect 依赖稳定，故经 ref 间接调用避免重连） */
  const openTaskRef = useRef<(id: number) => void>(openTask);
  useEffect(() => {
    openTaskRef.current = openTask;
  }, [openTask]);

  const backToBoard = useCallback(() => {
    setViewState('board');
    setSelectedTaskId(null);
    appliedHashRef.current = '#/board';
    location.hash = appliedHashRef.current;
  }, []);

  const setTaskTab = useCallback((t: TaskTab) => {
    setTaskTabState(t);
  }, []);

  const setView = useCallback((v: WorkbenchView) => {
    setViewState(v);
    if (v === 'board') setSelectedTaskId(null);
    appliedHashRef.current = `#/${v}`;
    location.hash = appliedHashRef.current;
  }, []);

  /** 打开知识库阅读指定文档（星图节点 / 任务关联资料跳转用） */
  const openKbDoc = useCallback(
    (path: string | null) => {
      setKbDocPath(path);
      setView('knowledge');
    },
    [setView],
  );

  const openNewTask = useCallback(() => {
    setNewTask({ open: true });
  }, []);

  const closeNewTask = useCallback(() => {
    setNewTask({ open: false });
  }, []);

  /** 归档任务（归档≠删除：数据保留，看板不显示；WS task:update 同步各端） */
  const archiveTask = useCallback(
    async (id: number) => {
      const { task } = await api.archiveTask(id);
      upsertTask(task);
    },
    [upsertTask],
  );

  /** 恢复归档任务回看板原列 */
  const restoreTask = useCallback(
    async (id: number) => {
      const { task } = await api.restoreTask(id);
      upsertTask(task);
    },
    [upsertTask],
  );

  const value = useMemo<WorkbenchState>(
    () => ({
      tasks,
      agents,
      connected,
      reconnect,
      view,
      selectedTaskId,
      taskTab,
      chatTarget,
      messages,
      deliverablesByTask,
      eventsByTask,
      approvalQueue,
      settings,
      loading,
      kbDocPath,
      kbNodeId,
      newTask,
      boardMode,
      filters,
      refresh,
      createTask,
      confirmTask,
      decide,
      retryImage,
      review,
      archiveTask,
      restoreTask,
      sendChat,
      selectChat,
      setView,
      openKbDoc,
      setKbNodeId,
      openNewTask,
      closeNewTask,
      openTask,
      backToBoard,
      setTaskTab,
      setBoardMode,
      setFilters,
      clearFilters,
    }),
    [tasks, agents, connected, reconnect, view, selectedTaskId, taskTab, chatTarget, messages, deliverablesByTask, eventsByTask, approvalQueue, settings, loading, kbDocPath, kbNodeId, newTask, boardMode, filters, refresh, createTask, confirmTask, decide, retryImage, review, archiveTask, restoreTask, sendChat, selectChat, setView, openKbDoc, setKbNodeId, openNewTask, closeNewTask, openTask, backToBoard, setTaskTab, setBoardMode, setFilters, clearFilters],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkbench(): WorkbenchState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkbench must be used within WorkbenchProvider');
  return v;
}
