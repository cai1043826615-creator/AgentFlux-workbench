import type { FastifyInstance } from 'fastify';
import type { ChatKind, Message, MessageKind } from '@workbench/shared';
import { all, run } from '../db/client.ts';

/**
 * 聊天路由 + 消息写入（工作台聊天：群聊 / 私聊，WS 播报与 REST 查询共用同一写入源）。
 * messages 表 "from"/"to" 是 SQLite 关键字，SQL 中必须用双引号包裹。
 */

/** messages 表行（snake_case；字段名 from/to 在 TS 中合法，仅 SQL 列名需加引号） */
interface MessageRow {
  id: number;
  chat_kind: ChatKind;
  from: string;
  to: string;
  body: string;
  kind: MessageKind;
  task_id: number | null;
  created_at: string;
}

/** 行 → shared Message（snake→camel） */
function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    chatKind: row.chat_kind,
    from: row.from,
    to: row.to,
    body: row.body,
    kind: row.kind ?? 'msg',
    taskId: row.task_id ?? undefined,
    createdAt: row.created_at,
  };
}

/** 历史记录上限 */
const HISTORY_LIMIT = 200;

/** 写入一条消息并返回 shared Message（WS / 播报 / 用户发送共用） */
export function sendChatMessage(
  chatKind: ChatKind,
  from: string,
  to: string,
  body: string,
  kind: MessageKind = 'msg',
  taskId?: number,
): Message {
  const createdAt = new Date().toISOString();
  const res = run(
    'INSERT INTO messages (chat_kind, "from", "to", body, kind, task_id, created_at) VALUES (?,?,?,?,?,?,?)',
    [chatKind, from, to, body, kind, taskId ?? null, createdAt],
  );
  return toMessage({
    id: res.lastInsertRowid,
    chat_kind: chatKind,
    from,
    to,
    body,
    kind,
    task_id: taskId ?? null,
    created_at: createdAt,
  });
}

/** 查询聊天记录：group 固定 to='全体'；private 按对方双向过滤（from=to 或 to=to）；按 id ASC，limit 200 */
export function getChatHistory(kind: ChatKind, to: string): Message[] {
  if (kind === 'group') {
    const rows = all<MessageRow>(
      'SELECT * FROM messages WHERE chat_kind = ? AND "to" = ? ORDER BY id ASC LIMIT ?',
      ['group', '全体', HISTORY_LIMIT],
    );
    return rows.map(toMessage);
  }
  const rows = all<MessageRow>(
    'SELECT * FROM messages WHERE chat_kind = ? AND ("from" = ? OR "to" = ?) ORDER BY id ASC LIMIT ?',
    ['private', to, to, HISTORY_LIMIT],
  );
  return rows.map(toMessage);
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // 聊天记录
  app.get<{ Querystring: { kind?: string; to?: string } }>('/api/chat/history', async (req, reply) => {
    const kind = req.query.kind === 'group' ? 'group' : req.query.kind === 'private' ? 'private' : null;
    if (!kind) return reply.code(400).send({ error: 'kind must be group or private' });
    const to = kind === 'group' ? '全体' : (req.query.to ?? '');
    if (kind === 'private' && !to) return reply.code(400).send({ error: 'to required for private chat' });
    return { messages: getChatHistory(kind, to) };
  });
}
