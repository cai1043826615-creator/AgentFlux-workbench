import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Agent, AgentSkillInfo, ChannelTestError, ChannelTestResult, LlmChannelConfig } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { api } from '../../lib/api.ts';
import { Avatar, Badge, Btn, Field, Modal, ModalFooter } from '../../components/ui.tsx';
import { SkillMountPicker, type MountTarget } from './SkillMountPicker.tsx';

/**
 * GET /api/agents/skills —— 后端同事新增接口；
 * 为避免改动他人文件（api.ts），此处直接在组件内 fetch，失败降级为空目录。
 */
async function listSkills(): Promise<AgentSkillInfo[]> {
  try {
    const res = await fetch('/api/agents/skills');
    if (!res.ok) return [];
    const data = (await res.json()) as { skills?: AgentSkillInfo[] };
    return data.skills ?? [];
  } catch {
    return [];
  }
}

/** 渠道读取（settings 是宽松 Record，按 agent id 取 llmChannels） */
function channelOf(settings: Record<string, unknown>, agentId: string): LlmChannelConfig | null {
  const llm = (settings.llmChannels ?? {}) as Record<string, LlmChannelConfig> | undefined;
  return llm?.[agentId] ?? null;
}

/** Agent 设置弹窗（意见5，参考图 20260909104750：角色行 → 人设卡 → 挂载列表 → 挂载按钮） */
/**
 * Agent 设置弹窗。
 * scope（用户定案 2026-09-14）：
 * - 'workflow'：从工作流看板的工位栏打开 → 「技能与文件」卡片只显示**当前工作流**那一份
 *   （在电商看板打开只见电商份；小红书同理；数据分份保存，另一份不受影响）
 * - 'all'（默认）：从 Agent 状态/知识库等通用区打开 → 显示**两条**（总览）
 * 二级「挂载」弹窗两种 scope 下都只显示单条工作流。
 */
