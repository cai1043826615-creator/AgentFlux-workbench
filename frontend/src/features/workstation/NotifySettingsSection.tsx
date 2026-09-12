import { useState } from 'react';
import { Badge, Btn } from '../../components/ui.tsx';
import {
  isAlertsEnabled,
  notificationPermission,
  requestNotificationPermission,
  setAlertsEnabled,
} from '../../lib/approval-notify.ts';

/**
 * 通知设置分区（P1·3.2：从顶栏 NotifyControl 迁入「运行设置」弹窗）。
 *
 * 语义保持不变（B9 · 13.1/12.5）：
 * - 本地开关存 localStorage，不落库；
 * - **仅显式点击「开启通知」才申请浏览器权限**——打开设置弹窗本身不得触发申请；
 * - 权限被拒时给出可操作的指引（地址栏站点设置），且不阻塞其他操作。
 */
export function NotifySettingsSection() {
  const [enabled, setEnabled] = useState(() => isAlertsEnabled());
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => notificationPermission());

  const request = async () => {
    const r = await requestNotificationPermission();
    if (r) setPerm(r);
  };

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer select-none items-start gap-2.5" title="待确认浏览器通知（本地保存，不落库）">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-signal)]"
          aria-label="待确认浏览器通知"
          checked={enabled}
          onChange={(e) => {
            const v = e.target.checked;
            setAlertsEnabled(v);
            setEnabled(v);
          }}
        />
        <span className="min-w-0">
          <span className="block text-[13px]">待确认时发送浏览器通知</span>
          <span className="qs-meta block text-[12px]" style={{ color: 'var(--color-ink-faint)' }}>
            仅保存在本机，不上传、不落库
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <span className="qs-meta shrink-0" style={{ color: 'var(--color-ink-soft)' }}>
          浏览器授权
        </span>
        {perm === 'default' ? (
          <Btn size="sm" variant="ghost" onClick={() => void request()}>
            开启通知
          </Btn>
        ) : perm === 'granted' ? (
          <Badge tone="ok">已授权</Badge>
        ) : perm === 'denied' ? (
          <Badge tone="no">已拒绝</Badge>
        ) : (
          <span className="qs-meta" style={{ color: 'var(--color-ink-faint)' }}>
            当前浏览器不支持
          </span>
        )}
      </div>

      {/* 权限被拒：给出可操作指引（P1·3.4） */}
      {perm === 'denied' ? (
        <p
          className="rounded-[4px] border px-3 py-2 text-[12px] leading-relaxed"
          style={{ borderColor: 'var(--color-line-strong)', background: 'var(--color-sunken)', color: 'var(--color-ink-soft)' }}
          role="note"
        >
          浏览器已拒绝通知权限，无法自动重新申请。请手动开启：点击地址栏左侧的「站点信息 / 锁形」图标 → 在「通知」一栏选择「允许」→
          刷新页面后回到此处点「开启通知」。
        </p>
      ) : null}
    </div>
  );
}
