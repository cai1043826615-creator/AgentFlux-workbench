/**
 * 知识库总览带（P1 要点②）：**1 个核心指标 + 3 个可点入口**，横向一条。
 *
 * 按原型要点②，原先要压掉的是五类信息：「4 个技术计数卡 + 星图缩略 + 最近更新 + 使用率 + 孤岛」。
 * 本文件已全部压掉，只留：
 * - 核心指标：被任务引用的资料数（`health.usage.linkedDocs`）
 * - 3 个入口：灵感库 / 小助理 / 全部文档
 *   其中「灵感库」是**知识库内的目录/入口名**（用户定案）。
 *   （report-driven-fixes 0.8：灵感库入口不再跳「每日热点」模块页，而是直接打开真实目录 `知识库/灵感库/`，
 *    计数=该目录实际文档数；「每日热点」模块页只保留左栏入口，消除 D-28 的多入口冗余。）
 * - 小助理右侧 3 个动作按钮：上传文档 / 拆解小红书 / 和依依对话（用户定案）。
 *   （旧的「整理热点素材 / 整理文档 / 知识库体检」三枚已按用户定案移除：
 *     整理文档与知识库体检判定没必要，改由「上传文档」承担导入职责；后端 /api/kb-assistant/organize 保留未动。）
 *
 * 被移除内容的去向：
 * - 「星图缩略预览」→ 已删（星图入口在左栏「知识星图」，无需重复占位）
 * - 「最近更新」→ 已删（文档列表区本身可浏览，无需在总览带重复）
 * - 「文档使用率」「孤岛」→ 已删（属数据库统计口径，对运营无决策价值）
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Agent, KnowledgeHealth, KnowledgeStats, KnowledgeStatus } from '@workbench/shared';
import { Avatar, Badge, Btn, Field, Modal, ModalFooter } from '../../components/ui.tsx';
import { AvatarStatus } from '../../components/AvatarStatus.tsx';
import { api } from '../../lib/api.ts';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { AgentCard } from '../workstation/AgentCard.tsx';
import { AgentSettingsModal } from '../workstation/AgentSettingsModal.tsx';
import { relTime } from '../../lib/format.ts';

/**
 * P1·5.4：小助理入口位的数据源。
 * 本轮 P1 **不**新增 assistant Agent 实例、不扩 `AgentRole`（那是 P2 的落地步骤），
 * 故此处恒返回 null，由总览带渲染占位卡；P2 只需扩角色 + 加 seed，此函数即自动返回实例。
 */
function useFirstAssistantAgent(): Agent | null {
  const { agents } = useWorkbench();
  return agents.find((a) => a.role === '助理') ?? null;
}

/**
 * 总览带右侧的依依位（P2·F3 定案③④；P2-1/2-2 验收打回后重做）。
 *
 * 打回要点：「和其他工位的 agent 卡片不一致（UI 设计、尺寸等内容）」。
 * 现在展开态**直接复用同一张 AgentCard（非 compact）**：
 * - 与工位卡同尺寸（头像 56、同内边距、同字号、同「配置」按钮位置）
 * - 同信息密度（名字+角色 / 模型+活动 / 状态三行，不再砍掉模型行）
 * 卡片宽度由容器自适应（不再硬编码 240px），避免与工位卡比例不同。
 * 收起态与工位栏折叠语义一致（小头像 + 名字 + 展开钮）。
 */
