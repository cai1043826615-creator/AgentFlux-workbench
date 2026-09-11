/**
 * B9 待确认浏览器通知 单测（12.1 四组 + 12.5 不自动申请 + 12.7 标题闪烁 + 12.8 定时器清理）
 * 用 globalThis 桩模拟 window.Notification / document / localStorage / setInterval。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

// 先建桩再动态导入模块（模块顶层只读 import，无副作用；桩作用于调用期）
const notifications: { title: string; opts: NotificationOptions; instance: { closeCalls: number; onclick: (() => void) | null } }[] = [];
let requestPermissionCalls = 0;
let enabled = true;
const storage = new Map<string, string>();

const stub = {
  Notification: class {
    static permission: NotificationPermission = 'granted';
    static requestPermission(): Promise<NotificationPermission> {
      requestPermissionCalls += 1;
      return Promise.resolve('granted');
    }
    title: string;
    opts: NotificationOptions;
    closeCalls = 0;
    onclick: (() => void) | null = null;
    constructor(title: string, opts?: NotificationOptions) {
      this.title = title;
      this.opts = opts ?? {};
      notifications.push({ title, opts: this.opts, instance: this });
    }
    close() {
      this.closeCalls += 1;
    }
  },
  document: { visibilityState: 'visible' as DocumentVisibilityState, title: '电商工作台' },
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  },
  window: { focus: () => undefined },
};

(globalThis as Record<string, unknown>).Notification = stub.Notification;
(globalThis as Record<string, unknown>).document = stub.document;
(globalThis as Record<string, unknown>).localStorage = stub.localStorage;
(globalThis as Record<string, unknown>).window = stub.window;

// WORKBENCH_DB 无关；模块只读共享包，无需 temp。保留 tmp 防未来依赖
const _tmp = mkdtempSync(join(tmpdir(), 'appr-notify-'));

const { handleApprovalPrompt, onWindowFocus, syncPendingTaskIds, setAlertsEnabled, isAlertsEnabled, notificationSupported, notificationPermission, requestNotificationPermission } = await import('../approval-notify.ts');

function resetEnv(opts: { visibility?: DocumentVisibilityState; permission?: NotificationPermission; enabled?: boolean } = {}) {
  notifications.length = 0;
  requestPermissionCalls = 0;
  storage.clear();
  stub.document.visibilityState = opts.visibility ?? 'visible';
  stub.document.title = '电商工作台';
  (stub.Notification as unknown as { permission: NotificationPermission }).permission = opts.permission ?? 'granted';
  enabled = opts.enabled ?? true;
  storage.set('approval-alerts-enabled', enabled ? '1' : '0');
  syncPendingTaskIds([]);
  onWindowFocus();
}

/** 确定性定时器桩：捕获回调手动推进；返回清理函数 */
function stubTimers() {
  const realSet = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  let captured: (() => void) | null = null;
  let clears = 0;
  globalThis.setInterval = ((fn: () => void) => {
    captured = fn;
    return 42;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => {
    clears += 1;
    captured = null;
  }) as typeof clearInterval;
  return {
    tick: () => captured?.(),
    clears: () => clears,
    restore: () => {
      globalThis.setInterval = realSet;
      globalThis.clearInterval = realClear;
    },
  };
}

describe('12.1 通知发送判定', () => {
  after(() => resetEnv());

  test('页面可见时不发（不打扰，交给角标/Toast）', () => {
    resetEnv({ visibility: 'visible', permission: 'granted', enabled: true });
    const out = handleApprovalPrompt({ taskId: 1, stage: 'copy' });
    assert.equal(out, 'silent');
    assert.equal(notifications.length, 0);
    assert.equal(requestPermissionCalls, 0, '本模块绝不自动申请权限');
  });

  test('隐藏且已授权时发；标题含 #id 与阶段中文名', () => {
    resetEnv({ visibility: 'hidden', permission: 'granted', enabled: true });
    const out = handleApprovalPrompt({ taskId: 7, stage: 'copy', taskTitle: '磁吸充电宝' });
    assert.equal(out, 'notification');
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0].title.includes('#7'), '标题应含任务 id');
    assert.ok(notifications[0].title.includes('卖点文案'), '标题应含阶段中文名');
    assert.ok(notifications[0].title.includes('磁吸充电宝'), '任务标题可得时一并带上');
  });

  test('重复广播（同 taskId+stage）只发 1 次', () => {
    resetEnv({ visibility: 'hidden', permission: 'granted', enabled: true });
    assert.equal(handleApprovalPrompt({ taskId: 3, stage: 'main-image' }), 'notification');
    assert.equal(handleApprovalPrompt({ taskId: 3, stage: 'main-image' }), 'silent');
    assert.equal(notifications.length, 1);
  });

  test('开关关闭时不发（走标题闪烁降级）', () => {
    resetEnv({ visibility: 'hidden', permission: 'granted', enabled: false });
    const timers = stubTimers();
    try {
      const out = handleApprovalPrompt({ taskId: 9, stage: 'copy' });
      assert.equal(out, 'blink');
      assert.equal(notifications.length, 0);
    } finally {
      timers.restore();
    }
  });

  test('未注册 Notification 时不抛错（静默降级）', () => {
    resetEnv({ visibility: 'hidden', permission: 'denied' });
    const saved = (globalThis as Record<string, unknown>).Notification;
    (globalThis as Record<string, unknown>).Notification = undefined;
    try {
      assert.equal(notificationSupported(), false);
      assert.equal(notificationPermission(), 'unsupported');
      assert.equal(requestNotificationPermission(), null);
      const timers = stubTimers();
      try {
        assert.equal(handleApprovalPrompt({ taskId: 5, stage: 'detail-image' }), 'blink');
        assert.equal(notifications.length, 0);
      } finally {
        timers.restore();
      }
    } finally {
      (globalThis as Record<string, unknown>).Notification = saved;
    }
  });

  test('requestNotificationPermission 仅显式调用可用', () => {
    resetEnv({ visibility: 'visible' });
    assert.equal(requestPermissionCalls, 0);
    void requestNotificationPermission();
    assert.equal(requestPermissionCalls, 1);
  });
});

