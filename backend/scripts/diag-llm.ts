import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'diag-llm-'));
process.env.WORKBENCH_DB = join(dir, 'diag.db');

const { ensureSchema } = await import('../src/db/ensure.ts');
const { seed } = await import('../src/db/seed.ts');
ensureSchema();
seed();

const { callLlm } = await import('../src/agents/llm.ts');
try {
  const out = await callLlm({
    agentId: 'agent-copy',
    system: '你是电商文案专家，输出 JSON：{"title":"x","points":["a","b"],"outline":"o","keywords":["k"]}',
    user: '产品：测试榨汁杯',
  });
  console.log('LLM-OUT-LEN:', out.length);
  console.log('LLM-OUT-HEAD:', out.slice(0, 300));
} catch (e) {
  console.log('LLM-ERR:', e instanceof Error ? e.message : String(e));
}
