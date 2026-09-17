import { useCallback, useState } from 'react';
import { api } from './api.ts';

/** 交付包下载（B4 · 4.10）：触发浏览器下载 ZIP；错误（含 409 无交付物）以行内文本展示 */
export function useDownloadPackage(taskId: number) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { filename, blob } = await api.deliverablePackage(taskId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^HTTP 409: /, '') : '下载失败，请重试');
    } finally {
      setBusy(false);
    }
  }, [taskId, busy]);

  return { download, busy, error };
}
