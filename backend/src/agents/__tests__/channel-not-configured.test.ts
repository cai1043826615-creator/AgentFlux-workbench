/**
 * 渠道未配置分支（delivery-ops B8，独立进程）：
 * 本机 backend/.env.local 配置了真实渠道，无法在共享进程内清空；
 * 此文件用动态导入：先清空渠道环境变量（loadEnvFile 不覆盖已有变量），
 * 再加载 config —— 确定性覆盖：
 * - resolveLlmChannel → null（无任何可用 apiKey）
 * - testAgentChannel → ok:false + not_configured（不抛错）
 * - callLlm → 抛 LlmChannelUnavailableError（调用方降级 mock）
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.DEEPSEEK_API_KEY = '';
process.env.SUPERVISOR_API_KEY = '';
process.env.IMAGE_API_KEY = '';
process.env.DEEPSEEK_BASE_URL = '';
process.env.SUPERVISOR_BASE_URL = '';
process.env.DEEPSEEK_MODEL = '';

const dir = mkdtempSync(join(tmpdir(), 'workbench-nc-'));
process.env.WORKBENCH_DB = join(dir, 'nc.db');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { setSetting } = await import('../channel-settings.ts');
const { resolveLlmChannel, callLlm, LlmChannelUnavailableError } = await import('../llm.ts');
const { testAgentChannel } = await import('../channel-test.ts');

ensureSchema();
seed();

describe('渠道未配置（env 清空 + 面板无 key）', () => {
  test('resolveLlmChannel → null；override 后可解析', () => {
    setSetting('llmChannels', {});
    assert.equal(resolveLlmChannel('agent-copy'), null);
    assert.equal(resolveLlmChannel('agent-supervisor'), null);
    const withOverride = resolveLlmChannel('agent-copy', { baseUrl: 'http://x', apiKey: 'k', model: 'm' });
    assert.ok(withOverride && withOverride.apiKey === 'k', '「保存前先测」override 路径不受未配置影响');
  });

  test('testAgentChannel → ok:false + not_configured（不抛错）', async () => {
    const r = await testAgentChannel('agent-copy');
    assert.equal(r.ok, false);
    assert.equal(r.error?.code, 'not_configured');
    assert.equal(r.model, null);
    assert.equal(r.baseUrlHost, null);
  });

  test('callLlm → LlmChannelUnavailableError', async () => {
    await assert.rejects(() => callLlm({ agentId: 'agent-copy', system: 's', user: 'u' }), LlmChannelUnavailableError);
  });
});

test('清理临时目录', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
