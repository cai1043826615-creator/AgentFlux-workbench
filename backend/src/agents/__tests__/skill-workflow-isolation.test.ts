/**
 * 技能按工作流分份挂载（skill-workflow-isolation 二轮定案，独立进程测试）：
 * - 注入 = 该任务工作流的挂载份（挂什么用什么，无分类过滤）
 * - 双份互不影响：改电商份不动小红书份
 * - 兜底：无 workflow_skills 回退全局 skills（等价每份初始值=旧全局挂载）
 * - 合规清单强制追加不回归；并集读视图同步
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-skillwf-'));
process.env.WORKBENCH_DB = join(dir, 'skillwf.db');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { get, run } = await import('../../db/client.ts');
const { buildSystemPrompt, buildProducerSystemPrompt } = await import('../smart-producer.ts');

ensureSchema();
seed();

const BASE = '你是文案 Agent。';

/** 写入某 Agent 的分份挂载（并同步全局并集视图，模拟 PUT /api/agents/:id 的写入语义） */
function setParts(agentId: string, parts: Record<string, string[]>) {
  const union = [...new Set(Object.values(parts).flat())];
  run('UPDATE agents SET workflow_skills = ?, skills = ? WHERE id = ?', [JSON.stringify(parts), JSON.stringify(union), agentId]);
}

describe('技能按工作流分份挂载与注入', () => {
  test('电商任务注入电商份；小红书任务注入小红书份', async () => {
    setParts('agent-copy', {
      'ecom-new-listing': ['电商文案模板'],
      'xhs-note': ['小红书合规违禁词清单'],
    });
    const ecom = await buildSystemPrompt('agent-copy', BASE, 'ecom-new-listing');
    assert.ok(ecom.includes('电商文案模板'), '电商份技能必须注入电商任务');
    assert.ok(!ecom.includes('小红书合规违禁词清单'), '小红书份技能不得出现在电商任务');
    const xhs = await buildSystemPrompt('agent-copy', BASE, 'xhs-note');
    assert.ok(xhs.includes('小红书合规违禁词清单'), '小红书份技能必须注入小红书任务');
    assert.ok(!xhs.includes('电商文案模板'), '电商份技能不得出现在小红书任务');
  });

  test('双份互不影响：小红书份移除通用技能后，电商份保持', async () => {
    setParts('agent-copy', {
      'ecom-new-listing': ['电商文案模板', '素材结构化'],
      'xhs-note': ['小红书合规违禁词清单'],
    });
    const xhs = await buildSystemPrompt('agent-copy', BASE, 'xhs-note');
    assert.ok(!xhs.includes('素材结构化'), '小红书份已移除的通用技能不注入');
    const ecom = await buildSystemPrompt('agent-copy', BASE, 'ecom-new-listing');
    assert.ok(ecom.includes('素材结构化'), '电商份的通用技能不受小红书份变化影响');
  });

  test('兜底：无 workflow_skills 的旧 Agent 回退全局 skills', async () => {
    run("UPDATE agents SET workflow_skills = '{}', skills = ? WHERE id = 'agent-copy'", [JSON.stringify(['电商文案模板', '素材结构化'])]);
    const ecom = await buildSystemPrompt('agent-copy', BASE, 'ecom-new-listing');
    assert.ok(ecom.includes('电商文案模板') && ecom.includes('素材结构化'), '分份缺失回退全局（每份初始值=旧全局挂载）');
  });

  test('未传 workflowId（非 producer 调用点）回退全局', async () => {
    setParts('agent-copy', { 'ecom-new-listing': ['电商文案模板'], 'xhs-note': [] });
    const prompt = await buildSystemPrompt('agent-copy', BASE);
    assert.ok(prompt.includes('电商文案模板'));
  });

  test('工作流专属技能强制追加不回归：xhs-note 含【工作流专属技能】段（未挂载也注入）', async () => {
    setParts('agent-copy', { 'ecom-new-listing': [], 'xhs-note': [] });
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, undefined, 'xhs-note');
    assert.ok(prompt.includes('工作流专属技能'), '须有【工作流专属技能】段');
    assert.ok(prompt.includes('绝对化用语'), '合规清单内容必须注入');
    const ecom = await buildProducerSystemPrompt('agent-copy', BASE, undefined, 'ecom-new-listing');
    assert.ok(!ecom.includes('工作流专属技能'), '电商任务无专属技能段（既有行为）');
  });

  test('并集读视图：agents.skills = 各份并集（供既有展示兼容）', () => {
    setParts('agent-copy', {
      'ecom-new-listing': ['电商文案模板', '素材结构化'],
      'xhs-note': ['小红书合规违禁词清单', '素材结构化'],
    });
    const row = get<{ skills: string }>("SELECT skills FROM agents WHERE id = 'agent-copy'")!;
    const union = JSON.parse(row.skills) as string[];
    assert.deepEqual([...union].sort(), ['电商文案模板', '素材结构化', '小红书合规违禁词清单'].sort());
  });

  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp 目录清理失败不影响测试结论 */
    }
  });
});
