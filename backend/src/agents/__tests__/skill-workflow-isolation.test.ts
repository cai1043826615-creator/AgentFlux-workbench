/**
 * 技能注入的工作流分类隔离（skill-workflow-isolation，独立进程测试）：
 * - 电商任务不注入小红书分类挂载技能；小红书任务反向同理
 * - 「通用」分类技能对两类工作流都注入
 * - 未知 workflowId / 未传 workflowId → 全量注入（兜底）
 * - WORKFLOW_SKILLS（合规清单）强制追加行为不回归
 * - 过滤发生在读取全文之前：被滤技能的文件内容不出现在 prompt 中
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
const { run } = await import('../../db/client.ts');
const { buildSystemPrompt, buildProducerSystemPrompt } = await import('../smart-producer.ts');

ensureSchema();
seed();

/** 给 agent-copy 挂载跨三个分类的技能（覆盖隔离矩阵） */
function mountSkills(names: string) {
  run('UPDATE agents SET skills = ? WHERE id = ?', [names, 'agent-copy']);
}

const BASE = '你是文案 Agent。';

describe('技能注入的工作流分类隔离', () => {
  test('电商任务：注入电商+通用，不注入小红书', async () => {
    mountSkills('["电商文案模板","小红书合规违禁词清单","素材结构化"]');
    const prompt = await buildSystemPrompt('agent-copy', BASE, 'ecom-new-listing');
    assert.ok(prompt.includes('电商文案模板'), '电商技能必须注入');
    assert.ok(prompt.includes('素材结构化'), '通用技能必须注入');
    assert.ok(!prompt.includes('小红书合规违禁词清单'), '小红书技能不得注入电商任务');
  });

  test('小红书任务：注入小红书+通用，不注入电商', async () => {
    mountSkills('["电商文案模板","小红书合规违禁词清单","素材结构化"]');
    const prompt = await buildSystemPrompt('agent-copy', BASE, 'xhs-note');
    assert.ok(prompt.includes('小红书合规违禁词清单'), '小红书技能必须注入');
    assert.ok(prompt.includes('素材结构化'), '通用技能必须注入');
    assert.ok(!prompt.includes('电商文案模板'), '电商技能不得注入小红书任务');
  });

  test('未知 workflowId 兜底：全量注入', async () => {
    mountSkills('["电商文案模板","小红书合规违禁词清单"]');
    const prompt = await buildSystemPrompt('agent-copy', BASE, 'some-future-workflow');
    assert.ok(prompt.includes('电商文案模板'));
    assert.ok(prompt.includes('小红书合规违禁词清单'));
  });

  test('未传 workflowId（非 producer 调用点）兜底：全量注入', async () => {
    mountSkills('["电商文案模板","小红书合规违禁词清单"]');
    const prompt = await buildSystemPrompt('agent-copy', BASE);
    assert.ok(prompt.includes('电商文案模板'));
    assert.ok(prompt.includes('小红书合规违禁词清单'));
  });

  test('工作流专属技能强制追加不回归：xhs-note 任务含【工作流专属技能】段', async () => {
    mountSkills('[]'); // 什么都不挂——合规清单仍应注入
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, undefined, 'xhs-note');
    assert.ok(prompt.includes('工作流专属技能'), '须有【工作流专属技能】段');
    assert.ok(prompt.includes('绝对化用语'), '合规清单内容必须注入（未挂载也注入）');
  });

  test('电商任务无【工作流专属技能】段（既有行为）', async () => {
    mountSkills('["电商文案模板"]');
    const prompt = await buildProducerSystemPrompt('agent-copy', BASE, undefined, 'ecom-new-listing');
    assert.ok(!prompt.includes('工作流专属技能'), '电商任务不应出现专属技能段');
    assert.ok(prompt.includes('电商文案模板'));
  });

  test('挂载技能段在过滤后为空时不产生空【挂载技能】标题（与既有空段跳过语义一致）', async () => {
    // xhs 任务只挂电商技能 → 全被滤掉 → 不应有【挂载技能】段
    mountSkills('["电商文案模板"]');
    const prompt = await buildSystemPrompt('agent-copy', BASE, 'xhs-note');
    assert.ok(!prompt.includes('【挂载技能】'), '全被过滤时不应留下空段标题');
  });

  // 清理放 after（suite 体是注册阶段，rmSync 放那里会在建套件时同步执行，Windows 下先于测试跑且失败会取消全部用例）
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* temp 目录清理失败不影响测试结论 */
    }
  });
});
