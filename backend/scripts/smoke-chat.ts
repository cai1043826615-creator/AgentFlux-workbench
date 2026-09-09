/**
 * 聊天 + 事件播报冒烟测试（Node 26 直跑，禁 vitest/tsx；临时 DB 隔离）
 * 运行：node scripts/smoke-chat.ts
 * 验证：sendChatMessage 写入与查询 / announcer 对 TASK_CREATED 播报 / history 双向过滤 / WS chat:send 落库
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'workbench-chat-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const { ensureSchema } = await import('../src/db/ensure.ts');
const { seed } = await import('../src/db/seed.ts');
const { all } = await import('../src/db/client.ts');
const { sendChatMessage, getChatHistory } = await import('../src/routes/chat.ts');
const { installAnnouncer } = await import('../src/agents/announcer.ts');
const { handleWsClientMessage } = await import('../src/ws/broadcast.ts');
const { service } = await import('../src/engine/service.ts');

ensureSchema();
seed();

// ===== 1. sendChatMessage 写入与查询 =====
{
  const m1 = sendChatMessage('group', '你', '全体', '大家好，新品上架工作台开工');
  assert.ok(m1.id > 0, 'group 消息应返回自增 id');
  assert.equal(m1.chatKind, 'group');
  assert.equal(m1.from, '你');
  assert.equal(m1.to, '全体');
  assert.equal(m1.kind, 'msg');
  const m2 = sendChatMessage('group', '美美', '全体', '收到，我负责文案', 'msg', 7);
  assert.equal(m2.taskId, 7, 'taskId 应回填');

  const group = getChatHistory('group', '全体');
  assert.equal(group.length, 2, '群聊应返回 2 条');
  assert.equal(group[0].id, m1.id, '群聊按 id ASC 排序');
  assert.equal(group[1].id, m2.id);
}

// ===== 2. announcer 对 TASK_CREATED 播报写入（走真实 executor 事件） =====
{
  installAnnouncer();
  const task = service.createTask({ title: '冒烟测试榨汁杯', description: '测试', platform: '天猫' });
  const evts = all<{ chat_kind: string; from: string; to: string; body: string; kind: string; task_id: number | null }>(
    'SELECT chat_kind, "from", "to", body, kind, task_id FROM messages WHERE chat_kind = ? AND kind = ? ORDER BY id DESC',
    ['group', 'evt'],
  );
  const found = evts.find((e) => e.task_id === task.id);
  assert.ok(found, 'TASK_CREATED 应产生群聊 evt 播报');
  assert.equal(found.from, '系统');
  assert.equal(found.to, '全体');
  assert.ok(found.body.includes('已创建，等待确认开工'), `播报文案异常: ${found.body}`);
  assert.ok(found.body.includes(`任务 #${task.id}`), `播报应含任务号: ${found.body}`);
  assert.ok(found.body.includes('冒烟测试榨汁杯'), `播报应含任务标题: ${found.body}`);
}

// ===== 3. history 双向过滤（private） =====
{
  sendChatMessage('private', '你', '美美', '美美，卖点文案好了吗？');
  sendChatMessage('private', '美美', '你', '快了，标题和 5 条卖点已备好');
  const hist = getChatHistory('private', '美美');
  assert.equal(hist.length, 2, 'private 双向过滤应命中双方消息');
  assert.equal(hist[0].from, '你');
  assert.equal(hist[0].to, '美美');
  assert.equal(hist[1].from, '美美');
  assert.equal(hist[1].to, '你');
  // 过滤隔离：与其它私聊对象不串
  const other = getChatHistory('private', '平平');
  assert.equal(other.length, 0, '其它私聊对象不应看到美美会话');
}

// ===== 4. WS chat:send 落库（from='你'，全量广播无连接时为 no-op） =====
{
  handleWsClientMessage({ type: 'chat:send', chatKind: 'private', to: '平平', body: '平平，主图用白底' });
  const rows = all<{ "from": string; to: string; body: string }>('SELECT "from", "to", body FROM messages WHERE chat_kind = ?', ['private']);
  const last = rows[rows.length - 1];
  assert.equal(last.from, '你', 'WS 发送者应为 你');
  assert.equal(last.to, '平平');
  assert.equal(last.body, '平平，主图用白底');
  // 空消息不落库
  const before = all('SELECT COUNT(*) AS n FROM messages')[0] as { n: number };
  handleWsClientMessage({ type: 'chat:send', chatKind: 'group', to: '全体', body: '   ' });
  const after = all('SELECT COUNT(*) AS n FROM messages')[0] as { n: number };
  assert.equal(after.n, before.n, '空消息应被拦截不落库');
  // 群聊 to 归一化为 '全体'（前端即使传 'group' 也能进群聊历史）
  handleWsClientMessage({ type: 'chat:send', chatKind: 'group', to: 'group', body: '大家注意，今天下班前排版定稿' });
  const grp = all<{ "to": string }>('SELECT "to" FROM messages WHERE chat_kind = ? AND body = ?', ['group', '大家注意，今天下班前排版定稿']);
  assert.equal(grp.length, 1);
  assert.equal(grp[0].to, '全体', 'WS 群聊 to 应归一化为 全体');
}

console.log('✅ 聊天 + 事件播报 smoke 测试全部通过');
