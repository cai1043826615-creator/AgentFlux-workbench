import { useEffect, useState } from 'react';
import type { KnowledgePresetEntry, KnowledgeStatus } from '@workbench/shared';
import { Btn, Field } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';

/** 逗号 / 换行分隔 → 去空数组 */
function parseDirs(v: string): string[] {
  return v
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 后端默认排除项（不应展示给用户编辑，避免误删） */
const DEFAULT_EXCLUDES = ['.git', '.obsidian', '.trash', 'node_modules', '.pnpm-store', 'dist', '.DS_Store'];

/**
 * 知识库设置（P1·6.1/6.2，意见 #8）。
 *
 * 从 `KnowledgeView.tsx` 抽出为独立组件，供**知识库页与知识星图页共用**（两页打开同一弹窗）。
 * 内容按三块组织（P1 意见 #8 补充建议）：
 *   ① 接入     —— Vault 根目录 + 索引范围（白名单 / 排除）
 *   ② 重点目录 —— 用户可增删改的目录快捷方式（两页共用同一份数据）
 *   ③ 索引     —— 重建索引
 *
 * 只读承诺：文案保持「只读接入本地 Markdown 目录，工作台不会修改、删除或移动 Vault 内任何文件」。
 */
export function VaultConfigModal({
  open,
  status,
  onClose,
  onSaved,
  onReindex,
}: {
  open: boolean;
  status: KnowledgeStatus | null;
  onClose: () => void;
  onSaved: () => void;
  /** 由父组件提供重建索引动作（各页自己的 busy/notice 状态） */
  onReindex?: () => void;
}) {
  const [root, setRoot] = useState('');
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  /** ⑥ 重点目录：整表编辑（增 / 改 / 删） */
  const [entries, setEntries] = useState<KnowledgePresetEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoot(status?.root ?? '');
    setInclude((status?.range.includeDirs ?? []).join(', '));
    setExclude((status?.range.excludeDirs ?? []).filter((d) => !DEFAULT_EXCLUDES.includes(d)).join(', '));
    setEntries(status?.presetEntries ?? []);
    setError(null);
  }, [open, status]);

  if (!open) return null;

  const patchEntry = (id: string, next: Partial<KnowledgePresetEntry>) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...next } : e)));

  const addEntry = () =>
    setEntries((prev) => [...prev, { id: `preset-${Date.now()}`, label: '', dir: '' }]);

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));

  /** 校验重点目录：显示名与依据目录都不能空（空条目无法过滤） */
  const invalidEntry = entries.find((e) => !e.label.trim() || !e.dir.trim());

  const save = async (nextRoot: string) => {
    if (invalidEntry) {
      setError(`「${invalidEntry.label || '未命名'}」的显示名或依据目录为空，请补齐后再保存`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.kbSaveConfig({
        root: nextRoot,
        includeDirs: parseDirs(include),
        excludeDirs: parseDirs(exclude),
        presetEntries: entries.map((e) => ({ id: e.id, label: e.label.trim(), dir: e.dir.trim() })),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[8vh]" onClick={onClose}>
      <div className="qs-card flex max-h-[84vh] w-full flex-col p-5" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="font-display mb-1 text-[15px] font-semibold">知识库设置</div>
        <p className="qs-meta mb-4" style={{ color: 'var(--color-ink-faint)' }}>
          只读接入本地 Markdown 目录，工作台不会修改、删除或移动 Vault 内任何文件。
        </p>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {/* ① 接入 */}
          <section>
            <div className="qs-meta mb-2 font-medium" style={{ color: 'var(--color-ink-soft)' }}>
              接入
            </div>
            <Field label="Vault 根目录（绝对路径）">
              <input className="qs-input" value={root} onChange={(e) => setRoot(e.target.value)} placeholder="如：D:\MyVault 或 /Users/me/vault" />
            </Field>
            <Field label="索引目录白名单（可选，留空 = 全库；逗号分隔）">
              <input className="qs-input" value={include} onChange={(e) => setInclude(e.target.value)} placeholder="如：原始资料/产品资料, 知识库/品牌规范" />
            </Field>
            <Field label="额外排除目录（可选，逗号分隔）">
              <input className="qs-input" value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="如：私人日记, 30_self_media" />
            </Field>
            <p className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
              默认排除：.git / .obsidian / .trash / node_modules / dist。也可用环境变量 WORKBENCH_VAULT_ROOT 兜底配置路径。
            </p>
          </section>

          {/* ② 重点目录（6.5–6.8：可增删改；知识库页与知识星图页共用） */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="qs-meta font-medium" style={{ color: 'var(--color-ink-soft)' }}>
                重点目录
              </span>
              <Btn size="sm" variant="ghost" onClick={addEntry} title="新增一条重点目录">
                ＋ 新增
              </Btn>
            </div>
            <p className="qs-meta mb-2" style={{ color: 'var(--color-ink-faint)' }}>
              知识库页与知识星图共用的目录快捷方式；显示名与依据目录都可改。
            </p>
            {entries.length === 0 ? (
              <p className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                暂无重点目录，点「＋ 新增」添加，如「产品资料 → 原始资料/产品资料」。
              </p>
            ) : (
              <div className="space-y-2">
                {entries.map((e) => (
                  <div key={e.id} className="flex items-center gap-2">
                    <input
                      className="qs-input w-[110px] shrink-0"
                      value={e.label}
                      onChange={(ev) => patchEntry(e.id, { label: ev.target.value })}
                      placeholder="显示名"
                      aria-label="重点目录显示名"
                    />
                    <input
                      className="qs-input min-w-0 flex-1"
                      value={e.dir}
                      onChange={(ev) => patchEntry(e.id, { dir: ev.target.value })}
                      placeholder="依据目录（相对 Vault 根）"
                      aria-label="重点目录依据目录"
                    />
                    <Btn size="sm" variant="danger" onClick={() => removeEntry(e.id)} title="删除该重点目录">
                      删除
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ③ 索引 */}
          <section>
            <div className="qs-meta mb-2 font-medium" style={{ color: 'var(--color-ink-soft)' }}>
              索引
            </div>
            <div className="flex items-center gap-2">
              <Btn size="sm" onClick={onReindex} disabled={!status?.root} title={status?.root ? '重建索引' : '先接入 Vault 才能重建索引'}>
                重建索引
              </Btn>
              <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
                {status?.indexing ? '索引进行中…' : status?.root ? '改动 Vault 内容后点此刷新' : '尚未接入 Vault'}
              </span>
            </div>
          </section>
        </div>

        {error ? (
          <p className="qs-meta mt-3" style={{ color: 'var(--color-danger)' }}>
            ● {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Btn size="sm" onClick={onClose}>
            取消
          </Btn>
          {status?.root ? (
            <Btn size="sm" variant="danger" disabled={busy} onClick={() => void save('')}>
              断开连接
            </Btn>
          ) : null}
          <Btn size="sm" variant="primary" loading={busy} onClick={() => void save(root)}>
            保存并索引
          </Btn>
        </div>
      </div>
    </div>
  );
}
