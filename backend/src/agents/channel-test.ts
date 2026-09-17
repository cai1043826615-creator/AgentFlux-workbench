/**
 * 渠道健康检查（delivery-ops B8）：
 * - 复用 callLlm 的渠道选择顺序（resolveLlmChannel：面板专属 → 主管视觉 → .env 默认）
 * - 独立发起一次最小 chat/completions 请求（15s 超时），按状态码/错误体分类错误码
 * - 设计师 Agent（agent-design）按其实际使用的**生图渠道**判定（核验 D-11）：
 *   不再误用 LLM 渠道，避免"生图渠道未配置/异常"被报成 LLM 渠道结论
 * - 纯只读探测：不写 agent_executions、不改任何状态、不产生执行日志
 */
import type { ChannelTestError, ChannelTestResult } from '@workbench/shared';
import { resolveLlmChannel, type LlmChannelInfo } from './llm.ts';
import { CHANNEL } from '../config.ts';
import { getSetting } from './channel-settings.ts';

const TEST_TIMEOUT_MS = 15_000;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function errorResult(code: ChannelTestError['code'], message: string, channel: LlmChannelInfo | null, latencyMs: number): ChannelTestResult {
  return {
    ok: false,
    latencyMs,
    model: channel?.model ?? null,
    baseUrlHost: channel ? hostOf(channel.baseUrl) : null,
    error: { code, message },
  };
}

/** 对指定渠道做一次最小连通性探测 */
export async function testLlmChannel(channel: LlmChannelInfo): Promise<ChannelTestResult> {
  const started = performance.now();
  try {
    const res = await fetch(`${channel.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${channel.apiKey}` },
      body: JSON.stringify({ model: channel.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (res.ok) {
      return { ok: true, latencyMs, model: channel.model, baseUrlHost: hostOf(channel.baseUrl), error: null };
    }
    const bodyText = await res.text().catch(() => '');
    let code: ChannelTestError['code'];
    if (res.status === 401 || res.status === 403) code = 'auth_failed';
    else if (res.status === 404 || /model[^。；;]*not found|not found[^。；;]*model|does not exist|unknown model/i.test(bodyText)) code = 'model_not_found';
    else code = 'upstream_error';
    return errorResult(code, `HTTP ${res.status}: ${bodyText.slice(0, 160)}`, channel, latencyMs);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const code: ChannelTestError['code'] = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'connect_failed';
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(code, message, channel, latencyMs);
  }
}

/**
 * 对某工位执行渠道健康检查：
 * - override 提供「保存前先测」的临时渠道（baseUrl/apiKey/model），命中其中任一字段则用于本次探测
 * - 未配置任何渠道 → ok:false + code 'not_configured'（不抛错）
 * - 设计师（agent-design）：按生图渠道判定（D-11），override 同样优先
 */
export async function testAgentChannel(agentId: string, override?: Partial<LlmChannelInfo>): Promise<ChannelTestResult> {
  if (agentId === 'agent-design') return testImageAgentChannel(override);
  const channel = resolveLlmChannel(agentId, override);
  if (!channel) return errorResult('not_configured', '该工位未配置 LLM 渠道（设置面板与 .env 默认均无 API Key）', null, 0);
  return testLlmChannel(channel);
}

/** 生图渠道配置（settings.imageChannel → .env 默认；与 imagegen.ts 的解析顺序一致） */
function resolveImageChannel(): { baseUrl: string; apiKey: string; model: string } | null {
  const channel = getSetting<{ baseUrl?: string; apiKey?: string; model?: string } | null>('imageChannel') ?? null;
  const baseUrl = channel?.baseUrl || CHANNEL.image.baseUrl;
  const apiKey = channel?.apiKey || CHANNEL.image.apiKey;
  const model = channel?.model || CHANNEL.image.model;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model };
}

/**
 * 生图渠道健康检查（D-11）：用最小只读请求 `GET {base}/models` 探测连通性与鉴权，
 * 不消耗生图额度（与 LLM 分支的"发一次最小请求"语义等价，同为只读探测）。
 */
async function testImageAgentChannel(override?: Partial<LlmChannelInfo>): Promise<ChannelTestResult> {
  const base = resolveImageChannel();
  if (!base) {
    return errorResult('not_configured', '设计师生图渠道未配置（设置面板与 .env 默认均无 API Key）', null, 0);
  }
  const baseUrl = override?.baseUrl ?? base.baseUrl;
  const apiKey = override?.apiKey ?? base.apiKey;
  const model = override?.model ?? base.model;
  const channelInfo: LlmChannelInfo = { baseUrl, apiKey, model };
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    const latencyMs = Math.round(performance.now() - started);
    if (res.ok) {
      return { ok: true, latencyMs, model, baseUrlHost: hostOf(baseUrl), error: null };
    }
    const bodyText = await res.text().catch(() => '');
    let code: ChannelTestError['code'];
    if (res.status === 401 || res.status === 403) code = 'auth_failed';
    else code = 'upstream_error';
    return errorResult(code, `HTTP ${res.status}: ${bodyText.slice(0, 160)}`, channelInfo, latencyMs);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const code: ChannelTestError['code'] = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'connect_failed';
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(code, message, channelInfo, latencyMs);
  }
}
