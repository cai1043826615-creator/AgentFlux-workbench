/**
 * 冒烟脚本：技能真实挂载改造验收（扫描技能目录 / 内容读取 / System Prompt 注入 / 路由注册）。
 * 用法：在 backend 目录运行 `node scripts/smoke-skills.ts`（Node 26 直跑 TS；临时 DB，跑完即退）。
 * 覆盖：listSkills 目录扫描与元数据解析、readSkillContent/readFileContent 读取与容错、
 *       buildSystemPrompt 为 agent-copy 注入挂载技能与挂载文件、GET /api/agents/skills 路由注册。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSkillInfo } from '@workbench/shared';

// 临时目录 DB：必须在 import db/client 之前设置 WORKBENCH_DB
const dir = mkdtempSync(join(tmpdir(), 'smoke-skills-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const { ensureSchema } = await import('../src/db/ensure.ts');
const { seed } = await import('../src/db/seed.ts');
const { get, run } = await import('../src/db/client.ts');
const { listSkills, readSkillContent, readFileContent } = await import('../src/agents/skills.ts');
const { buildSystemPrompt } = await import('../src/agents/smart-producer.ts');

ensureSchema();
seed();

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('[smoke-skills] 技能真实挂载改造冒烟开始');

// 1. listSkills 扫描 backend/skills/*.md 并解析首部元数据
let skills: AgentSkillInfo[] = [];
await check('listSkills 至少 1 项且含「电商文案模板」', async () => {
  skills = await listSkills();
  assert.ok(skills.length >= 1, '技能列表应至少 1 项');
  const copy = skills.find((s) => s.id === '电商文案模板');
  assert.ok(copy, '技能列表应包含 id=电商文案模板');
  assert.equal(copy.name, '电商文案模板');
  assert.ok(copy.description.length > 0, '描述不应为空');
  assert.equal(copy.category, '文案');
});

// 2. readSkillContent 读取技能全文（非空且含模板正文关键词）
await check('readSkillContent 返回非空且含模板正文', async () => {
  const content = await readSkillContent('电商文案模板');
  assert.ok(content.length > 0, '技能内容不应为空');
  assert.ok(content.includes('标题公式'), '应包含标题公式');
  assert.ok(content.includes('平台差异'), '应包含平台差异');
});

// 3. 容错：不存在的技能/文件返回空字符串
await check('不存在的技能与文件返回空字符串', async () => {
  assert.equal(await readSkillContent('不存在的技能'), '');
  assert.equal(await readFileContent('不存在的文件.pdf'), '');
});

// 4. buildSystemPrompt：seed 已挂载技能 → system prompt 注入模板内容
await check('buildSystemPrompt 为 agent-copy 注入挂载技能内容', async () => {
  const row = get<{ skills: string }>('SELECT skills FROM agents WHERE id = ?', ['agent-copy'])!;
  assert.deepEqual(JSON.parse(row.skills), ['电商文案模板', 'SEO 关键词']);
  const system = await buildSystemPrompt('agent-copy', 'BASE');
  assert.ok(system.startsWith('BASE'), 'base 应保留在前');
  assert.ok(system.includes('【挂载技能】'), '应包含挂载技能段');
  assert.ok(system.includes(await readSkillContent('电商文案模板')), '应注入模板全文');
  // SEO 关键词技能文件不存在 → 跳过注入，不出现该技能名
  assert.ok(!system.includes('SEO 关键词'), '不存在的技能不应注入');
  // files 引用「品牌手册.pdf」不存在 → 无挂载文件段
  assert.ok(!system.includes('【挂载文件】'), '无文件时不出现挂载文件段');
});

// 5. buildSystemPrompt：临时文件挂载 → system prompt 注入挂载文件内容
await check('buildSystemPrompt 注入挂载文件内容', async () => {
  const filesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'files');
  const probe = join(filesDir, '__smoke_probe__.txt');
  try {
    await mkdir(filesDir, { recursive: true });
    await writeFile(probe, '品牌卖点：便携、安全、快充', 'utf8');
    run('UPDATE agents SET files = ? WHERE id = ?', [JSON.stringify(['__smoke_probe__.txt']), 'agent-copy']);
    const system = await buildSystemPrompt('agent-copy', 'BASE');
    assert.ok(system.includes('【挂载文件】'), '应包含挂载文件段');
    assert.ok(system.includes('品牌卖点：便携、安全、快充'), '应注入文件全文');
  } finally {
    await rm(probe, { force: true });
    run('UPDATE agents SET files = ? WHERE id = ?', [JSON.stringify(['品牌手册.pdf']), 'agent-copy']);
  }
});

// 6. GET /api/agents/skills 路由注册成功（fastify inject）
await check('GET /api/agents/skills 返回技能列表', async () => {
  const { default: Fastify } = await import('fastify');
  const { agentRoutes } = await import('../src/routes/agents.ts');
  const app = Fastify();
  await agentRoutes(app);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/agents/skills' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { skills: AgentSkillInfo[] };
    assert.ok(Array.isArray(body.skills) && body.skills.some((s) => s.id === '电商文案模板'), '应返回含电商文案模板的技能列表');
  } finally {
    await app.close();
  }
});

// 清理临时 DB（删不掉也无妨：系统临时目录）
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(`[smoke-skills] 全部 ${passed} 项断言通过 ✓`);
