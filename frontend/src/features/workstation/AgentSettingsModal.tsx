import { useEffect, useState } from 'react';
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 打开弹窗时按 agent + 已存渠道初始化表单
  useEffect(() => {
    if (!open) return;
    const ch = channelOf(settings, agent.id);
    setPersona(agent.persona ?? '');
    setModel(agent.model ?? '');
    setBaseUrl(ch?.baseUrl ?? '');
    setApiKey(ch?.apiKey ?? '');
    setSkills([...(agent.skills ?? [])]);
    setFiles([...(agent.files ?? [])]);
    setPickerOpen(false);
    setError('');
    void listSkills().then(setCatalog);
  }, [open, agent, settings]);

  const configured = Boolean(baseUrl.trim() && apiKey.trim());

  const skillMounted = (s: AgentSkillInfo) => skills.includes(s.id) || skills.includes(s.name);
  const skillDisplayName = (key: string) => catalog.find((s) => s.id === key || s.name === key)?.name ?? key;

  const toggleSkill = (s: AgentSkillInfo) => {
    setSkills((prev) =>
      prev.includes(s.id) || prev.includes(s.name)
        ? prev.filter((x) => x !== s.id && x !== s.name)
        : [...prev.filter((x) => x !== s.name), s.id],
    );
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
      await Promise.all([
        api.updateAgent(agent.id, { persona: persona.trim(), model: model.trim(), skills, files }),
        api.putSettings({
          llmChannels: {
            ...prevChannels,
            [agent.id]: { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() },
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

  const pendingSkills = catalog.filter((s) => !skillMounted(s));

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

      {/* 模型与 API 配置（保存到 settings.llmChannels[agentId]） */}
      <div className="qs-card mb-3 p-3">
        <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-soft)' }}>模型与 API</div>
        <Field label="模型名称">
          <input className="qs-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="如 gpt-4o / deepseek-chat" />
        </Field>
        <Field label="API Base URL">
          <input className="qs-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="如 https://api.openai.com/v1" />
        </Field>
        <Field label="API Key">
          <input className="qs-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" />
        </Field>
        <p className="qs-meta" style={{ color: configured ? 'var(--color-ok)' : 'var(--color-warn)' }}>
          {configured ? '渠道已配置：请求将发往该 Base URL' : '未配置：Agent 暂时无法调用该渠道'}
        </p>
      </div>

      {/* 挂载的 SKILL 与文件 */}
      <div className="qs-card p-3">
        <div className="qs-meta mb-2" style={{ color: 'var(--color-ink-soft)' }}>挂载的 SKILL 与文件</div>
        <div className="space-y-1.5">
          {skills.map((s) => (
            <div key={`s-${s}`} className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
              <span className="qs-meta shrink-0" style={{ color: 'var(--color-signal-strong)' }}>SKILL</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{skillDisplayName(s)}</span>
              <button type="button" className="qs-meta shrink-0 px-1 hover:opacity-100 opacity-60" style={{ color: 'var(--color-danger)' }} title="移除" onClick={() => removeSkill(s)}>
                ×
              </button>
            </div>
          ))}
          {files.map((f) => (
            <div key={`f-${f}`} className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}>
              <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)' }}>FILE</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{f}</span>
              <button type="button" className="qs-meta shrink-0 px-1 hover:opacity-100 opacity-60" style={{ color: 'var(--color-danger)' }} title="移除" onClick={() => removeFile(f)}>
                ×
              </button>
            </div>
          ))}
          {skills.length === 0 && files.length === 0 ? (
            <div className="qs-meta py-2 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无挂载</div>
          ) : null}
        </div>

        {/* + 挂载 skill：按钮 + 下拉选择（技能带勾选：已挂载=选中） */}
        <div className="relative mt-2.5">
          <Btn size="sm" onClick={() => setPickerOpen((v) => !v)}>
            ＋ 挂载 skill
          </Btn>
          {pickerOpen ? (
            <div className="qs-card absolute left-0 z-20 mt-1 max-h-[240px] w-full overflow-y-auto p-1.5" style={{ background: 'var(--color-surface)' }}>
              {pendingSkills.length === 0 ? (
                <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>技能目录已全部挂载</div>
              ) : (
                pendingSkills.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                    onClick={() => toggleSkill(s)}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border" style={{ borderColor: 'var(--color-line-strong)' }} />
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
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="qs-meta mt-3" style={{ color: 'var(--color-danger)' }}>{error}</div>
      ) : null}

      <ModalFooter>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" onClick={() => void save()} disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </Btn>
      </ModalFooter>
    </Modal>
  );
}