function AssistantSpot({ assistant, onConfigure }: { assistant: Agent | null; onConfigure: () => void }) {
  const [expanded, setExpanded] = useState(true);

  if (!assistant) {
    // 实体异常缺失：紧凑占位（不呈现为死链）
    return (
      <div
        className="flex shrink-0 items-center gap-2 rounded-[4px] border px-3 py-2"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}
        title="知识库小助理未初始化"
      >
        <Avatar name="依依" size={22} />
        <span className="qs-meta text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
          依依 · 未初始化
        </span>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div
        className="qs-clickable flex shrink-0 items-center gap-2 self-stretch rounded-[4px] border px-3 py-2 transition-colors hover:border-[var(--color-line-strong)]"
        style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}
        onClick={() => setExpanded(true)}
        title="展开依依"
        role="button"
        aria-expanded={false}
      >
        <AvatarStatus
          className="shrink-0"
          name={assistant.name}
          id={assistant.id}
          size={22}
          dotSize={7}
          avatarTitle={`${assistant.name}（${assistant.role}）`}
        />
        <span className="qs-meta whitespace-nowrap" style={{ color: 'var(--color-ink)' }}>
          {assistant.name}
        </span>
        <span className="qs-meta whitespace-nowrap" style={{ color: 'var(--color-ink-faint)' }}>
          展开 ▾
        </span>
      </div>
    );
  }

  return (
    <div className="relative flex min-w-[260px] shrink-0 flex-col">
      <button
        type="button"
        className="qs-clickable qs-meta absolute right-2 top-1.5 z-10"
        style={{ color: 'var(--color-ink-faint)' }}
        onClick={() => setExpanded(false)}
        title="收起依依"
        aria-label="收起依依"
        aria-expanded={true}
      >
        收起 ▸
      </button>
      {/* 与工位卡同款（非 compact，含模型/活动行）——宽度随容器自适应 */}
      <AgentCard agent={assistant} onConfigure={onConfigure} />
    </div>
  );
}

/** 总览带的可点入口（P1·5.1/5.2）：标题 + 数量 + 与下一步相关的提示 */
function OverviewEntry({
  title,
  count,
  countLabel,
  hint,
  onClick,
}: {
  title: string;
  count: number;
  countLabel: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="qs-clickable flex items-center gap-2 rounded-[4px] border px-3 py-2 text-left transition-colors hover:border-[var(--color-line-strong)]"
      style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)' }}
      onClick={onClick}
      title={hint}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="qs-meta block text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
          {hint}
        </span>
      </span>
      <span className="qs-meta shrink-0 tabular" style={{ color: 'var(--color-ink-soft)' }}>
        {count} {countLabel}
      </span>
    </button>
  );
}


/** 灵感库真实目录（report-driven-fixes 0.1/0.8：小助理整理产出的唯一落盘目录） */
const INSPIRATION_DIR = '知识库/灵感库';

/**
 * 【新增组件前置声明】（沿用既有本地组件，未新增通用组件）
 * 1. 现有组件为何不行：查过注册表（docs/规范/01 §3）——Btn 是通用按钮，此处正是复用它，
 *    只是需要「一行一个、带 loading、可禁用」的纵向排布，故保留本文件内已有的薄封装，不在 features/ 下新造按钮。
 * 2. 复用范围：本文件内 3 处（上传文档 / 拆解小红书 / 和依依对话）。
 * 3. 是否应提升为通用组件：否（仅总览带使用；Btn 已是通用按钮，本组件只是「标签 + loading」薄封装）。
 */
function OrganizeBtn({ label, active, busy, onClick }: { label: string; active?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <Btn size="sm" variant={active ? 'primary' : 'ghost'} loading={busy} disabled={busy} onClick={onClick} className="justify-start">
      {label}
    </Btn>
  );
}

/** 文档上传的接受类型（与后端白名单一致：pdf/docx/doc/txt/md） */
const ACCEPT_DOCS = '.pdf,.doc,.docx,.txt,.md';

export interface KnowledgeOverviewBarProps {
  status: KnowledgeStatus;
  stats: KnowledgeStats | null;
  health: KnowledgeHealth | null;
}

/**
 * 总览带：横向排布 [四项统计 | 缩略预览 | 最近更新 | 健康度小指标]。
 * 高度由紧凑内边距控制，约 120–140px。
 */