describe('12.7/12.8 标题闪烁降级与清理', () => {
  test('隐藏 + 未授权 → 标题交替且含待确认条数；聚焦复位并停定时器', () => {
    resetEnv({ visibility: 'hidden', permission: 'denied', enabled: true });
    const timers = stubTimers();
    try {
      handleApprovalPrompt({ taskId: 1, stage: 'copy' }); // 启动闪烁：首拍即显示 (1) 待确认
      handleApprovalPrompt({ taskId: 2, stage: 'main-image' }); // 计数 +1，定时器不叠加
      timers.tick(); // 交替回原名
      assert.ok(stub.document.title.startsWith('电商工作台'), `应交替回原名：${stub.document.title}`);
      timers.tick(); // 再次交替：显示最新条数
      assert.ok(stub.document.title.includes('(2) 待确认'), `标题应含条数：${stub.document.title}`);
      assert.equal(timers.clears(), 0, '聚焦前定时器仍在');
      onWindowFocus();
      assert.equal(timers.clears(), 1, '聚焦应清理定时器');
      assert.equal(stub.document.title, '电商工作台', '聚焦后标题复位');
    } finally {
      timers.restore();
    }
  });

  test('连续 3 次待确认不叠加定时器；清空后停止', () => {
    resetEnv({ visibility: 'hidden', permission: 'denied', enabled: true });
    const timers = stubTimers();
    try {
      for (const stage of ['copy', 'main-image', 'detail-image']) handleApprovalPrompt({ taskId: 4, stage });
      assert.equal(timers.clears(), 0);
      syncPendingTaskIds([]);
      assert.equal(timers.clears(), 1, '全部待确认清空应停定时器');
      assert.equal(stub.document.title, '电商工作台');
    } finally {
      timers.restore();
    }
  });
});

describe('13.x 开关状态', () => {
  test('开关读写 localStorage（默认开；关闭后 isAlertsEnabled=false）', () => {
    resetEnv({ enabled: true });
    assert.equal(isAlertsEnabled(), true);
    setAlertsEnabled(false);
    assert.equal(isAlertsEnabled(), false);
    assert.equal(storage.get('approval-alerts-enabled'), '0');
    setAlertsEnabled(true);
    assert.equal(storage.get('approval-alerts-enabled'), '1');
  });
});