export function AgentSettingsModal({
  agent,
  open,
  onClose,
  scope = 'all',
}: {
  agent: Agent;
  open: boolean;
  onClose: () => void;
  /** 挂载卡片的可见范围：workflow=只看当前工作流份；all=总览两条 */
  scope?: 'workflow' | 'all';
}) {
  const { settings, refresh, currentWorkflowId } = useWorkbench();

  const [persona, setPersona] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  // 按工作流分份挂载（用户返工定案 2026-09-14）：每条工作流各自挂「技能 + 文件」，不再有全局文件区
  const [ecomSkills, setEcomSkills] = useState<string[]>([]);
  const [xhsSkills, setXhsSkills] = useState<string[]>([]);
  const [ecomFiles, setEcomFiles] = useState<string[]>([]);
  const [xhsFiles, setXhsFiles] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<AgentSkillInfo[]>([]);
  const [fileCatalog, setFileCatalog] = useState<{ id: string; name: string }[]>([]);
  const [fileError, setFileError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<MountTarget>({ workflowId: 'ecom-new-listing', label: '电商工作流', category: '电商' });
  const [showApi, setShowApi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** 工作流键 → 该份的挂载/上传目标 */
  const MOUNT_PARTS = {
    ecom: { workflowId: 'ecom-new-listing', label: '电商工作流', category: '电商' },
    xhs: { workflowId: 'xhs-note', label: '小红书工作流', category: '小红书' },
  } as const;
  const skillsOf = (k: 'ecom' | 'xhs') => (k === 'ecom' ? ecomSkills : xhsSkills);
  const filesOf = (k: 'ecom' | 'xhs') => (k === 'ecom' ? ecomFiles : xhsFiles);

  /**
   * 「技能与文件」卡片的可见份：
   * scope='workflow' → 只渲染当前工作流那一份（截图定案）；
   * scope='all' → 两条都渲染（Agent 状态等通用入口的总览）。
   */
  const mountKinds: ('ecom' | 'xhs')[] =
    scope === 'workflow'
      ? [currentWorkflowId === 'xhs-note' ? 'xhs' : 'ecom']
      : ['ecom', 'xhs'];

  /** 打开二级弹窗：只装载目标工作流的界面（另一条不在弹窗内出现） */
  const openPicker = (kind: 'ecom' | 'xhs') => {
    setPickerTarget(MOUNT_PARTS[kind]);
    setPickerOpen(true);
  };

  // 已为当前 agent 初始化过的标记：避免 WS agent:status 推送（agent 引用变化）触发 effect 反复重置表单/挂载面板
  const initRef = useRef<{ key: string } | null>(null);
  // B8 · 11.x：测试渠道（进行中防重复；结果含归因与建议；不写入执行记录/设置）
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ChannelTestResult | null>(null);

  /** 配置域错误码（11.3：归因「渠道配置错误」；成功但有失败执行则归因 Agent 侧） */
  const CONFIG_DOMAIN: ChannelTestError['code'][] = ['not_configured', 'auth_failed', 'model_not_found', 'connect_failed', 'timeout', 'upstream_error'];
  const SUGGESTION: Partial<Record<ChannelTestError['code'], string>> = {
    not_configured: '请填写 API Base URL 与 API Key',
    auth_failed: '请检查 API Key 是否复制完整',
    model_not_found: '请检查模型名称是否与渠道支持一致',
    connect_failed: '请检查 Base URL 与网络连接',
    timeout: '请检查渠道响应速度（15s 超时）',
    upstream_error: '请检查渠道服务状态',
    unknown: '请稍后重试',
  };

  const testChannel = async () => {
    if (testing) return; // 11.6：进行中防重复
    setTesting(true);
    setTestResult(null);
    try {
      // 11.5：以表单当前值（未保存）作为覆盖发起测试；后端不写任何持久化（11.7）
      const r = await api.channelTest(agent.id, {
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
        model: model.trim() || undefined,
      });
      setTestResult(r);
    } catch {
      setTestResult({ ok: false, latencyMs: null, model: model.trim(), baseUrlHost: '', error: { code: 'unknown', message: '无法连接测试接口' } });
    } finally {
      setTesting(false);
    }
  };

  // 打开弹窗时按 agent + 已存渠道初始化表单（仅首次打开时执行一次，agent.id 变化才重新初始化）
  useEffect(() => {
    if (!open) {
      initRef.current = null;
      return;
    }
    if (initRef.current?.key === agent.id) return;
    initRef.current = { key: agent.id };
    const ch = channelOf(settings, agent.id);
    setPersona(agent.persona ?? '');
    setModel(agent.model ?? '');
    setBaseUrl(ch?.baseUrl ?? '');
    setApiKey(ch?.apiKey ?? '');
    // 分份初始化：无分份数据（旧库）回退全局 skills / files（等价每份初始值 = 旧全局挂载）
    const ws = agent.workflowSkills ?? {};
    setEcomSkills([...(ws['ecom-new-listing'] ?? agent.skills ?? [])]);
    setXhsSkills([...(ws['xhs-note'] ?? agent.skills ?? [])]);
    const wf = agent.workflowFiles ?? {};
    setEcomFiles([...(wf['ecom-new-listing'] ?? agent.files ?? [])]);
    setXhsFiles([...(wf['xhs-note'] ?? agent.files ?? [])]);
    setPickerOpen(false);
    setShowApi(false);
    setError('');
    setFileError('');
    void listSkills().then(setCatalog);
    void loadFiles();
  }, [open, agent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 二级挂载弹窗打开期间禁止外层配置弹窗滚动（skill-workflow-isolation：防滚动穿透）
  useEffect(() => {
    if (!pickerOpen) return;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prev;
    };
  }, [pickerOpen]);

  /** 文件目录：GET /api/agents/files（后端未实现时降级提示，不中断） */
  const loadFiles = async () => {
    try {
      const r = await api.listFiles();
      setFileCatalog(r.files ?? []);
      setFileError('');
    } catch {
      setFileCatalog([]);
      setFileError('文件目录暂不可用（后端未实现 /api/agents/files）');
    }
  };

  /** 上传挂载文件到指定工作流：读内容 → POST /api/agents/files → 入该工作流挂载列表 */
  const onPickUploadFile = (e: ChangeEvent<HTMLInputElement>, kind: 'ecom' | 'xhs') => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    if (!/\.(md|txt|json)$/i.test(file.name)) {
      setFileError('仅支持 .md / .txt / .json 文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setUploading(true);
      setFileError('');
      void api
        .uploadFile({ name: file.name, content })
        .then(() => {
          const item = { id: file.name, name: file.name.replace(/\.(md|txt|json)$/i, '') };
          setFileCatalog((prev) => (prev.some((x) => x.id === item.id) ? prev : [...prev, item]));
          // 上传即可挂载：直接挂到发起上传的那条工作流
          const setter = kind === 'ecom' ? setEcomFiles : setXhsFiles;
          setter((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
        })
        .catch(() => {
          setFileError('上传失败：后端 /api/agents/files 暂不可用，文件未入目录');
        })
        .finally(() => setUploading(false));
    };
    reader.readAsText(file);
  };

  /**
   * 上传技能到指定工作流：读内容 → POST /api/agents/skills（落到 技能库/<分类>/）
   * → 刷新技能目录并把新技能挂到发起上传的那条工作流。
   */
  const onPickUploadSkill = (e: ChangeEvent<HTMLInputElement>, kind: 'ecom' | 'xhs') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.md$/i.test(file.name)) {
      setFileError('技能仅支持 .md 文件');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      setUploading(true);
      setFileError('');
      void api
        .uploadSkill({ name: file.name, content, category: MOUNT_PARTS[kind].category })
        .then((r) => {
          const skillId = r.skill?.id ?? file.name.replace(/\.md$/i, '');
          const setter = kind === 'ecom' ? setEcomSkills : setXhsSkills;
          setter((prev) => (prev.includes(skillId) ? prev : [...prev, skillId]));
          void listSkills().then(setCatalog); // 新增技能立即可见（后端上传后已使索引失效）
        })
        .catch((err) => {
          setFileError(err instanceof Error ? err.message : '上传技能失败：后端 /api/agents/skills 不可用');
        })
        .finally(() => setUploading(false));
    };
    reader.readAsText(file);
  };

  /**
   * 已配置判定（权威）：后端 isAgentConfigured —— 面板 llmChannels 的 key 或 .env.local 默认渠道回退，
   * 与运行时 llm.ts / imagegen.ts 实际使用渠道一致（修复：面板 key 空但默认渠道可用时不再误显示「未配置」）。
   */
  const configured = Boolean((agent as Agent & { channelConfigured?: boolean }).channelConfigured);
  /** 表单是否填了专属 key（区分「默认渠道密钥」与「专属密钥」提示） */
  const hasOwnKey = Boolean(apiKey.trim());

  const skillDisplayName = (key: string) => catalog.find((s) => s.id === key || s.name === key)?.name ?? key;

  /** 已挂载项的分类（列表徽标用）；查不到 = 目录中已不存在 → 「已失效」 */
  const skillCategory = (key: string) => catalog.find((s) => s.id === key || s.name === key)?.category ?? null;
  /** 已挂载文件是否仍存在于目录（失效标记用） */
  const fileResolves = (name: string) => fileCatalog.some((f) => f.id === name);

  const removeFile = (kind: 'ecom' | 'xhs', f: string) => {
    const setter = kind === 'ecom' ? setEcomFiles : setXhsFiles;
    setter((prev) => prev.filter((x) => x !== f));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const prevChannels = (settings.llmChannels ?? {}) as Record<string, LlmChannelConfig>;
      const prev = prevChannels[agent.id];
      // 按工作流分份挂载：workflowSkills / workflowFiles 为注入数据源；
      // skills / files 传并集（后端在收到分份时会重算并集，此处保持一致）
      const workflowSkills = { 'ecom-new-listing': ecomSkills, 'xhs-note': xhsSkills };
      const workflowFiles = { 'ecom-new-listing': ecomFiles, 'xhs-note': xhsFiles };
      const unionSkills = [...new Set([...ecomSkills, ...xhsSkills])];
      const unionFiles = [...new Set([...ecomFiles, ...xhsFiles])];
      await Promise.all([
        api.updateAgent(agent.id, { persona: persona.trim(), model: model.trim(), skills: unionSkills, workflowSkills, files: unionFiles, workflowFiles }),
        api.putSettings({
          llmChannels: {
            ...prevChannels,
            // 未填的字段保留原值（避免误用空串覆盖已配置的渠道 / 默认渠道）
            [agent.id]: {
              baseUrl: baseUrl.trim() || prev?.baseUrl || '',
              apiKey: apiKey.trim() || prev?.apiKey || '',
              model: model.trim() || prev?.model || '',
            },
          },
        }),
      ]);
      await refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  /** 勾选方块：已挂载 → 紫色填充 + ✓（可见勾选态） */
  const checkBox = (mounted: boolean) => (
    <span
      className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none"
      style={{
        borderColor: mounted ? 'var(--color-signal)' : 'var(--color-line-strong)',
        background: mounted ? 'var(--color-signal)' : 'transparent',
        color: 'var(--color-inverse)',
      }}
    >
      {mounted ? '✓' : ''}
    </span>
  );

  return (
    <Modal open={open} title="Agent 设置" onClose={onClose} width={560}>
      {/* 顶部角色行（参考图：Muse · Opus 4.6 · 脑暴 · 主笔） */}
      <div className="mb-4 flex items-center gap-3 border-b pb-4" style={{ borderColor: 'var(--color-line)' }}>
        <Avatar name={agent.name} id={agent.id} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{agent.name}</span>
            <Badge>{agent.role}</Badge>
          </div>
          <div className="qs-meta mt-0.5 truncate" style={{ color: 'var(--color-ink-faint)' }}>
            {agent.model || '未指定模型'}
          </div>
        </div>
        <Badge tone={configured ? 'ok' : 'warn'}>{configured ? '已配置' : '未配置'}</Badge>
      </div>

      {/* 人设卡片 */}
      <div className="qs-card mb-3 p-3">
        <div className="qs-meta mb-1.5" style={{ color: 'var(--color-ink-soft)' }}>人设 · persona</div>
        <textarea
          className="qs-input min-h-[84px]"
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          placeholder="Agent 的人设与职责描述，随系统提示注入"
        />
      </div>

      {/* 模型与 API 配置（意见6：默认只显示模型名，敏感字段收进「配置模型」展开区；保存到 settings.llmChannels[agentId]） */}
      <div className="qs-card mb-3 p-3">
        <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-soft)' }}>模型与 API</div>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{model.trim() || '未指定模型'}</span>
          <Badge tone={configured ? 'ok' : 'warn'}>{configured ? '已配置' : '未配置'}</Badge>
          <Btn size="sm" onClick={() => setShowApi((v) => !v)}>
            {configured ? '已配置 · 修改' : '配置模型'}
          </Btn>
        </div>
        {showApi ? (
          <div className="mt-3">
            <Field label="模型名称">
              <input className="qs-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 gpt-4o / deepseek-chat" />
            </Field>
            <Field label="API Base URL">
              <input className="qs-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="如 https://api.openai.com/v1" />
            </Field>
            <Field label="API Key">
              <input className="qs-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={configured && !hasOwnKey ? '留空则使用默认渠道密钥' : 'sk-…'} autoComplete="off" />
            </Field>
            <p className="qs-meta" style={{ color: configured ? 'var(--color-ok)' : 'var(--color-warn)' }}>
              {configured && hasOwnKey
                ? '渠道已配置：请求将发往该 Base URL'
                : configured
                  ? '已配置：使用默认渠道密钥（在此填写可换成专属密钥）'
                  : '未配置：Agent 暂时无法调用该渠道'}
            </p>

            {/* B8 · 11.1-11.7：测试渠道（结果绿色延迟/模型 or 红色归因+建议；测试不写入执行记录与设置） */}
            <div className="mt-2.5 border-t pt-2.5" style={{ borderColor: 'var(--color-line)' }}>
              <div className="flex flex-wrap items-center gap-2">
                <Btn size="sm" variant="ghost" disabled={testing} loading={testing} onClick={() => void testChannel()}>
                  {testing ? '测试中…' : '测试渠道'}
                </Btn>
                <span className="qs-meta text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>
                  测试不写入执行记录与设置
                </span>
              </div>
              {testResult ? (
                testResult.ok ? (
                  <div className="qs-meta mt-2 text-[12px]" style={{ color: 'var(--color-ok)' }}>
                    <span className="qs-dot ok mr-1 inline-block align-middle" />
                    {testResult.latencyMs != null ? `延迟 ${testResult.latencyMs}ms` : '渠道可用'}
                    {testResult.model ? ` · 模型 ${testResult.model}` : ''}
                    {testResult.recentFailedRuns && testResult.recentFailedRuns > 0 ? ' · 渠道正常，失败原因在 Agent 侧（见执行日志）' : ''}
                  </div>
                ) : (
                  <div className="qs-meta mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-danger)' }}>
                    <span className="qs-dot no mr-1 inline-block align-middle" />
                    {(CONFIG_DOMAIN as string[]).includes(testResult.error?.code ?? '')
                      ? `渠道配置错误：${testResult.error?.message ?? '未知错误'}`
                      : `Agent 侧异常：${testResult.error?.message ?? '未知错误'}`}
                    {testResult.error?.code ? (
                      <span className="ml-1.5" style={{ color: 'var(--color-warn)' }}>
                        建议：{SUGGESTION[testResult.error.code] ?? '请稍后重试'}
                      </span>
                    ) : null}
                  </div>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* 技能与文件（scope 定案）：workflow=当前工作流一份；all=两条总览。标题右侧分别上传 */}
      <div className="qs-card p-3">
        <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-soft)' }}>技能与文件</div>

        {mountKinds.map((kind, idx) => (
          <div key={kind} className={idx === 0 ? '' : 'mt-2 border-t pt-2'} style={idx === 0 ? undefined : { borderColor: 'var(--color-line)' }}>
            {/* 标题行：左侧工作流名与计数，右侧两个独立上传按钮 */}
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium">{MOUNT_PARTS[kind].label}</span>
              <span className="qs-meta text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>
                技能 {skillsOf(kind).length} · 文件 {filesOf(kind).length}
              </span>
              <span className="flex-1" />
              <label
                className={`qs-btn sm inline-flex cursor-pointer items-center select-none ${uploading ? 'pointer-events-none opacity-45' : ''}`}
                style={{ fontSize: 12 }}
                title="上传 .md 技能文件到技能库对应分类，并自动挂到本工作流"
              >
                上传技能
                <input type="file" accept=".md" className="hidden" onChange={(e) => onPickUploadSkill(e, kind)} disabled={uploading} />
              </label>
              <label
                className={`qs-btn sm inline-flex cursor-pointer items-center select-none ${uploading ? 'pointer-events-none opacity-45' : ''}`}
                style={{ fontSize: 12 }}
                title="上传 .md/.txt/.json 到知识库收件箱，并自动挂到本工作流"
              >
                上传文件
                <input type="file" accept=".md,.txt,.json" className="hidden" onChange={(e) => onPickUploadFile(e, kind)} disabled={uploading} />
              </label>
            </div>

            {/* 已挂载列表：技能（SKILL）与文件（FILE）同列 */}
            <div className="space-y-1">
              {skillsOf(kind).map((s) => {
                const cat = skillCategory(s);
                return (
                  <div key={`${kind}-s-${s}`} className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
                    <span className="qs-meta shrink-0" style={{ color: 'var(--color-signal-strong)' }}>SKILL</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{skillDisplayName(s)}</span>
                    {cat ? (
                      <span className="qs-meta shrink-0 rounded-[4px] border px-1 text-[10px]" style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}>
                        {cat}
                      </span>
                    ) : (
                      <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-danger)' }}>已失效</span>
                    )}
                    <button
                      type="button"
                      className="qs-meta shrink-0 cursor-pointer px-1 opacity-60 hover:opacity-100"
                      style={{ color: 'var(--color-danger)' }}
                      title={`从${MOUNT_PARTS[kind].label}移除`}
                      onClick={() => (kind === 'ecom' ? setEcomSkills : setXhsSkills)((prev) => prev.filter((x) => x !== s))}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {filesOf(kind).map((f) => (
                <div key={`${kind}-f-${f}`} className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
                  <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)' }}>FILE</span>
                  <span className="min-w-0 flex-1 truncate text-[13px]" title={f}>{f}</span>
                  {fileResolves(f) ? null : (
                    <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-danger)' }}>已失效</span>
                  )}
                  <button
                    type="button"
                    className="qs-meta shrink-0 cursor-pointer px-1 opacity-60 hover:opacity-100"
                    style={{ color: 'var(--color-danger)' }}
                    title="移除"
                    onClick={() => removeFile(kind, f)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {skillsOf(kind).length === 0 && filesOf(kind).length === 0 ? (
                <div className="qs-meta px-1 text-[11px]" style={{ color: 'var(--color-ink-faint)' }}>未挂载</div>
              ) : null}
            </div>

            <Btn size="sm" className="mt-1.5" onClick={() => openPicker(kind)}>＋ 挂载</Btn>
          </div>
        ))}

        {fileError ? <div className="qs-meta mt-2" style={{ color: 'var(--color-warn)' }}>{fileError}</div> : null}

        {/* 二级挂载弹窗：只显示进入的那条工作流（技能 + 文件）；只有本设置弹窗才看到全部工作流 */}
        <SkillMountPicker
          open={pickerOpen}
          target={pickerTarget}
          catalog={catalog}
          initialSkills={pickerTarget.workflowId === 'ecom-new-listing' ? ecomSkills : xhsSkills}
          initialFiles={pickerTarget.workflowId === 'ecom-new-listing' ? ecomFiles : xhsFiles}
          fileCatalog={fileCatalog}
          otherFiles={pickerTarget.workflowId === 'ecom-new-listing' ? xhsFiles : ecomFiles}
          onCancel={() => setPickerOpen(false)}
          onComplete={(next) => {
            if (pickerTarget.workflowId === 'ecom-new-listing') {
              setEcomSkills(next.skills);
              setEcomFiles(next.files);
            } else {
              setXhsSkills(next.skills);
              setXhsFiles(next.files);
            }
            setPickerOpen(false);
          }}
        />
      </div>

      {error ? (
        <div className="qs-meta mt-3" style={{ color: 'var(--color-danger)' }}>{error}</div>
      ) : null}

      <ModalFooter>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" onClick={() => void save()} loading={saving}>
          {saving ? '保存中…' : '保存'}
        </Btn>
      </ModalFooter>
    </Modal>
  );
}
