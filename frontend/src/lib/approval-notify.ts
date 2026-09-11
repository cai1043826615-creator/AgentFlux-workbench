/**
 * B9 待确认浏览器通知（task-alerts · 12.x/13.x，纯前端，后端零改动）：
 * - 发送判定：用户开关为开 && Notification.permission === 'granted' &&
 *   document.visibilityState === 'hidden' && (taskId, stage) 未去重
 * - 去重键 `${taskId}:${stage}`：同一 (taskId, stage) 会话内只发一次
 * - 通知不可用路径（未授权 / 不支持 Notification / 用户开关关闭）→ document.title
 *   交替闪烁降级（携待确认数量），窗口聚焦或待确认清空时复位并停定时器
 * - 权限仅在用户显式调用 requestNotificationPermission() 时申请（绝不自动调用）
 * - 开关状态存 localStorage（纯本地，不落库、不走接口）
 */
import { WORKFLOW_STAGE_LABELS } from '@workbench/shared';

const STORAGE_KEY = 'approval-alerts-enabled';

/** 会话级去重键集合（(taskId, stage) 只发一次） */
const seenKeys = new Set<string>();
/** 待确认任务 id 集合（标题闪烁数量口径：任务级） */
let pendingIds = new Set<number>();
let blinkTimer: ReturnType<typeof setInterval> | null = null;
let originalTitle = '';
let titleCaptured = false;

export type NotifyOutcome = 'notification' | 'blink' | 'silent';

function storageGet(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** 用户开关当前是否开启（默认开；localStorage 不可用时回退开） */
export function isAlertsEnabled(): boolean {
  return storageGet();
}

/** 写入开关状态（纯本地）；关闭时立即复位标题闪烁 */
export function setAlertsEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (!on) stopBlink();
}

export function notificationSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * 申请通知权限 —— 仅供用户在「开启通知」入口显式点击时调用（12.5）。
 * 不支持时返回 null；调用方据此隐藏入口。
 */
export function requestNotificationPermission(): Promise<NotificationPermission> | null {
  if (typeof Notification === 'undefined') return null;
  return Notification.requestPermission();
}

/** 当前待确认任务数量（标题闪烁 / 角标用） */
export function pendingCount(): number {
  return pendingIds.size;
}

/**
 * 由 App/store 同步当前待确认任务 id 集合（轮询/广播后幂等调用）：
 * 全部清空时停止闪烁并复位标题（12.8）。
 */
export function syncPendingTaskIds(ids: number[]): void {
  pendingIds = new Set(ids);
  if (pendingIds.size === 0) stopBlink();
}

function stopBlink(): void {
  if (blinkTimer != null) {
    clearInterval(blinkTimer);
    blinkTimer = null;
  }
  if (titleCaptured) {
    document.title = originalTitle;
    titleCaptured = false;
  }
}

/** 窗口聚焦 → 复位标题并停闪烁（12.7「点击回窗口后标题复位」/ 12.8） */
export function onWindowFocus(): void {
  stopBlink();
}

function startBlink(): void {
  if (blinkTimer != null) return; // 12.8：不叠加多个定时器
  let toggle = false;
  const tick = () => {
    toggle = !toggle;
    document.title = toggle ? `(${pendingIds.size}) 待确认 · ${originalTitle}` : originalTitle;
  };
  tick();
  blinkTimer = setInterval(tick, 1000);
}

/**
 * 处理一次 approval:prompt 广播。返回实际采用的路径：
 * - 'notification'：已发送浏览器通知（仅 开 + 已授权 + 后台 + 未去重）
 * - 'blink'：走标题闪烁降级（通知不可用且页面在后台）
 * - 'silent'：页面可见（不打扰，角标/Toast 由 store 负责）
 * openTask 注入「点击通知打开任务详情」回调（App 层提供路由跳转）。
 */
export function handleApprovalPrompt(
  p: { taskId: number; stage: string; taskTitle?: string },
  openTask?: (taskId: number) => void,
): NotifyOutcome {
  if (typeof document === 'undefined') return 'silent';
  if (!titleCaptured) {
    originalTitle = document.title;
    titleCaptured = true;
  }
  const hidden = document.visibilityState === 'hidden';
  const canNotify = storageGet() && notificationSupported() && notificationPermission() === 'granted';
  const key = `${p.taskId}:${p.stage}`;

  if (canNotify && hidden && !seenKeys.has(key)) {
    seenKeys.add(key);
    const label = WORKFLOW_STAGE_LABELS[p.stage] ?? p.stage;
    const title = `待确认：${p.taskTitle ? `${p.taskTitle} · ` : ''}#${p.taskId} ${label}`;
    const n = new Notification(title, { body: `任务 #${p.taskId} 进入待确认 · ${label}` });
    n.onclick = () => {
      window.focus();
      openTask?.(p.taskId);
      n.close();
    };
    return 'notification';
  }

  // 通知不可用路径（未授权 / 不支持 / 开关关闭）且页面在后台 → 标题闪烁降级（12.7/13.3）
  if (!canNotify && hidden) {
    pendingIds.add(p.taskId);
    startBlink();
    return 'blink';
  }

  return 'silent';
}
