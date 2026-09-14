import { useEffect, useMemo, useState } from 'react';
import type { AgentSkillInfo } from '@workbench/shared';
import { Badge, Btn, Modal, ModalFooter } from '../../components/ui.tsx';

/**
 * 挂载二级弹窗（用户返工定案 2026-09-14）。
 *
 * 核心变化：
 * - **按工作流成对挂载**：一个工作流同时挂「技能 + 文件」，不再有独立的全局文件区；
 * - **只显示当前工作流的界面**：进入哪条工作流的挂载弹窗就只看哪条，不再展示另一条的只读摘要
 *   （只有 Agent 设置主弹窗才展示全部工作流）；
 * - 勾选先暂存，「完成」一次性回传；取消/Esc/遮罩 = 丢弃暂存（有变更先 confirm）。
 */

const CATEGORY_ORDER = ['电商', '小红书', '通用'];

function categoryRank(c: string): number {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
}

/** 挂载目标：一条工作流（技能与文件同属该工作流） */
export interface MountTarget {
  workflowId: string;
  label: string;
  /** 该工作流对应的技能分类目录名（上传技能时落到 技能库/<category>/） */
  category: string;
}

export function SkillMountPicker({
  open,
  target,
  catalog,
  initialSkills,
  initialFiles,
  fileCatalog,
  otherFiles = [],
  onCancel,
  onComplete,
}: {
  open: boolean;
  target: MountTarget;
  /** 技能目录（父组件已加载） */
  catalog: AgentSkillInfo[];
  /** 目标工作流打开时的已挂技能键列表 */
  initialSkills: string[];
  /** 目标工作流打开时的已挂文件列表（Vault 相对路径） */
  initialFiles: string[];
  fileCatalog: { id: string; name: string }[];
  /** 已挂到「另一条」工作流的文件：不出现在本条的可挂列表（用户定案：目录只显示当前工作流可挂的） */
  otherFiles?: string[];
  onCancel: () => void;
  onComplete: (next: { skills: string[]; files: string[] }) => void;
}) {
  const [stagedSkills, setStagedSkills] = useState<string[]>([]);
  const [stagedFiles, setStagedFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  /** 已收起的技能分类（收纳三角） */
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  /** 文件搜索（套用知识库「输入即出候选」交互） */
  const [fileQuery, setFileQuery] = useState('');
  const [fileSuggestOpen, setFileSuggestOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStagedSkills([...initialSkills]);
      setStagedFiles([...initialFiles]);
      setQuery('');
      setCollapsedCategories(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target.workflowId]);

  /**
   * 目录按工作流过滤（用户定案 2026-09-14）：
   * 给电商挂载时只出现「电商 + 通用」分类，小红书分类整组不出现（反之亦然）；
   * 通用类始终可见（兜底区）。未识别分类按通用处理。
   */
  const allowedCategories = useMemo(
    () => (target.category === '电商' ? new Set(['电商', '通用']) : target.category === '小红书' ? new Set(['小红书', '通用']) : null),
    [target.category],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, AgentSkillInfo[]>();
    for (const s of catalog) {
      if (allowedCategories && !allowedCategories.has(s.category || '通用')) continue;
      if (q && !`${s.name} ${s.description}`.toLowerCase().includes(q)) continue;
      const c = s.category || '通用';
      const list = map.get(c);
      if (list) list.push(s);
      else map.set(c, [s]);
    }
    return [...map.entries()].sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]));
  }, [catalog, query, allowedCategories]);

  const mountedSkill = (s: AgentSkillInfo) => stagedSkills.includes(s.id) || stagedSkills.includes(s.name);

  const toggleSkill = (s: AgentSkillInfo) => {
    const key = stagedSkills.includes(s.id) || stagedSkills.includes(s.name) ? (stagedSkills.includes(s.id) ? s.id : s.name) : s.id;
    setStagedSkills((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));
  };

  const toggleFile = (id: string) => {
    setStagedFiles((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** 候选点选/Enter 采纳入口（候选里的文件可能不在下方列表——它可能已挂在当前工作流） */
  const toggleFileById = (id: string) => toggleFile(id);

  /**
   * 文件搜索候选（与知识库同款交互）：输入即过滤，无防抖——文件目录几十条量级直接算。
   * 候选 = 知识库路径，含匹配（大小写不敏感）；已挂到另一条工作流的不进候选；
   * 无输入时不展示。
   */
  const fileSuggestions = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    if (!q) return [] as { id: string }[];
    return fileCatalog
      .filter((f) => !otherFiles.includes(f.id))
      .filter((f) => f.id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [fileQuery, fileCatalog, otherFiles]);

  /** 文件列表：目录过滤（排除另一条的）+ 搜索词过滤（有词时只显示命中项） */
  const visibleFiles = useMemo(() => {
    const q = fileQuery.trim().toLowerCase();
    return fileCatalog.filter((f) => !otherFiles.includes(f.id)).filter((f) => !q || f.id.toLowerCase().includes(q));
  }, [fileCatalog, otherFiles, fileQuery]);

  const changed =
    stagedSkills.length !== initialSkills.length ||
    stagedSkills.some((k) => !initialSkills.includes(k)) ||
    stagedFiles.length !== initialFiles.length ||
    stagedFiles.some((k) => !initialFiles.includes(k));

  const requestClose = () => {
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

  const changedCount =
    stagedSkills.filter((k) => !initialSkills.includes(k)).length +
    initialSkills.filter((k) => !stagedSkills.includes(k)).length +
    stagedFiles.filter((k) => !initialFiles.includes(k)).length +
    initialFiles.filter((k) => !stagedFiles.includes(k)).length;

  return (
    <Modal open={open} title={`挂载 · ${target.label}`} onClose={requestClose} width={640}>
      {/* 技能区（当前工作流可见的全部技能，按 电商/小红书/通用 分组；分区标题吸顶） */}
      <div className="rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
        <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
          <span className="text-[13px] font-medium">技能</span>
          <input
            className="qs-input"
            style={{ width: 176 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder=" "
            aria-label="搜索技能"
          />
        </div>
        <div className="max-h-[30vh] overflow-y-auto">
          {groups.length === 0 ? (
            <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
              {query ? '没有匹配的技能' : '技能目录为空或暂不可用'}
            </div>
          ) : (
            groups.map(([category, list]) => {
              const mountedCount = list.filter(mountedSkill).length;
              const collapsed = collapsedCategories.has(category);
              return (
                <div key={category}>
                  <button
                    type="button"
                    className="sticky top-0 z-10 flex w-full cursor-pointer items-center gap-1.5 px-2 py-1.5"
                    style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)' }}
                    onClick={() =>
                      setCollapsedCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(category)) next.delete(category);
                        else next.add(category);
                        return next;
                      })
                    }
                    title={collapsed ? '展开该分类' : '收起该分类'}
                  >
                    <span
                      className="inline-block text-[10px] leading-none transition-transform"
                      style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(90deg)', color: 'var(--color-ink-faint)' }}
                    >
                      ›
                    </span>
                    <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>{category}</span>
                    <span className="qs-meta text-[10px]" style={{ color: mountedCount > 0 ? 'var(--color-signal-strong)' : 'var(--color-ink-faint)' }}>
                      已挂 {mountedCount}/{list.length}
                    </span>
                  </button>
                  {/* 收起时整组卸载（非 display:none）：滚动位置干净，不会露出被裁的残行 */}
                  {!collapsed
                    ? list.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                          onClick={() => toggleSkill(s)}
                        >
                          {checkBox(mountedSkill(s))}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{s.name}</span>
                            {s.description ? (
                              <span className="qs-meta block truncate" style={{ color: 'var(--color-ink-faint)' }}>{s.description}</span>
                            ) : null}
                          </span>
                        </button>
                      ))
                    : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 文件区（同一工作流下挂载知识库文档；技能库已由后端排除，避免同一文件双重挂载）
          搜索：套用知识库「输入即出候选」交互（onChange 实时过滤 + 候选浮层 + onBlur 延迟收起） */}
      <div className="mt-2.5 rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
        <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
          <span className="text-[13px] font-medium">文件</span>
          <div className="relative" style={{ width: 176 }}>
            <input
              className="qs-input w-full"
              value={fileQuery}
              onChange={(e) => {
                setFileQuery(e.target.value);
                setFileSuggestOpen(true);
              }}
              onFocus={() => setFileSuggestOpen(true)}
              onBlur={() => {
                // 延迟收起，保证候选项的 onClick 先触发（与知识库搜索一致）
                window.setTimeout(() => setFileSuggestOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setFileSuggestOpen(false);
                if (e.key === 'Enter' && fileSuggestions.length > 0) {
                  // Enter 采纳第一个候选：直接勾选
                  const first = fileSuggestions[0];
                  setFileSuggestOpen(false);
                  setFileQuery('');
                  toggleFileById(first.id);
                }
              }}
              placeholder=" "
              aria-label="搜索文件"
              role="combobox"
              aria-expanded={fileSuggestOpen && fileSuggestions.length > 0}
              aria-autocomplete="list"
            />
            {/* 候选浮层（点击 = 勾选该文件） */}
            {fileSuggestOpen && fileSuggestions.length > 0 ? (
              <div
                className="qs-card absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-[220px] overflow-y-auto p-1"
                style={{ boxShadow: '0 4px 12px rgba(10,10,10,0.10)' }}
                role="listbox"
                data-mount-file-suggest
              >
                {fileSuggestions.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="qs-nav-item flex w-full items-center gap-2 text-left"
                    role="option"
                    aria-selected={stagedFiles.includes(f.id)}
                    onClick={() => {
                      toggleFileById(f.id);
                      setFileQuery('');
                      setFileSuggestOpen(false);
                    }}
                  >
                    <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-faint)' }}>文件</span>
                    <span className="min-w-0 flex-1 truncate" title={f.id}>{f.id}</span>
                    <span className="qs-meta shrink-0" style={{ color: stagedFiles.includes(f.id) ? 'var(--color-signal-strong)' : 'var(--color-ink-faint)' }}>
                      {stagedFiles.includes(f.id) ? '已挂' : '勾选'}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="max-h-[24vh] overflow-y-auto p-2">
          {(() => {
            // 目录过滤：已挂到另一条工作流的不出现；再叠加搜索词过滤（visibleFiles）
            if (visibleFiles.length === 0) {
              return (
                <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
                  {fileQuery.trim() ? '没有匹配的文件' : '没有可挂载的文件（知识库为空，或可选文档已挂到另一工作流）'}
                </div>
              );
            }
            return (
              <div className="space-y-1">
                {visibleFiles.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-signal-soft)]"
                    onClick={() => toggleFile(f.id)}
                  >
                    {checkBox(stagedFiles.includes(f.id))}
                    <span className="min-w-0 flex-1 truncate text-[13px]" title={f.id}>{f.id}</span>
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      <ModalFooter>
        {changedCount > 0 ? <Badge tone="signal">{changedCount} 项变更</Badge> : null}
        <Btn onClick={requestClose}>取消</Btn>
        <Btn variant="primary" onClick={() => onComplete({ skills: [...stagedSkills], files: [...stagedFiles] })}>完成</Btn>
      </ModalFooter>
    </Modal>
  );
}