export function KnowledgeOverviewBar({ status, stats, health }: KnowledgeOverviewBarProps) {
  const { setView, openKbDir, pushToast, selectChat, setChatPanelOpen } = useWorkbench();
  const usage = health?.usage;
  /** 文档使用率口径（2.5）：百分比（分子/分母）；ratio 为 null（未连接/0 篇文档）显示「—」 */
  const usageText = usage && usage.ratio !== null ? `${Math.round(usage.ratio * 100)}%（${usage.linkedDocs}/${usage.totalDocs}）` : '—';
  /** 灵感库真实目录的文档数（入口①的数量；report-driven-fixes 0.8：不再取热点面板上游总数） */
  const [inspirationCount, setInspirationCount] = useState(0);
  /** 正在执行的异步动作（互斥）：upload=上传文档 / xhs=拆解小红书；「和依依对话」是纯跳转，无异步态 */
  const [busy, setBusy] = useState<'upload' | 'xhs' | null>(null);
  /** 小助理（依依）入口位：P1·5.4 预留，P2·F3 实体已存在即命中 */
  const assistant = useFirstAssistantAgent();
  /** 依依设置弹窗（P2·F3：与工位卡同一配置弹窗） */
  const [settingsAgent, setSettingsAgent] = useState<Agent | null>(null);
  /** 小红书拆解弹窗（复用既有 Modal + Field，不自造弹窗，G1/G2） */
  const [xhsOpen, setXhsOpen] = useState(false);
  const [xhsText, setXhsText] = useState('');
  /** 隐藏的文件选择器（由「上传文档」按钮触发） */
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .kbDocs({ dir: INSPIRATION_DIR })
      .then((r) => {
        if (!cancelled) setInspirationCount(r.docs.length);
      })
      .catch(() => {
        if (!cancelled) setInspirationCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [stats?.indexedAt]);

  /** 导入成功后刷新灵感库/收件箱计数（索引是后台重建的，这里只刷新本卡片数字） */
  const refreshInspiration = useCallback(async () => {
    try {
      const docs = await api.kbDocs({ dir: INSPIRATION_DIR });
      setInspirationCount(docs.docs.length);
    } catch {
      /* 刷新失败不影响已完成的导入 */
    }
  }, []);

  /** ① 上传文档导入知识库：选文件 → 上传解析 → 提示落盘位置 */
  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许连续选同一个文件
    if (!file) return;
    setBusy('upload');
    try {
      const r = await api.kbImportDoc(file);
      pushToast({ message: `已导入《${r.title}》→ ${r.path}`, tone: 'ok', duration: 6000, key: 'kb-import' });
      void refreshInspiration();
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : '导入失败，请重试', tone: 'no', duration: 8000, key: 'kb-import' });
    } finally {
      setBusy(null);
    }
  };

  /** ② 小红书拆解入库：粘贴分享文本或笔记链接 → 解析成 Markdown 落盘 */
  const submitXhs = async () => {
    const text = xhsText.trim();
    if (!text) return;
    setBusy('xhs');
    try {
      const r = await api.kbImportXhs(text);
      pushToast({
        message: r.degraded ? `已拆解（降级）：${r.degraded} → ${r.path}` : `已拆解《${r.title}》→ ${r.path}`,
        tone: r.degraded ? 'default' : 'ok',
        duration: 8000,
        key: 'kb-xhs',
      });
      setXhsText('');
      setXhsOpen(false);
      void refreshInspiration();
    } catch (err) {
      pushToast({ message: err instanceof Error ? err.message : '拆解失败，请重试', tone: 'no', duration: 8000, key: 'kb-xhs' });
    } finally {
      setBusy(null);
    }
  };

  /** ③ 和依依对话：切到依依的私聊会话并**展开右侧聊天面板**（第三方复核 P2：仅 selectChat 时面板可能折叠，用户感知"点了没反应"） */
  const chatWithAssistant = () => {
    selectChat({ kind: 'private', to: assistant?.id ?? assistant?.name ?? '依依' });
    setChatPanelOpen(true);
    pushToast({ message: `已打开与${assistant?.name ?? '依依'}的对话`, tone: 'ok', duration: 4000, key: 'kb-chat' });
  };

  return (
    <div className="qs-card flex flex-wrap items-stretch gap-3 p-3" data-qs-overview>
      {/* 1 个核心指标：被任务引用的资料（P1 要点②：替代原 4 计数卡） */}
      <div className="flex w-[196px] shrink-0 flex-col justify-center rounded-[4px] border px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
        <div className="qs-meta text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          待在用的资料
        </div>
        <div className="font-display tabular text-[20px] font-bold leading-tight">{usage?.linkedDocs ?? 0}</div>
        <div className="qs-meta mt-0.5 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
          篇被任务引用{stats?.indexedAt ? ` · ${relTime(stats.indexedAt)}更新` : ''}
        </div>
      </div>

      {/* 两个入口（灵感库 / 全部文档）——依依位按用户定案移到总览带最右侧 */}
      <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-2">
        {/* 命名边界（用户定案）：此入口**位于知识库内**，指知识库里的「灵感库」目录，故叫「灵感库」。
            report-driven-fixes 0.8：点击直接打开真实目录 `知识库/灵感库/`（D-28 入口收敛），
            不再跳「每日热点」模块页（该模块只保留左栏入口）。 */}
        <OverviewEntry
          title="灵感库"
          count={inspirationCount}
          countLabel="篇"
          hint="小助理整理产出所在目录"
          onClick={() => openKbDir(INSPIRATION_DIR)}
        />
        <OverviewEntry
          title="全部文档"
          count={stats?.docCount ?? 0}
          countLabel="篇"
          hint="浏览与搜索全部已索引资料"
          onClick={() => setView('knowledge')}
        />
      </div>

      {/* 小助理（依依）位：总览带最右侧（用户定案③）；支持收起/展开（用户定案④，与工位栏一致语义）。
          实体存在 → 真实 Agent 卡 + 配置入口；不存在（异常）→ 紧凑占位而非死链。
          report-driven-fixes 0.7：旧三枚整理按钮（整理热点素材 / 整理文档 / 知识库体检）已按用户定案替换。 */}
      <AssistantSpot assistant={assistant} onConfigure={() => assistant && setSettingsAgent(assistant)} />
      <div className="flex shrink-0 flex-col gap-1.5">
        <input ref={fileRef} type="file" accept={ACCEPT_DOCS} className="hidden" onChange={(e) => void onPickFile(e)} />
        <OrganizeBtn label="上传文档" active={busy === 'upload'} busy={busy === 'upload'} onClick={() => fileRef.current?.click()} />
        <OrganizeBtn label="拆解小红书" active={busy === 'xhs'} busy={busy === 'xhs'} onClick={() => setXhsOpen(true)} />
        <OrganizeBtn label="和依依对话" onClick={chatWithAssistant} />
      </div>

      {status.indexing ? <Badge tone="signal">索引中…</Badge> : null}
      {settingsAgent ? <AgentSettingsModal agent={settingsAgent} open onClose={() => setSettingsAgent(null)} /> : null}

      {/* 小红书拆解弹窗：复用既有 Modal + Field + ModalFooter（G1），不自造弹窗 */}
      <Modal open={xhsOpen} title="拆解小红书内容" onClose={() => setXhsOpen(false)} width={560}>
        <Field label="粘贴小红书分享文本或笔记链接" required>
          <textarea
            className="qs-input w-full"
            rows={8}
            value={xhsText}
            onChange={(e) => setXhsText(e.target.value)}
            placeholder="在小红书 App 点「分享 → 复制链接」，或直接粘贴整段分享文案"
          />
        </Field>
        <p className="qs-meta mb-3" style={{ color: 'var(--color-ink-faint)' }}>
          解析结果写入 知识库/收件箱/小红书/；未配置小红书 Cookie 时按粘贴内容降级拆解，不影响文本解析。
        </p>
        <ModalFooter>
          <Btn onClick={() => setXhsOpen(false)}>取消</Btn>
          <Btn variant="primary" onClick={() => void submitXhs()} disabled={busy === 'xhs' || !xhsText.trim()}>
            {busy === 'xhs' ? '拆解中…' : '拆解并入库'}
          </Btn>
        </ModalFooter>
      </Modal>
    </div>
  );
}
