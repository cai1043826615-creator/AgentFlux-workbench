import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Agent, AgentSkillInfo, LlmChannelConfig } from '@workbench/shared';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { api } from '../../lib/api.ts';
import { Avatar, Badge, Btn, Field, Modal, ModalFooter } from '../../components/ui.tsx';

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
export function AgentSettingsModal({ agent, open, onClose }: { agent: Agent; open: boolean; onClose: () => void }) {
  const { settings, refresh } = useWorkbench();

  const [persona, setPersona] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<AgentSkillInfo[]>([]);
  const [fileCatalog, setFileCatalog] = useState<{ id: string; name: string }[]>([]);
  const [fileError, setFileError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 已为当前 agent 初始化过的标记：避免 WS agent:status 推送（agent 引用变化）触发 effect 反复重置表单/挂载面板
  const initRef = useRef<{ key: string } | null>(null);
  // 挂载面板容器：点击面板外关闭（mousedown 监听）
  const pickerRef = useRef<HTMLDivElement | null>(null);

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
    setSkills([...(agent.skills ?? [])]);
    setFiles([...(agent.files ?? [])]);
    setPickerOpen(false);
    setShowApi(false);
    setError('');
    setFileError('');
    void listSkills().then(setCatalog);
    void loadFiles();
  }, [open, agent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 挂载面板：点击面板外关闭
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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

  /** 上传本地 md/txt/json：读内容 → POST /api/agents/files → 成功入目录（上传中禁用） */
  const onPickUpload = (e: ChangeEvent<HTMLInputElement>) => {
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
        })
        .catch(() => {
          setFileError('上传失败：后端 /api/agents/files 暂不可用，文件未入目录');
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

  const skillMounted = (s: AgentSkillInfo) => skills.includes(s.id) || skills.includes(s.name);
  const skillDisplayName = (key: string) => catalog.find((s) => s.id === key || s.name === key)?.name ?? key;
  const fileMounted = (name: string) => files.includes(name);

  const toggleSkill = (s: AgentSkillInfo) => {
    setSkills((prev) =>
      prev.includes(s.id) || prev.includes(s.name)
        ? prev.filter((x) => x !== s.id && x !== s.name)
        : [...prev.filter((x) => x !== s.name), s.id],
    );
  };

  const toggleFile = (name: string) => {
    setFiles((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const removeSkill = (key: string) => {
    setSkills((prev) => prev.filter((x) => x !== key));
  };

  const removeFile = (f: string) => {
    setFiles((prev) => prev.filter((x) => x !== f));
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const prevChannels = (settings.llmChannels ?? {}) as Record<string, LlmChannelConfig>;
      const prev = prevChannels[agent.id];
      await Promise.all([
        api.updateAgent(agent.id, { persona: persona.trim(), model: model.trim(), skills, files }),
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
        color: '#fff',
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
          </div>
        ) : null}
      </div>

      {/* 挂载的 SKILL 与文件 */}
      <div className="qs-card p-3">
        <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-soft)' }}>挂载的 SKILL 与文件</div>
        <div className="space-y-1.5">
          {skills.map((s) => (
            <div key={`s-${s}`} className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
              <span className="qs-meta shrink-0" style={{ color: 'var(--color-signal-strong)' }}>SKILL</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{skillDisplayName(s)}</span>
              <button type="button" className="qs-meta shrink-0 cursor-pointer px-1 opacity-60 hover:opacity-100" style={{ color: 'var(--color-danger)' }} title="移除" onClick={() => removeSkill(s)}>
                ×
              </button>
            </div>
          ))}
          {files.map((f) => (
            <div key={`f-${f}`} className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
              <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)' }}>FILE</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{f}</span>
              <button type="button" className="qs-meta shrink-0 cursor-pointer px-1 opacity-60 hover:opacity-100" style={{ color: 'var(--color-danger)' }} title="移除" onClick={() => removeFile(f)}>
                ×
              </button>
            </div>
          ))}
          {skills.length === 0 && files.length === 0 ? (
            <div className="qs-meta py-2 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无挂载</div>
          ) : null}
        </div>

        {/* ＋ 挂载 skill 和文件：按钮 + 弹出面板（技能区 / 文件区；点面板外关闭） */}
        <div ref={pickerRef} className="relative mt-2.5">
          <Btn size="sm" onClick={() => setPickerOpen((v) => !v)}>
            ＋ 挂载 skill 和文件
          </Btn>
          {pickerOpen ? (
            <div className="qs-card absolute left-0 z-20 mt-1 w-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
              {/* 技能区（意见7：勾选挂载，勾选后显示 ✓ / 紫色填充） */}
              <div className="border-b p-2" style={{ borderColor: 'var(--color-line)' }}>
                <div className="qs-meta mb-1 px-1" style={{ color: 'var(--color-ink-soft)' }}>技能 SKILLS</div>
                <div className="max-h-[150px] overflow-y-auto">
                  {catalog.length === 0 ? (
                    <div className="qs-meta px-2 py-2 text-center" style={{ color: 'var(--color-ink-faint)' }}>技能目录为空或暂不可用</div>
                  ) : (
                    catalog.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                        onClick={() => toggleSkill(s)}
                      >
                        {checkBox(skillMounted(s))}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{s.name}</span>
                          {s.description ? (
                            <span className="qs-meta block truncate" style={{ color: 'var(--color-ink-faint)' }}>{s.description}</span>
                          ) : null}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* 文件区（目录勾选 + 上传 md/txt/json） */}
              <div className="p-2">
                <div className="qs-meta mb-1 px-1" style={{ color: 'var(--color-ink-soft)' }}>文件 FILES</div>
                {fileError ? (
                  <div className="qs-meta px-2 py-1" style={{ color: 'var(--color-warn)' }}>{fileError}</div>
                ) : null}
                <div className="max-h-[120px] overflow-y-auto">
                  {fileCatalog.length === 0 && !fileError ? (
                    <div className="qs-meta px-2 py-2 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无文件，可上传 .md / .txt / .json</div>
                  ) : (
                    fileCatalog.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                        onClick={() => toggleFile(f.id)}
                      >
                        {checkBox(fileMounted(f.id))}
                        <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
                        <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>FILE</span>
                      </button>
                    ))
                  )}
                </div>
                <label
                  className={`qs-btn sm mt-1.5 inline-flex cursor-pointer items-center select-none ${uploading ? 'pointer-events-none opacity-45' : ''}`}
                  style={{ fontSize: 12, padding: '3px 12px' }}
                >
                  {uploading ? '上传中…' : '上传文件'}
                  <input type="file" accept=".md,.txt,.json" className="hidden" onChange={onPickUpload} disabled={uploading} />
                </label>
              </div>
            </div>
          ) : null}
        </div>
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
