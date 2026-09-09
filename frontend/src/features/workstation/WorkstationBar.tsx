import { useState } from 'react';
import { useWorkbench } from '../../store/useWorkbench.tsx';
import { Btn, Field, Modal, ModalFooter } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';

/** 工位栏（对齐线框 ws-bar）：主视区顶部常驻，3 Agent 实时状态卡 + 添加入口 */
export function WorkstationBar() {
  const { agents, refresh } = useWorkbench();
  const [editId, setEditId] = useState<string | null>(null);
  const [persona, setPersona] = useState('');
  const [model, setModel] = useState('');
  const [skills, setSkills] = useState('');
  const [saving, setSaving] = useState(false);

  const dotClass = (s: string) => (s === 'busy' ? 'qs-dot signal busy' : s === 'online' ? 'qs-dot ok' : 'qs-dot idle');
  const label = (s: string) => (s === 'busy' ? '忙碌' : s === 'online' ? '在线' : '待命');

  const openEdit = (a: { id: string; persona: string; model: string; skills: string[] }) => {
    setEditId(a.id);
    setPersona(a.persona ?? '');
    setModel(a.model ?? '');
    setSkills((a.skills ?? []).join('，'));
  };

  const save = async () => {
    if (!editId || saving) return;
    setSaving(true);
    try {
      await api.updateAgent(editId, {
        persona,
        model,
        skills: skills.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      await refresh();
      setEditId(null);
    } finally {
      setSaving(false);
    }
  };

  const editing = agents.find((a) => a.id === editId);

  return (
    <>
      <div className="qs-card mb-3 px-3 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>
            工位 WORKSTATIONS
          </span>
          <Btn variant="ghost" size="sm" onClick={() => agents[0] && openEdit(agents[0])}>
            ＋ 添加 Agent
          </Btn>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {agents.map((a) => (
            <div key={a.id} className="group flex items-center gap-2 rounded-[4px] border px-2 py-1.5 transition-colors" style={{ borderColor: 'var(--color-line)', background: 'var(--color-surface)', transitionDuration: 'var(--dur-fast)' }}>
              <span className={dotClass(a.onlineStatus)} title={label(a.onlineStatus)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{a.role} · {a.name}</span>
                  <span className="qs-meta shrink-0" style={{ color: a.onlineStatus === 'busy' ? 'var(--color-signal-strong)' : 'var(--color-ink-faint)' }}>{label(a.onlineStatus)}</span>
                </div>
                <div className="qs-meta truncate" style={{ color: 'var(--color-ink-faint)' }}>模型 {a.model}{a.activity ? ` · ${a.activity}` : ''}</div>
              </div>
              <button
                type="button"
                className="qs-meta shrink-0 rounded-[4px] border px-1.5 py-0.5 opacity-70 transition-opacity group-hover:opacity-100"
                style={{ borderColor: 'var(--color-line-strong)' }}
                title="工位设置"
                onClick={() => openEdit(a)}
              >
                设置
              </button>
            </div>
          ))}
        </div>
      </div>

      {editing ? (
        <Modal open title={`工位设置 · ${editing.name}`} onClose={() => setEditId(null)} width={420}>
          <Field label="人设 persona">
            <textarea className="qs-input min-h-[70px]" value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="Agent 的人设与职责描述" />
          </Field>
          <Field label="模型 model">
            <input className="qs-input" value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field label="技能 skills（逗号分隔）">
            <input className="qs-input" value={skills} onChange={(e) => setSkills(e.target.value)} />
          </Field>
          <ModalFooter>
            <Btn onClick={() => setEditId(null)}>取消</Btn>
            <Btn variant="primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Btn>
          </ModalFooter>
        </Modal>
      ) : null}
    </>
  );
}
