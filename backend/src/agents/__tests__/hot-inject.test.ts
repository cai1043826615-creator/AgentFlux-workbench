/**
 * hot-intel 注入通道测试（2.5 注入 / 2.6 与 T1 分工核对 / 2.9 板块独立性）。
 * 运行：node src/agents/__tests__/hot-inject.test.ts
 *
 * 覆盖：
 * - 2.5① 无热点背景时 buildProducerSystemPrompt 输出与改动前逐字节一致（不含热点段）；
 * - 2.5② 有背景时「关联知识库资料」段与「任务背景 · 外部环境情报」段并存且可区分、热点段在知识库段之后；
 * - 2.5③ 热点段含「不得作为产品品类/主体/功能规格依据」约束语句；
 * - 2.5④ 热点源不可用时仍能持久化快照注入（buildHotContext 不依赖面板）；
 * - 2.6 三段共存（知识库段 + 热点段；T1 B2 返工段由其自身用例覆盖，此处验证热点段不改变既有段序）；
 * - 2.9 未关联任何背景时板块 A 行为与既有一致（prompt 不含板块 B 任何段）。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-hotinject-'));
process.env.WORKBENCH_DB = join(dir, 'inject.db');
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { ensureKnowledgeSchema, KT } = await import('../../knowledge/schema.ts');
const { sqlite } = await import('../../db/client.ts');
const { setTaskHotRefs, clearTaskHotRefs } = await import('../../knowledge/refs.ts');
const { buildProducerSystemPrompt } = await import('../smart-producer.ts');
import type { TaskHotRefInput, TaskKbRefInput } from '@workbench/shared';

const AGENT_ID = 'agent-does-not-exist'; // 无 agents 行 → buildSystemPrompt 原样透传 base
const BASE = 'BASE_SYSTEM_PROMPT';

const HOT_SAMPLE: TaskHotRefInput[] = [
  {
    hotId: '100ec-6663873',
    title: 'Temu自营店突然上线 拼多多千亿布局浮出水面',
    sourceId: '100ec-24h',
    sourceName: '网经社 24h 播报',
    evidence: 'single-source',
    latestAt: '2026-09-11T16:02:47.000Z',
  },
  {
    hotId: 'pai-01m27v234n9yzfg7yv105n2abe',
    title: '2026年8月份全国网约车订单达10.69亿单',
    sourceId: 'pai-news',
    sourceName: '电商派快讯',
    evidence: 'traceable',
    url: 'https://www.pai.com.cn/news/01m27v234n9yzfg7yv105n2abe',
    latestAt: '2026-09-11T09:00:00.000Z',
  },
];

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
});

describe('2.5 注入通道', () => {
  test('① 无热点背景时输出与改动前逐字节一致（不含任何板块 B 段）', async () => {
    clearTaskHotRefs(9001);
    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9001);
    assert.equal(p, BASE, '无 agent/无 kb/无 hot/无 rework → 输出应等于 base');
    assert.ok(!p.includes('【任务背景 · 外部环境情报】'));
  });

  test('② 有热点背景时出现热点段（含来源/证据/链接）且无知识库段时不误出', async () => {
    setTaskHotRefs(9002, HOT_SAMPLE);
    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9002);
    assert.ok(p.includes('【任务背景 · 外部环境情报】'), '热点段标题');
    assert.ok(p.includes('Temu自营店突然上线'), '快照标题');
    assert.ok(p.includes('网经社 24h 播报'), '来源');
    assert.ok(p.includes('原文：'), '原文外链（url 为 null 时该条无此片段，此处样本无 url）');
    assert.ok(!p.includes('【关联知识库资料】'), '无 kb 资料时知识库段不出现');
  });

  test('③ 热点段含「不得作为产品品类/主体/功能规格依据」约束语句', async () => {
    setTaskHotRefs(9003, HOT_SAMPLE);
    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9003);
    assert.ok(p.includes('不得作为产品品类、主体或功能规格的依据'));
  });

  test('④ 热点源不可用（面板 stale/unavailable）时仍能持久化快照注入', async () => {
    // buildHotContext 只读 task_hot_refs 快照表，不触发任何网络/面板调用 → 天然满足
    setTaskHotRefs(9004, HOT_SAMPLE);
    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9004);
    assert.ok(p.includes('【任务背景 · 外部环境情报】'));
  });
});

describe('2.6 与 T1 分工核对：既有段未被改动，热点段为追加', () => {
  test('知识库段与热点段并存且热点段在知识库段之后（段序不变）', async () => {
    // 造一条知识库资料 → 知识库段出现
    sqlite
      .prepare(`INSERT OR REPLACE INTO ${KT.docs} (path,title,dir_path,tags,body,hash,mtime,size) VALUES (?,?,?,?,?,?,?,?)`)
      .run('tests/inject-doc.md', '注入测试文档', 'tests', '[]', '这是一段知识库正文内容。', 'h1', '2026-09-11T00:00:00Z', 18);
    const kbInput: TaskKbRefInput[] = [{ docPath: 'tests/inject-doc.md', anchor: null }];
    const { setTaskKbRefs } = await import('../../knowledge/refs.ts');
    setTaskKbRefs(9005, kbInput);
    setTaskHotRefs(9005, HOT_SAMPLE);

    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9005);
    const kbIdx = p.indexOf('【关联知识库资料】');
    const hotIdx = p.indexOf('【任务背景 · 外部环境情报】');
    assert.ok(kbIdx >= 0, '知识库段存在');
    assert.ok(hotIdx >= 0, '热点段存在');
    assert.ok(hotIdx > kbIdx, '热点段在知识库段之后追加');
    // 两段标题互不包含（可区分）
    assert.ok(!p.slice(kbIdx, hotIdx).includes('【任务背景 · 外部环境情报】'));
    // 知识库段正文与热点段正文共存
    assert.ok(p.includes('这是一段知识库正文内容。'));
    assert.ok(p.includes('Temu自营店突然上线'));
  });
});

describe('2.9 板块独立性回归', () => {
  test('未关联任何背景（无 kb/hot/rework）时，板块 A 行为与既有一致', async () => {
    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9100);
    assert.equal(p, BASE);
    assert.ok(!p.includes('【关联知识库资料】'));
    assert.ok(!p.includes('【任务背景 · 外部环境情报】'));
    assert.ok(!p.includes('【上次返工意见】'));
  });

  test('板块 B 数据不存在（空库）也不抛错，任务可正常走流程', async () => {
    // 冷任务：无 kb 无 hot → buildProducerSystemPrompt 正常返回
    const p = await buildProducerSystemPrompt(AGENT_ID, BASE, 9101);
    assert.equal(p, BASE);
  });
});
