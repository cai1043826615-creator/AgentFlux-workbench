import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Agent, Deliverable, Message, Task, TaskCreateInput, TaskEvent } from '@workbench/shared';
import { api } from '../lib/api.ts';
import { connectWs } from '../lib/ws.ts';

export type WorkbenchView = 'board' | 'task' | 'observability';
export type TaskTab = 'detail' | 'deliver';
export type ChatTarget = { kind: 'group'; to: string } | { kind: 'private'; to: string };

export interface TaskWithMeta extends Task {
  ownerName: string;
  stageLabel: string;
}

interface WorkbenchState {
  tasks: TaskWithMeta[];
  agents: Agent[];
  connected: boolean;
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
  refresh: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<Task>;
  confirmTask: (id: number) => Promise<void>;
  decide: (taskId: number, kind: 'copy' | 'image', decision: 'approve' | 'reject', imageId?: string, note?: string) => Promise<void>;
  review: (taskId: number, decision: 'pass' | 'rollback', targetStage?: string, note?: string) => Promise<void>;
  sendChat: (body: string) => void;
  selectChat: (target: ChatTarget) => void;
  setView: (v: 'board' | 'observability') => void;
  openTask: (id: number) => void;
  backToBoard: () => void;
  setTaskTab: (t: TaskTab) => void;
}

const VIEWS: WorkbenchView[] = ['board', 'task', 'observability'];
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
  const [agents, setAgents] = useState<Agent[]>([]);
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
  const wsRef = useRef<(() => void) | null>(null);

  const upsertTask = useCallback((task: Task) => {
    setTasks((prev) => {
      const meta = { ...task, ownerName: '', stageLabel: task.stage } as TaskWithMeta;
      const idx = prev.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...meta };
        return next;
      }
      return [meta, ...prev];
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

  // WS 订阅
  useEffect(() => {
    wsRef.current = connectWs(
      (msg) => {
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
            setAgents((prev) => prev.map((a) => (a.id === msg.agent.id ? msg.agent : a)));
            break;
          case 'chat:message':
            setMessages((prev) => [...prev, msg.message]);
            break;
          case 'chat:history':
            setMessages(msg.messages);
            break;
          case 'approval:prompt': {
            setApprovalQueue((prev) => (prev.some((x) => x.taskId === msg.taskId) ? prev : [...prev, { taskId: msg.taskId, stage: msg.stage, title: `任务 #${msg.taskId}` }]));
            break;
          }
          case 'error':
            console.warn('[ws error]', msg.message);
            break;
          default:
            break;
        }
      },
      setConnected,
    );
    void refresh();
    return () => wsRef.current?.();
  }, [refresh, upsertTask]);

  const loadTaskDetail = useCallback(async (taskId: number) => {
    const [d, e] = await Promise.all([api.taskDeliverables(taskId), api.taskEvents(taskId)]);
    setDeliverablesByTask((prev) => ({ ...prev, [taskId]: d.deliverables }));
    setEventsByTask((prev) => ({ ...prev, [taskId]: e.events }));
  }, []);

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
    async (taskId: number, kind: 'copy' | 'image', decision: 'approve' | 'reject', imageId?: string, note?: string) => {
      const { task, deliverables } = await api.decideDeliverable(taskId, kind, decision, imageId, note);
      upsertTask(task);
      setDeliverablesByTask((prev) => ({ ...prev, [taskId]: deliverables }));
      setApprovalQueue((prev) => prev.filter((x) => x.taskId !== taskId || x.stage !== task.stage));
    },
    [upsertTask],
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
    location.hash = `#/task/${id}`;
    void loadTaskDetail(id);
  }, [loadTaskDetail]);

  const backToBoard = useCallback(() => {
    setViewState('board');
    setSelectedTaskId(null);
    location.hash = '#/board';
  }, []);

  const setTaskTab = useCallback((t: TaskTab) => {
    setTaskTabState(t);
  }, []);

  const setView = useCallback((v: 'board' | 'observability') => {
    setViewState(v);
    if (v === 'board') setSelectedTaskId(null);
    location.hash = `/${v}`;
  }, []);

  const value = useMemo<WorkbenchState>(
    () => ({
      tasks,
      agents,
      connected,
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
      refresh,
      createTask,
      confirmTask,
      decide,
      review,
      sendChat,
      selectChat,
      setView,
      openTask,
      backToBoard,
      setTaskTab,
    }),
    [tasks, agents, connected, view, selectedTaskId, taskTab, chatTarget, messages, deliverablesByTask, eventsByTask, approvalQueue, settings, loading, refresh, createTask, confirmTask, decide, review, sendChat, selectChat, setView, openTask, backToBoard, setTaskTab],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkbench(): WorkbenchState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkbench must be used within WorkbenchProvider');
  return v;
}
