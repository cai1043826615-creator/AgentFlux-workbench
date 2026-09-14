import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSkillInfo } from '@workbench/shared';
import { Badge, Btn, Modal, ModalFooter } from '../../components/ui.tsx';

/**
 * 挂载选择二级弹窗（skill-workflow-isolation · 验收 #6 打回）。
 *
 * 交互（design D4/D5）：
 * - 左右两栏：左=已挂载（分类徽标 / 失效标红 / ×移除），右=可挂目录（电商/小红书/通用 分区 + 搜索框）；
 * - 内容区可滚动（max-height: 70vh + overflow-y:auto），分区标题吸顶；
 * - 勾选先暂存组件内 state（以打开时的挂载列表初始化），「完成」一次性回传，
 *   取消 / Esc / 遮罩关闭 = 丢弃暂存（有未保存变更时先 confirm）；
 * - 打开期间外层配置弹窗禁止滚动（防滚动穿透，由父组件在 open 变化时切换 overflow）。
 * 文件挂载不进本弹窗（保持配置弹窗内联添加——用户验收原话只针对 skill 选择）。
 */

const CATEGORY_ORDER = ['电商', '小红书', '通用'];

/** 分类排序：电商 → 小红书 → 通用 → 未知分类排最后（与后端 categoryRank 语义一致） */
function categoryRank(c: string): number {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
}

export function SkillMountPicker({
  open,
  catalog,
  initial,
  onCancel,
  onComplete,
}: {
  open: boolean;
  /** 技能目录（父组件已加载；本组件不重复请求） */
  catalog: AgentSkillInfo[];
  /** 打开时的挂载键列表（id 或展示名，agents.skills 原样） */
  initial: string[];
  onCancel: () => void;
  /** 「完成」：回传全量挂载键（归一化为目录 id，保持既有保存负载形状） */
  onComplete: (next: string[]) => void;
}) {
  const [staged, setStaged] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 每次打开按当时的挂载列表初始化暂存；关闭时清搜索词
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

  const infoOf = (key: string): AgentSkillInfo | null => byKey.get(key) ?? null;

  /** 分区（与配置弹窗同语义）：电商 → 小红书 → 通用 → 未知分类原样排最后 */
  const groups = useMemo(() => {
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
  }, [catalog, query]);

  /** 勾选切换：统一归一化为目录 id 存入暂存（避免同名键产生重复挂载） */
  const toggle = (s: AgentSkillInfo) => {
    setStaged((prev) => {
      const has = prev.includes(s.id) || prev.includes(s.name);
      if (has) return prev.filter((x) => x !== s.id && x !== s.name);
      return [...prev.filter((x) => x !== s.name), s.id];
    });
  };

  const isStaged = (key: string) => staged.includes(key) || staged.includes(byKey.get(key)?.name ?? '\u0000');

  /** 有未保存变更时，关闭前确认（沿用浏览器 confirm 的项目既有风格） */
  const requestClose = () => {
    const changed =
      staged.length !== initial.length || staged.some((k) => !initial.includes(k));
    if (changed && !window.confirm('有未保存的挂载变更，确定放弃并关闭？')) return;
    onCancel();
  };

  const finish = () => onComplete([...staged]);

  /** 勾选方块（与配置弹窗同款视觉：已挂 → 紫色填充 + ✓） */
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

  return (
    <Modal open={open} title="挂载 Skill" onClose={requestClose} width={720}>
      <div className="flex gap-3" style={{ height: 'min(70vh, 560px)' }}>
        {/* 左栏：已挂载（含暂存） */}
        <div className="flex w-[268px] shrink-0 flex-col rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
          <div className="flex shrink-0 items-center justify-between border-b px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
            <span className="qs-meta" style={{ color: 'var(--color-ink-soft)' }}>已挂载</span>
            <span className="qs-meta tabular" style={{ color: 'var(--color-ink-faint)' }}>{staged.length}</span>
          </div>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-2">
            {staged.length === 0 ? (
              <div className="qs-meta px-1 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>暂无挂载，从右侧选择</div>
            ) : (
              <div className="space-y-1">
                {staged.map((key) => {
                  const info = infoOf(key);
                  return (
                    <div
                      key={key}
                      className="flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5"
                      style={{ borderColor: 'var(--color-line)', background: 'var(--color-sunken)' }}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px]">{info?.name ?? key}</span>
                      {info?.category ? (
                        <span className="qs-meta shrink-0 rounded-[3px] border px-1 text-[10px]" style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}>
                          {info.category}
                        </span>
                      ) : (
                        // 目录中已不存在 → 幽灵挂载，标红而不是假装生效
                        <span className="qs-meta shrink-0 text-[10px]" style={{ color: 'var(--color-danger)' }}>已失效</span>
                      )}
                      <button
                        type="button"
                        className="qs-meta shrink-0 cursor-pointer px-1 opacity-60 hover:opacity-100"
                        style={{ color: 'var(--color-danger)' }}
                        title="移除"
                        onClick={() => setStaged((prev) => prev.filter((x) => x !== key))}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：可挂目录（分区 + 搜索） */}
        <div className="flex min-w-0 flex-1 flex-col rounded-[4px] border" style={{ borderColor: 'var(--color-line)' }}>
          <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: 'var(--color-line)' }}>
            <input
              className="qs-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能名称或描述…"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {groups.length === 0 ? (
              <div className="qs-meta px-2 py-3 text-center" style={{ color: 'var(--color-ink-faint)' }}>
                {query ? '没有匹配的技能' : '技能目录为空或暂不可用'}
              </div>
            ) : (
              groups.map(([category, list]) => {
                const mountedCount = list.filter((s) => isStaged(s.id) || staged.includes(s.name)).length;
                return (
                  <div key={category} className="mb-2 last:mb-0">
                    {/* 分区标题吸顶 */}
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
                        onClick={() => toggle(s)}
                      >
                        {checkBox(isStaged(s.id))}
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
      </div>

      <div className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
        技能按工作流分类生效：电商任务仅使用「电商 + 通用」类技能，小红书任务仅使用「小红书 + 通用」类技能。
      </div>

      <ModalFooter>
        {changedCount > 0 ? <Badge tone="signal">{changedCount} 项变更</Badge> : null}
        <Btn onClick={requestClose}>取消</Btn>
        <Btn variant="primary" onClick={finish}>完成</Btn>
      </ModalFooter>
    </Modal>
  );
}
