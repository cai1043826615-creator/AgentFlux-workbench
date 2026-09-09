/**
 * 聊天回复链路冒烟测试（Node 26 直跑，禁 vitest/tsx；临时 DB 隔离）
 * 运行：node scripts/smoke-chat-reply.ts
 * 验证：私聊 Agent 回复（receipt + msg 两条）/ 群聊主管记忆记录与查询 / LLM 不可用降级不抛异常 / WS 异步触发
 * 说明：脚本顶部先置空 LLM 密钥（process.loadEnvFile 默认不覆盖已存在变量），
 *       保证 hasLlmChannel()=false → callLlm 抛 LlmChannelUnavailableError → 走降级模板，不消耗额度。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

process.env.DEEPSEEK_API_KEY = '';

const dir = mkdtempSync(join(tmpdir(), 'workbench-reply-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const { ensureSchema } = await import('../src/db/ensure.ts');
const { seed } = await import('../src/db/seed.ts');
const { all } = await import('../src/db/client.ts');
const { handleAgentReply, listSupervisorNotes } = await import('../src/agents/chat-reply.ts');

ensureSchema();
seed();

function count(): number {
  return (all('SELECT COUNT(*) AS n FROM messages')[0] as { n: number }).n;
}

/** 取最近 k 条消息（id 升序） */
function tail(k: number): { kind: string; from: string; to: string; body: string }[] {
  return all<{ kind: string; from: string; to: string; body: string }>(
    'SELECT kind, "from", "to", body FROM messages ORDER BY id DESC LIMIT ?',
    [k],
  ).reverse();
}

// ===== 1. 私聊：handleAgentReply 产生 receipt + msg 两条，Agent 署名 = 姓名，to 保持会话对象 =====
{
  const before = count();
  await handleAgentReply('private', 'agent-copy', '帮我写个卖点');
  assert.equal(count() - before, 2, '私聊应新增 receipt + msg 两条');
  const msgs = tail(2);
  assert.equal(msgs[0].kind, 'receipt', '第一条应为收到确认');
  assert.ok(msgs[0].body.startsWith('收到你的消息'), `回执文案异常: ${msgs[0].body}`);
  assert.equal(msgs[0].from, '美美');
  assert.equal(msgs[0].to, 'agent-copy', '私聊回复 to 保持会话对象');
  assert.equal(msgs[1].kind, 'msg', '第二条应为正文');
  assert.equal(msgs[1].from, '美美');
  assert.ok(msgs[1].body.startsWith('我是美美'), `降级正文异常: ${msgs[1].body}`);
}

// ===== 2. 群聊：无进行中任务 + 指令词 → 波波回复并记录记忆 =====
{
  const before = count();
  await handleAgentReply('group', '全体', '注意以后标题要短');
  assert.equal(count() - before, 3, '群聊主管应新增 receipt + 记录回执 + msg 三条');
  const msgs = tail(3);
  assert.ok(msgs.every((m) => m.from === '波波'), '群聊指令消息应由波波回复');
  assert.ok(
    msgs.some((m) => m.kind === 'receipt' && m.body.includes('已记录要求：注意以后标题要短')),
    '应有记录要求回执',
  );
  const notes = listSupervisorNotes();
  assert.ok(notes.includes('注意以后标题要短'), `主管记忆应包含该要求: ${JSON.stringify(notes)}`);
}

// ===== 3. LLM 不可用降级：callLlm 抛渠道错误，handleAgentReply 不抛且用降级模板 =====
{
  const { callLlm, LlmChannelUnavailableError } = await import('../src/agents/llm.ts');
  let threw = false;
  try {
    await callLlm({ agentId: 'agent-copy', system: 'x', user: 'y' });
  } catch (err) {
    threw = err instanceof LlmChannelUnavailableError;
  }
  assert.ok(threw, '未配置渠道时 callLlm 应抛 LlmChannelUnavailableError');
  const before = count();
  await handleAgentReply('private', 'agent-supervisor', '检查一下当前进度');
  assert.equal(count() - before, 2, '降级路径仍应产出两条消息');
  const last = tail(2)[1];
  assert.ok(last.body.startsWith('我是波波'), `波波降级正文异常: ${last.body}`);
}

// ===== 4. WS chat:send 集成：用户消息同步落库，Agent 回复异步触发，不阻塞 WS 同步流 =====
{
  const { handleWsClientMessage } = await import('../src/ws/broadcast.ts');
  const before = count();
  handleWsClientMessage({ type: 'chat:send', chatKind: 'private', to: 'agent-design', body: '主图用白底' });
  assert.equal(count(), before + 1, '用户消息应同步落库，回复应异步触发不阻塞');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(count() - before, 3, 'WS 消息后应同步落库用户消息 + 异步产出 receipt + msg');
  const msgs = tail(2);
  assert.equal(msgs[0].from, '平平');
  assert.equal(msgs[1].from, '平平');
}

console.log('✅ 聊天回复链路 smoke 测试全部通过');
