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
 * UI 对齐（P1-5 验收打回）：与同弹窗内「任务推进方式」的卡片式布局保持一致——
 * 统一 `rounded-[4px] border px-3 py-2.5` 容器、选中/生效态用 signal 边框与浅底、主副文案两行结构。
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
    <div className="space-y-2">
      {/* 本地开关（卡片式，与「任务推进方式」选项同构） */}
      <label
        className="flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2.5 transition-colors"
        style={{
          borderColor: enabled ? 'var(--color-signal)' : 'var(--color-line-strong)',
          background: enabled ? 'var(--color-signal-soft)' : 'var(--color-surface)',
        }}
      >
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
        <span className="min-w-0 text-[13px] leading-snug">
          <span className="block font-medium">待确认时发送浏览器通知</span>
          <span className="qs-meta block" style={{ color: 'var(--color-ink-faint)' }}>
            仅保存在本机，不上传、不落库
          </span>
        </span>
      </label>

      {/* 浏览器授权（同一卡片式；状态右置） */}
      <div
        className="flex items-start gap-2 rounded-[4px] border px-3 py-2.5"
        style={{
          borderColor: perm === 'granted' ? 'var(--color-signal)' : 'var(--color-line-strong)',
          background: perm === 'granted' ? 'var(--color-signal-soft)' : 'var(--color-surface)',
        }}
      >
        <span className="min-w-0 flex-1 text-[13px] leading-snug">
          <span className="block font-medium">浏览器授权</span>
          <span className="qs-meta block" style={{ color: 'var(--color-ink-faint)' }}>
            {perm === 'granted'
              ? '已允许本站在系统层面弹出通知'
              : perm === 'denied'
                ? '已被浏览器拒绝，需在站点设置中手动开启'
                : perm === 'unsupported'
                  ? '当前浏览器不支持通知'
                  : '尚未授权，点右侧按钮申请'}
          </span>
        </span>
        {perm === 'default' ? (
          <Btn size="sm" variant="ghost" onClick={() => void request()} className="shrink-0">
            开启通知
          </Btn>
        ) : perm === 'granted' ? (
          <Badge tone="ok">已授权</Badge>
        ) : perm === 'denied' ? (
          <Badge tone="no">已拒绝</Badge>
        ) : (
          <Badge>不支持</Badge>
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
