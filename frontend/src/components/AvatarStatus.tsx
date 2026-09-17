/**
 * 【新增组件前置声明】
 * 1. 现有组件为何不行：查过 §3 组件注册表——Avatar 只画头像本身，不含「右下角状态点」；
 *    qs-dot 是 CSS 类不是组件，各调用方各自拼 `relative + absolute -bottom-0.5 -right-0.5`
 *    与描边色，导致 5 处写法各异（状态点尺寸 7/10/默认、描边 surface/sunken 不统一）。
 * 2. 复用范围：5 处（ChatPanel 会话切换头像、KnowledgeOverviewBar 小助理入口、ObservabilityView
 *    Agent 卡、AgentCard 工位卡、App 右栏折叠头像列），且新工作流页面会继续复用。
 * 3. 是否应提升为通用组件：是。它是「头像 + 状态点」的组合原子，已登记入规范 §3。
 *
 * 抽取来源：5 处重复实现（各 2~3 行）。差异通过 props 表达：
 *   - size：头像尺寸（原 20/22/32/36/40）
 *   - dotSize：状态点直径（原 7 / 10 / 用 qs-dot 默认）
 *   - ringColor：状态点外描边色（原 surface 亮底 / sunken 内收底）
 *   - statusClass / statusColor：状态色（各调用方用不同的映射源：agentDotClass / AGENT_DOT / meta.dot）
 */
import { Avatar } from './ui.tsx';

export function AvatarStatus({
  name,
  id,
  size,
  statusClass,
  statusColor,
  dotSize,
  ringColor = 'var(--color-surface)',
  title,
  avatarTitle,
  /** 头像外圈的选中态描边（如右栏折叠头像列的 active 紫圈） */
  active = false,
  className = '',
}: {
  name: string;
  id?: string;
  /** 头像尺寸（px） */
  size: number;
  /** 状态点的 CSS 类（如 'qs-dot ok'）；与 statusColor 二选一 */
  statusClass?: string;
  /** 状态点的背景色（如 agentColor(status)）；与 statusClass 二选一 */
  statusColor?: string;
  /** 状态点直径（px）；不传则用 qs-dot 默认尺寸 */
  dotSize?: number;
  /** 状态点外描边色，用于与背景分离 */
  ringColor?: string;
  /** 状态点 title（如 dotLabel(status)） */
  title?: string;
  /** 头像自身的 title（通常是「名字（角色）· 状态」） */
  avatarTitle?: string;
  /** 头像选中态：紫色外圈 */
  active?: boolean;
  className?: string;
}) {
  const ringWidth = dotSize && dotSize <= 8 ? 1.5 : 2;

  return (
    <span
      className={`relative inline-block ${className}`.trim()}
      style={{ outline: active ? '2px solid var(--color-signal)' : 'none', outlineOffset: 2, borderRadius: 999 }}
    >
      <Avatar name={name} id={id} size={size} title={avatarTitle} />
      <span
        className={`qs-dot absolute -bottom-0.5 -right-0.5 ${statusClass ?? ''}`.trim()}
        style={{
          ...(statusColor ? { background: statusColor } : {}),
          ...(dotSize ? { width: dotSize, height: dotSize } : {}),
          boxShadow: `0 0 0 ${ringWidth}px ${ringColor}`,
        }}
        title={title}
      />
    </span>
  );
}
