import type { ReactNode } from 'react';
import { dirDisplayName } from './dirDisplayName.ts';

/**
 * 知识库公共侧栏（P1·5.5，意见 #6 + N9）。
 *
 * 抽取目标（只共用**容器与折叠控件**，不强行统一两页的过滤交互）：
 * - 容器：`qs-card` + 固定宽度 + 可折叠
 * - 折叠控件：位于面板**标题栏内**，紧邻它所控制的目录树（修意见 #6「操作与对象分离」）
 * - 收起态：保留一个紧邻列表的窄条展开控件（保证可逆）
 *
 * 知识库页与知识星图页的「过滤控件」差异较大（前者：目录筛选 + 标签云；后者：目录单选 +
 * 重点目录 + 标签多选 + 孤岛开关），故过滤控件由调用方以 `children` 传入，本组件不假设其形态。
 */
export function KnowledgeSidebar({
  open,
  title,
  onToggle,
  onExpand,
  width = 240,
  children,
  footer,
}: {
  open: boolean;
  /** 标题栏文案（如「目录」） */
  title: string;
  onToggle: () => void;
  onExpand: () => void;
  width?: number;
  /** 过滤控件（各页自定） */
  children: ReactNode;
  /** 可选：面板底部的附加区块（如标签云） */
  footer?: ReactNode;
}) {
  if (!open) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          className="qs-clickable qs-meta whitespace-nowrap rounded-[4px] border px-2 py-1"
          style={{ borderColor: 'var(--color-line-strong)', color: 'var(--color-ink-soft)' }}
          onClick={onExpand}
          title={`展开${title}`}
          aria-label={`展开${title}`}
        >
          ▶ {title}
        </button>
      </div>
    );
  }

  return (
    /* report-driven-fixes 2.11/2.14：去掉 self-start，改由行容器拉伸（items-stretch）+ min-h-0 内部滚动，
       左栏自身内容超高时滚动而不撑高页面（知识库页与知识星图页共用） */
    <aside className="qs-card flex min-h-0 shrink-0 flex-col overflow-y-auto p-3" style={{ width }}>
      {/* 标题栏：折叠控件紧邻其控制的对象（意见 #6） */}
      <div className="mb-2 flex items-center justify-between">
        <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
          {title}
        </span>
        <button
          type="button"
          className="qs-clickable qs-meta"
          style={{ color: 'var(--color-ink-soft)' }}
          onClick={onToggle}
          title={`收起${title}`}
          aria-label={`收起${title}`}
        >
          ◀
        </button>
      </div>
      {children}
      {footer}
    </aside>
  );
}

/** 目录树递归行（两页共用：知识库页用于筛选文档列表，星图页用于单目录过滤） */
export function DirTreeRow({
  dir,
  label,
  depth,
  hasChildren,
  collapsed,
  active,
  count,
  onToggleExpand,
  onPick,
}: {
  dir: string;
  label?: string;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  active: boolean;
  count?: number;
  onToggleExpand: () => void;
  onPick: () => void;
}) {
  return (
    <div className="flex items-center gap-1" style={{ paddingLeft: depth * 10 }}>
      <button
        type="button"
        className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center text-[10px]"
        style={{ color: 'var(--color-ink-faint)', visibility: hasChildren ? 'visible' : 'hidden' }}
        onClick={onToggleExpand}
        aria-label={collapsed ? '展开目录' : '折叠目录'}
      >
        <span style={{ display: 'inline-block', transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>›</span>
      </button>
      <button
        type="button"
        className={`min-w-0 flex-1 cursor-pointer truncate rounded-[4px] px-1.5 py-1 text-left text-[12px] transition-colors ${active ? 'font-semibold' : ''}`}
        style={{ background: active ? 'var(--color-signal-soft)' : 'transparent', color: active ? 'var(--color-signal)' : 'var(--color-ink-soft)' }}
        onClick={onPick}
        title={`${label ?? dirDisplayName(dir)}（真实路径：${dir}）`}
      >
        {label ?? dirDisplayName(dir)}
      </button>
      {count != null ? <span className="qs-meta tabular shrink-0">{count}</span> : null}
    </div>
  );
}
