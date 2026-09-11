/**
 * hot-intel 任务背景·外部环境情报测试（D2 独立表 + 注入段）。
 * 运行：node src/knowledge/__tests__/hot-refs.test.ts
 *
 * 覆盖 OpenSpec 任务：2.2 2.3（2.4 路由层在 api.smoke 类测试覆盖；注入通道 2.5/2.6 见 smart-producer 相关测试）
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-hotrefs-'));
process.env.WORKBENCH_DB = join(dir, 'refs.db');
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { sqlite } = await import('../../db/client.ts');
const { ensureKnowledgeSchema, KT } = await import('../schema.ts');
import type { TaskHotRefInput } from '@workbench/shared';
const {
  HOT_HOT_REF_LIMIT,
  HotRefLimitError,
  HotRefInvalidError,
  buildHotContext,
  clearTaskHotRefs,
  hasTaskHotRefs,
  listTaskHotRefs,
  setTaskHotRefs,
  validateTaskHotRefs,
} = await import('../refs.ts');

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
});

const SAMPLE: TaskHotRefInput[] = [
  {
    hotId: 'pai-01m27v234n9yzfg7yv105n2abe',
    title: '2026年8月份全国网约车订单达10.69亿单',
    sourceId: 'pai-news',
    sourceName: '电商派快讯',
    evidence: 'traceable',
    url: 'https://www.pai.com.cn/news/01m27v234n9yzfg7yv105n2abe',
    latestAt: '2026-09-11T09:00:00.000Z',
  },
  {
    hotId: '100ec-6663873',
    title: 'Temu自营店突然上线 拼多多千亿布局浮出水面',
    sourceId: '100ec-24h',
    sourceName: '网经社 24h 播报',
    evidence: 'single-source',
    latestAt: '2026-09-11T16:02:47.000Z',
  },
];

describe('2.2 独立表 task_hot_refs', () => {
  test('ensureKnowledgeSchema 幂等创建 task_hot_refs 表', () => {
    ensureKnowledgeSchema();
    ensureKnowledgeSchema(); // 幂等
    const rows = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).all(KT.hotTaskRefs);
    assert.equal(rows.length, 1);
  });

  test('与 task_kb_refs 结构互不影响（独立表，不共享行）', () => {
    setTaskHotRefs(101, SAMPLE);
    const kbRows = sqlite.prepare(`SELECT count(*) c FROM ${KT.taskRefs} WHERE task_id = 101`).get() as { c: number };
    assert.equal(kbRows.c, 0, '写热点背景不应写入 task_kb_refs');
  });
});

describe('2.3 热点背景读写（全量替换 + 去重 + 校验）', () => {
  test('写入后按 id 升序返回；字段透传', () => {
    const refs = setTaskHotRefs(102, SAMPLE);
    assert.equal(refs.length, 2);
    assert.equal(refs[0].hotId, SAMPLE[0].hotId);
    assert.equal(refs[0].sourceName, '电商派快讯');
    assert.equal(refs[0].evidence, 'traceable');
    assert.equal(refs[1].evidence, 'single-source');
    assert.ok(refs.every((r) => r.valid === true));
  });

  test('全量替换：第二次 PUT 替换旧集', () => {
    setTaskHotRefs(103, SAMPLE);
    setTaskHotRefs(103, [SAMPLE[1]]);
    const refs = listTaskHotRefs(103);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].hotId, SAMPLE[1].hotId);
  });

  test('同一 hotId 去重', () => {
    const refs = setTaskHotRefs(104, [SAMPLE[0], SAMPLE[0]]);
    assert.equal(refs.length, 1);
  });

  test('超限抛 HotRefLimitError', () => {
    const many: TaskHotRefInput[] = Array.from({ length: HOT_HOT_REF_LIMIT + 1 }, (_, i) => ({ hotId: `h${i}`, title: `热点${i}`, sourceId: '', sourceName: '', evidence: 'single-source' }));
    assert.throws(() => setTaskHotRefs(105, many), HotRefLimitError);
    assert.throws(() => validateTaskHotRefs(many), HotRefLimitError);
  });

  test('hotId/title 缺失抛 HotRefInvalidError', () => {
    assert.throws(() => setTaskHotRefs(106, [{ hotId: '', title: 'x', sourceId: '', sourceName: '', evidence: 'single-source' }]), HotRefInvalidError);
    assert.throws(() => setTaskHotRefs(106, [{ hotId: 'h1', title: '  ', sourceId: '', sourceName: '', evidence: 'single-source' }]), HotRefInvalidError);
  });

  test('clearTaskHotRefs / hasTaskHotRefs', () => {
    setTaskHotRefs(107, SAMPLE);
    assert.equal(hasTaskHotRefs(107), true);
    clearTaskHotRefs(107);
    assert.equal(hasTaskHotRefs(107), false);
    assert.equal(listTaskHotRefs(107).length, 0);
  });

  test('持久化快照独立性：热点源不可用（无面板）时背景仍可读取', () => {
    // buildHotContext 只读 task_hot_refs 表，不触发任何网络/面板调用
    setTaskHotRefs(108, SAMPLE);
    const ctx = buildHotContext(108);
    assert.ok(ctx.includes('Temu自营店突然上线'), '注入段应含快照标题');
  });
});

describe('2.3 注入段格式与约束声明', () => {
  test('无任务 / 无背景 → 空字符串（不占位，不影响板块 A 提示词）', () => {
    assert.equal(buildHotContext(null), '');
    assert.equal(buildHotContext(undefined), '');
    assert.equal(buildHotContext(999999), '');
    clearTaskHotRefs(109);
    assert.equal(buildHotContext(109), '');
  });

  test('有背景 → 段标题 + 每条来源/证据/时间/链接 + 约束声明', () => {
    setTaskHotRefs(110, SAMPLE);
    const ctx = buildHotContext(110);
    assert.ok(ctx.includes('【任务背景 · 外部环境情报】'), '段标题');
    assert.ok(ctx.includes('不得作为产品品类、主体或功能规格的依据'), '约束声明');
    assert.ok(ctx.includes('电商派快讯'), '来源');
    assert.ok(ctx.includes('证据等级：可回查原文'), '证据等级中文映射（traceable）');
    assert.ok(ctx.includes('证据等级：单源信息'), '证据等级中文映射（single-source）');
    assert.ok(ctx.includes('数据时间：2026-09-11'), '数据时间');
    assert.ok(ctx.includes('原文：https://www.pai.com.cn/news/'), '原文外链');
    assert.ok(ctx.includes('1. '), '序号');
  });

  test('与知识库资料段可区分（并列而非合并）', () => {
    setTaskHotRefs(111, SAMPLE);
    const hotCtx = buildHotContext(111);
    // kb 段由 buildKnowledgeContext 生成（异步），此处验证两段标题互斥存在即可
    assert.ok(hotCtx.includes('【任务背景 · 外部环境情报】'));
    assert.ok(!hotCtx.includes('【关联知识库资料】'), '热点段不应包含知识库段标题');
  });
});
