import type { WSServerMessage } from '@workbench/shared';

/** WS 客户端：连接后端 /ws，订阅事件（任务/事件/聊天/工位/交付物/审批） */
export function connectWs(onMessage: (msg: WSServerMessage) => void, onStatus?: (connected: boolean) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      onStatus?.(true);
    };
    ws.onmessage = (ev) => {
      try {
        onMessage(JSON.parse(String(ev.data)) as WSServerMessage);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) {
        retry += 1;
        setTimeout(open, Math.min(1000 * retry, 8000));
      }
    };
    ws.onerror = () => ws?.close();
  };

  open();

  return () => {
    closed = true;
    ws?.close();
    ws = null;
  };
}
