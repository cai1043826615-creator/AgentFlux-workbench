/**
 * B8 · 渠道健康检查 前端解包单测（11.5「保存前先测」链路）：
 * 后端响应为 { result: ChannelTestResult }（agents.ts 路由 return { result }），
 * 前端 api.channelTest 必须解包出 result，否则 r.ok 为 undefined 导致误报「Agent 侧异常」。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const calls: { url: string; init: RequestInit }[] = [];
// 桩：后端返回 { result: {...} } 的 200 响应
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), init: init ?? {} });
  return new Response(
    JSON.stringify({ result: { ok: true, latencyMs: 191, model: 'deepseek-chat', baseUrlHost: 'api.deepseek.com', error: null } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}) as unknown as typeof fetch;

const { api } = await import('../api.ts');

describe('B8 · channel-test 响应解包', () => {
  test('后端 {result:{...}} 应解包为 ChannelTestResult（ok 为 true，而非整个 body）', async () => {
    const r = await api.channelTest('agent-copy', {});
    assert.equal(r.ok, true, 'r.ok 应为 true；若拿到整个 {result:{...}} body 则为 undefined');
    assert.equal(r.latencyMs, 191);
    assert.equal(r.model, 'deepseek-chat');
    assert.equal(r.baseUrlHost, 'api.deepseek.com');
    assert.equal(r.error, null);
  });

  test('POST 请求发往 /api/agents/:id/channel-test 且 body 为覆盖参数', async () => {
    await api.channelTest('agent-design', { model: 'gpt-image-2' });
    const last = calls.at(-1)!;
    assert.ok(last.url.endsWith('/api/agents/agent-design/channel-test'), `url=${last.url}`);
    const body = JSON.parse(String(last.init.body ?? '{}')) as { model?: string };
    assert.equal(body.model, 'gpt-image-2');
  });
});
