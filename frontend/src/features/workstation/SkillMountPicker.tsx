import { useEffect, useMemo, useState } from 'react';
import type { AgentSkillInfo } from '@workbench/shared';
import { Badge, Btn, Modal, ModalFooter } from '../../components/ui.tsx';

/**
 * 挂载二级弹窗（skill-workflow-isolation 二轮定案）。
 *
 * 从配置弹窗各工作流行的「＋ 挂载」进入，进入时指定目标份（targetWorkflowId 或 files）：
 * - 主区 = 目标份的完整编辑（技能目录按 电商/小红书/通用 分组 + 搜索框，分区标题吸顶）；
 *   目标份为文件时主区 = 文件目录（勾选 + 上传由父组件承担，此处只回传勾选）；
 * - 其余份与文件以只读摘要呈现（一屏看到全部工作流，变更只落目标份）；
 * - 勾选先暂存，「完成」一次性回传目标份列表；取消/Esc/遮罩 = 丢弃暂存（有变更先 confirm）。
 */

const CATEGORY_ORDER = ['电商', '小红书', '通用'];

function categoryRank(c: string): number {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
}

/** 挂载目标：某工作流的技能份，或文件（全局一份） */
export type MountTarget = { kind: 'ecom' | 'xhs'; workflowId: string; label: string } | { kind: 'files'; label: string };

export function SkillMountPicker({
  open,
  target,
  catalog,
  initial,
  initialFiles,
  summarySkills,
  summaryFiles,
  fileCatalog,
  onCancel,
  onComplete,
  onUploadFile,
  uploading,
}: {
  open: boolean;
  target: MountTarget;
  /** 技能目录（父组件已加载） */
  catalog: AgentSkillInfo[];
  /** 目标份打开时的挂载键列表（skills）或文件列表（files） */
  initial: string[];
  /** 文件目标时的初始列表（= initial，语义命名便于调用方） */
  initialFiles?: never;
  /** 另一工作流份的只读摘要：workflowId → 已挂列表 */
  summarySkills: Record<string, string[]>;
  /** 文件只读摘要（技能目标时展示） */
  summaryFiles: string[];
  fileCatalog: { id: string; name: string }[];
  onCancel: () => void;
  onComplete: (next: string[]) => void;
  onUploadFile?: () => void;
  uploading?: boolean;
}) {
  const [staged, setStaged] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) {
      setStaged([...initial]);
      setQuery('');
    }
  }, [open, initial]);

  const byKey = useMemo(() => {
    const m = new Map<string, AgentSkillInfo>();
    for (const s of catalog) {
      m.set(s.id, s);
      if (!m.has(s.name)) m.set(s.name, s);
    }
    return m;
  }, [catalog]);

  const isFilesTarget = target.kind === 'files';

  const groups = useMemo(() => {
    if (isFilesTarget) return [];
    const q = query.trim().toLowerCase();
    const map = new Map<string, AgentSkillInfo[]>();
    for (const s of catalog) {
      if (q && !`${s.name} ${s.description}`.toLowerCase().includes(q)) continue;
      const c = s.category || '通用';
      const list = map.get(c);
      if (list) list.push(s);
      else map.set(c, [s]);
    }
    return [...map.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]));
  }, [catalog, query, isFilesTarget]);

  const toggle = (key: string, name?: string) => {
    const id = name && byKey.has(key) ? key : key;
    setStaged((prev) => {
      const norm = name && byKey.get(name)?.id === key ? key : key;
      void id;
      void norm;
      const has = prev.includes(key);
      return has ? prev.filter((x) => x !== key) : [...prev, key];
    });
  };

  const requestClose = () => {
    const changed = staged.length !== initial.length || staged.some((k) => !initial.includes(k));
    if (changed && !window.confirm('有未保存的挂载变更，确定放弃并关闭？')) return;
    onCancel();
  };

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

  const changedCount = staged.filter((k) => !initial.includes(k)).length + initial.filter((k) => !staged.includes(k)).length;
  const otherWorkflowSummaries = Object.entries(summarySkills);

  return (
    <Modal open={open} title={`挂载 · ${target.label}`} onClose={requestClose} width={640}>
      {/* 主区：目标份完整编辑 */}
      <div className="rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
        <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
          <span className="text-[13px] font-medium">{target.label} · 选择要挂载的内容</span>
          <input
            className="qs-input max-w-[220px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索技能名称或描述…"
          />
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {isFilesTarget ? (
            // 文件目标：目录勾选（上传按钮由父组件在上传入口承担）
            fileCatalog.length === 0 ? (
              <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>文件目录为空，可先在下方上传</div>
            ) : (
              <div className="space-y-1">
                {fileCatalog.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                    onClick={() => toggle(f.id)}
                  >
                    {checkBox(staged.includes(f.id))}
                    <span className="min-w-0 flex-1 truncate text-[13px]">{f.name}</span>
                    <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>FILE</span>
                  </button>
                ))}
              </div>
            )
          ) : groups.length === 0 ? (
            <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
              {query ? '没有匹配的技能' : '技能目录为空或暂不可用'}
            </div>
          ) : (
            groups.map(([category, list]) => {
              const mountedCount = list.filter((s) => staged.includes(s.id) || staged.includes(s.name)).length;
              return (
                <div key={category} className="mb-2 last:mb-0">
                  <div
                    className="sticky top-0 z-10 flex items-center justify-between px-2 py-1.5"
                    style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)' }}
                  >
                    <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>{category}</span>
                    <span className="qs-meta text-[10px]" style={{ color: mountedCount > 0 ? 'var(--color-signal-strong)' : 'var(--color-ink-faint)' }}>
                      已挂 {mountedCount}/{list.length}
                    </span>
                  </div>
                  {list.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                      onClick={() => toggle(s.id, s.name)}
                    >
                      {checkBox(staged.includes(s.id) || staged.includes(s.name))}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{s.name}</span>
                        {s.description ? (
                          <span className="qs-meta block truncate" style={{ color: 'var(--color-ink-faint)' }}>{s.description}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 只读摘要：其余工作流份 + 文件（一屏看到全部工作流，变更只落目标份） */}
      {!isFilesTarget ? (
        <div className="mt-2.5 space-y-1.5">
          {otherWorkflowSummaries.map(([wf, list]) => (
            <div key={wf} className="flex items-center gap-2 px-1">
              <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>{wf === 'ecom-new-listing' ? '电商工作流' : wf === 'xhs-note' ? '小红书工作流' : wf}</span>
              <span className="qs-meta min-w-0 flex-1 truncate" style={{ color: 'var(--color-ink-soft)' }}>
                {list.length > 0 ? list.join('、') : '未挂载'}
              </span>
              <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>已挂 {list.length}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 px-1">
            <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>文件</span>
            <span className="qs-meta min-w-0 flex-1 truncate" style={{ color: 'var(--color-ink-soft)' }}>
              {summaryFiles.length > 0 ? summaryFiles.join('、') : '未挂载'}
            </span>
            <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>已挂 {summaryFiles.length}</span>
          </div>
        </div>
      ) : null}

      <ModalFooter>
        {changedCount > 0 ? <Badge tone="signal">{changedCount} 项变更</Badge> : null}
        <Btn onClick={requestClose}>取消</Btn>
        <Btn variant="primary" onClick={() => onComplete([...staged])}>完成</Btn>
      </ModalFooter>
    </Modal>
  );
}
