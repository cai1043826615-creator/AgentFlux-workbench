/**
 * 沙盒引导挂载点（SandboxGuideMount）
 *
 * 【新增组件前置声明】（约束见 AGENTS.md G2）
 * 1. 现有组件为何不行：查过组件注册表，注册表内没有「按运行条件挂载引导」这类宿主组件；
 *    本文件也不新造 UI——它只做三件事：判定沙盒模式、管理「是否已看过」的 localStorage 状态、
 *    把 GuideTour（自绘浮层）与 GuideReplayButton（小入口）挂到应用外壳上。
 * 2. 复用范围：仅 App.tsx 一处挂载；但它把「沙盒判定 + 首次自动弹 + 重播入口」三件事收敛在一处，
 *    后续沙盒加新教学浮层（如热点三分组提示）可直接复用本宿主。
 * 3. 是否应提升为通用组件：否。它是沙盒专属宿主（非沙盒模式必须零渲染），提升为通用组件反而
 *    会把「沙盒」这个构建期概念带进正式链路。
 *
 * 重要：非沙盒模式下本组件返回 null —— 连一个 DOM 节点都不渲染，正式工作台完全不受影响。
 */
import { useCallback, useEffect, useState } from 'react';
import { GuideReplayButton, GuideTour, isSandboxMode } from './GuideTour.tsx';

/** localStorage 记忆键（与 GuideTour 共用同一键名；此处重复声明字符串常量，避免跨文件隐式耦合） */
const SEEN_KEY = 'wb.guideTour.seen';

/**
 * 自动开始的等待策略：轮询等「第①步的目标元素真的在 DOM 里」再启动，而不是死等固定毫秒。
 * 背景（实测踩到的坑）：固定延迟 / 只等 main 出现时，左栏 aside 的导航项还没渲染完，
 * 第①步目标查不到会被自动跳过，用户看到的第一屏直接从「第二步」开始。
 * 这里改为：等到首屏引导锚点就绪（或超时）才开演。
 */
const AUTO_START_TIMEOUT = 8000;
const AUTO_START_TICK = 150;
/**
 * 首屏就绪锚点：左栏导航项（容器 aside 内的 .qs-nav-item）+ 主区按钮都已渲染。
 * 注意用 `aside .qs-nav-item` 判断**是否存在**是合法的（这里是要元素，不是当容器）。
 */
function firstScreenReady(): boolean {
  return document.querySelector('aside .qs-nav-item') != null && document.querySelector('main button') != null;
}

export function SandboxGuideMount() {
  const sandbox = isSandboxMode();
  const [open, setOpen] = useState(false);

  // 首次进入沙盒：没看过就自动开始（看过则刷新不重复弹）
  useEffect(() => {
    if (!sandbox) return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      seen = false; // 隐私模式：读不到就当作没看过（宁可多弹一次，也不要静默失效）
    }
    if (seen) return;

    let done = false;
    const startedAt = Date.now();
    const tick = window.setInterval(() => {
      if (done) return;
      if (firstScreenReady() || Date.now() - startedAt > AUTO_START_TIMEOUT) {
        done = true;
        window.clearInterval(tick);
        setOpen(true);
      }
    }, AUTO_START_TICK);
    return () => window.clearInterval(tick);
  }, [sandbox]);

  /** 重看：清掉「已看过」标记并重播（引导结束时才会重新写回标记） */
  const replay = useCallback(() => {
    try {
      window.localStorage.removeItem(SEEN_KEY);
    } catch {
      /* 忽略 */
    }
    setOpen(true);
  }, []);

  // 非沙盒模式：零渲染（这是「非沙盒不受影响」的硬保证）
  if (!sandbox) return null;

  return (
    <>
      {open ? <GuideTour open onClose={() => setOpen(false)} /> : null}
      {!open ? <GuideReplayButton onReplay={replay} /> : null}
    </>
  );
}
