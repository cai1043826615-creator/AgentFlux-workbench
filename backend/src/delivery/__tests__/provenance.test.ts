/**
 * 产出溯源（T1-B1 · deliverable-provenance）单元测试。
 * 运行：pnpm --filter @workbench/backend exec tsx src/delivery/__tests__/provenance.test.ts
 *
 * 覆盖断言点：
 * 1. extractFacts 四类事实项抽取（数值+单位 / 认证编号 / 材质 / 文本型）+ 停用词过滤 + 跨字段去重
 * 2. normalizeText 归一化（数字与单位空格 / 全角转半角 / 统一小写）
 * 3. matchFacts 命中与未命中（sources 填充）
 * 4. 文本型覆盖率（spec 场景：过充/过流/过温/短路 判定已溯源；无场景 → 未溯源）
 * 5. state='missing' 的片段不参与匹配
 * 6. computeProvenanceRate 溯源率（4/6 → 67%；0 事实 → noFacts）
 * 7. 文本型覆盖率阈值可配置（提高后原命中变未命中）
 * 8. buildProvenanceResult 端到端组装（Vault + 关联资料 → refsMeta / refCount / percent）
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import type { CopyPackage, FactItem } from '@workbench/shared';
import type { KbFragment, TaskKbRef } from '../../knowledge/refs.ts';

const dir = mkdtempSync(join(tmpdir(), 'workbench-provenance-'));
process.env.WORKBENCH_DB = join(dir, 'provenance.db');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { ensureKnowledgeSchema } = await import('../../knowledge/schema.ts');
const { saveVaultConfig } = await import('../../knowledge/vault.ts');
const { rebuildIndex } = await import('../../knowledge/indexer.ts');
const { setTaskKbRefs } = await import('../../knowledge/refs.ts');
const {
  DEFAULT_TEXTUAL_COVERAGE_THRESHOLD,
  DEFAULT_MATERIAL_WORDS,
  normalizeText,
  extractFacts,
  matchFacts,
  computeProvenanceRate,
  buildProvenanceResult,
} = await import('../provenance.ts');

const VAULT = join(dir, 'vault');

const PRODUCT_MD = `---
title: 磁吸充电宝产品资料
tags: [产品]
---

# 产品规格

电池容量 10000mAh，净重 198g。
通过 GB 31241 认证，材质为铝合金机身。
具备过充、过流、过温、短路四重保护。
`;

/** 写 Vault 内文档 */
function writeVault(rel: string, content: string): void {
  const abs = join(VAULT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** 构造手工 KbFragment（只测纯函数时用，不依赖 Vault） */
function frag(title: string, content: string | null, state: KbFragment['state'] = 'ok'): KbFragment {
  const ref: TaskKbRef = {
    id: 1,
    taskId: 999,
    docPath: `${title}.md`,
    title,
    anchor: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    valid: true,
  };
  return { ref, content, state };
}

/** 构造手工 FactItem（匹配测试用） */
function fact(partial: Partial<FactItem> & Pick<FactItem, 'type' | 'normalized'>): FactItem {
  return { id: 'f0', text: '', field: 'points', index: 0, traced: false, sources: [], coverage: null, ...partial };
}

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
  writeVault('产品/充电宝.md', PRODUCT_MD);
  saveVaultConfig({ root: VAULT });
  await rebuildIndex();
});

// ===================== 2. normalizeText 归一化 =====================

describe('normalizeText 基础归一化', () => {
  test('数字与单位之间空格去除（10000 mAh → 10000mAh）', () => {
    assert.equal(normalizeText('10000 mAh'), normalizeText('10000mAh'));
    assert.equal(normalizeText('10000 mAh'), '10000mah');
    assert.equal(normalizeText('净重 198 g'), '净重 198g');
  });

  test('全角转半角生效', () => {
    // 注：全角 ASCII 区为 \uFF01-\uFF5E（统一减 0xFEE0）；方括号用全角 ［］(U+FF3B/U+FF3D)。
    // 规格转换表里的【】是 U+3010/3011，不在全角 ASCII 区，统一减 0xFEE0 不会转换（见交付说明中的歧义报告）。
    assert.equal(normalizeText('！，、；：（）？［］'), '!,、;:()?[]');
    assert.equal(normalizeText('电池容量：１００００ ｍＡｈ'), '电池容量:10000mah');
    assert.equal(normalizeText('全角\u3000空格'), '全角 空格');
  });

  test('统一小写生效', () => {
    assert.equal(normalizeText('RoHS FCC CE'), 'rohs fcc ce');
    assert.equal(normalizeText('  Tritan 材质  '), 'tritan 材质');
  });
});

// ===================== 1. extractFacts 事实项抽取 =====================

describe('extractFacts 事实项抽取', () => {
  test('数值+单位：抽出 10000mAh 与 198g', () => {
    const copy: CopyPackage = { title: '', points: ['电池容量 10000mAh，净重 198g'], outline: '', keywords: [] };
    const facts = extractFacts(copy);
    const units = facts.filter((f) => f.type === 'number-unit');
    assert.ok(units.some((f) => f.text === '10000mAh' && f.field === 'points' && f.index === 0), '应抽出 10000mAh（number-unit）');
    assert.ok(units.some((f) => f.text === '198g'), '应抽出 198g（number-unit）');
    // 初始状态：traced=false、sources=[]、coverage=null
    const f10000 = units.find((f) => f.text === '10000mAh')!;
    assert.equal(f10000.traced, false);
    assert.deepEqual(f10000.sources, []);
    assert.equal(f10000.coverage, null);
    assert.equal(f10000.normalized, '10000mah');
  });

  test('认证/标准编号：抽出 GB 31241', () => {
    const copy: CopyPackage = { title: '', points: ['通过 GB 31241 认证'], outline: '', keywords: [] };
    const certs = extractFacts(copy).filter((f) => f.type === 'certification');
    assert.ok(certs.some((f) => f.text === 'GB 31241'), '应抽出 GB 31241（certification）');
  });

  test('认证编号补充：UN 38.3 与 RoHS', () => {
    const copy: CopyPackage = { title: '', points: ['电池通过 UN 38.3 测试，符合 RoHS 要求'], outline: '', keywords: [] };
    const certs = extractFacts(copy)
      .filter((f) => f.type === 'certification')
      .map((f) => f.text);
    assert.ok(certs.includes('UN 38.3'));
    assert.ok(certs.includes('RoHS'));
  });

  test('材质成分词：抽出 铝合金', () => {
    const copy: CopyPackage = { title: '', points: ['铝合金机身'], outline: '', keywords: [] };
    const mats = extractFacts(copy).filter((f) => f.type === 'material');
    assert.ok(mats.some((f) => f.text === '铝合金'), '应抽出 铝合金（material）');
  });

  test('材质成分词大小写不敏感（ABS）', () => {
    assert.ok(DEFAULT_MATERIAL_WORDS.includes('ABS'), '词表应含 ABS');
    const copy: CopyPackage = { title: '', points: ['abs 塑料外壳'], outline: '', keywords: [] };
    const mats = extractFacts(copy).filter((f) => f.type === 'material');
    assert.ok(mats.some((f) => f.text === 'ABS'), '小写 abs 也应抽出词表原词 ABS');
  });

  test('文本型事实：四重保护抽出一条', () => {
    const copy: CopyPackage = { title: '', points: ['具备过充、过流、过温、短路四重保护'], outline: '', keywords: [] };
    const textuals = extractFacts(copy).filter((f) => f.type === 'textual');
    assert.equal(textuals.length, 1, '冒号/斜杠/顿号不分句，应只有一条文本型事实');
    assert.equal(textuals[0].text, '具备过充、过流、过温、短路四重保护');
  });

  test('纯「了解更多」类文案返回空数组（无实质事实项）', () => {
    const copy: CopyPackage = {
      title: '更多',
      points: ['了解更多', '点击', '详情'],
      outline: '敬请期待',
      keywords: ['等你来', '新品上架'],
    };
    assert.deepEqual(extractFacts(copy), []);
  });

  test('跨字段去重：同一事实只算一条（保留首次 field/index）', () => {
    const copy: CopyPackage = { title: '10000mAh 快充', points: ['10000mAh 大容量'], outline: '', keywords: ['10000mAh'] };
    const units = extractFacts(copy).filter((f) => f.type === 'number-unit');
    assert.equal(units.length, 1);
    assert.equal(units[0].field, 'title');
    assert.equal(units[0].index, -1);
  });
});

// ===================== 3/4/5/7. matchFacts 匹配 =====================

describe('matchFacts 匹配（手工构造 fragments）', () => {
  test('数值事实命中与未命中（sources 填充）', () => {
    const frags = [frag('产品规格', '电池容量 10000mAh')];
    const facts: FactItem[] = [
      fact({ type: 'number-unit', text: '10000mAh', normalized: normalizeText('10000mAh') }),
      fact({ type: 'number-unit', text: '20000mAh', normalized: normalizeText('20000mAh') }),
    ];
    matchFacts(facts, frags);
    assert.equal(facts[0].traced, true, '10000mAh 应命中');
    assert.deepEqual(facts[0].sources, ['产品规格'], 'sources 应含该资料标题');
    assert.equal(facts[1].traced, false, '20000mAh 应未命中');
    assert.deepEqual(facts[1].sources, [], '未命中 sources 应为空');
  });

  test('认证与材质事实命中', () => {
    const frags = [frag('产品资料', '通过 GB 31241 认证，材质为铝合金机身')];
    const facts: FactItem[] = [
      fact({ type: 'certification', text: 'GB 31241', normalized: normalizeText('GB 31241') }),
      fact({ type: 'material', text: '铝合金', normalized: normalizeText('铝合金') }),
    ];
    matchFacts(facts, frags);
    assert.equal(facts[0].traced, true);
    assert.equal(facts[1].traced, true);
  });

  test('文本型覆盖率：spec 场景判定已溯源', () => {
    const frags = [frag('产品资料', '具备过充、过流、过温、短路四重保护')];
    const f = fact({
      type: 'textual',
      text: '四重保护：过充 / 过流 / 过温 / 短路',
      normalized: normalizeText('四重保护：过充 / 过流 / 过温 / 短路'),
    });
    matchFacts([f], frags);
    assert.equal(f.traced, true, '覆盖率 ≥ 0.8 应判定已溯源');
    assert.ok(f.coverage !== null && f.coverage >= DEFAULT_TEXTUAL_COVERAGE_THRESHOLD, `覆盖率应 ≥ 0.8，实际 ${f.coverage}`);
    assert.deepEqual(f.sources, ['产品资料']);
  });

  test('文本型事实：资料只有规格无场景 → 未溯源', () => {
    const frags = [frag('产品规格', '容量 10000mAh，净重 198g')];
    const f = fact({ type: 'textual', text: '通勤场景单手可用', normalized: normalizeText('通勤场景单手可用') });
    matchFacts([f], frags);
    assert.equal(f.traced, false);
    assert.equal(f.coverage, 0);
  });

  test("state='missing' 的片段不参与匹配", () => {
    const frags = [frag('缺失资料', '电池容量 10000mAh', 'missing')];
    const f = fact({ type: 'number-unit', text: '10000mAh', normalized: normalizeText('10000mAh') });
    matchFacts([f], frags);
    assert.equal(f.traced, false, 'missing 片段即使含事实文本也不应参与');
    assert.deepEqual(f.sources, []);
  });

  test('文本型覆盖率阈值可配置：提高后原命中变未命中', () => {
    const frags = [frag('产品资料', '具备过充、过流、过温、短路四重保护')];
    const text = '四重保护：过充 / 过流 / 过温 / 短路 / 快充';
    // 默认阈值 0.8：覆盖率约 12/14 ≈ 0.857 → 命中
    const low = fact({ type: 'textual', text, normalized: normalizeText(text) });
    matchFacts([low], frags, DEFAULT_TEXTUAL_COVERAGE_THRESHOLD);
    assert.equal(low.traced, true, '默认阈值 0.8 下应命中');
    assert.ok(low.coverage !== null && low.coverage >= 0.8 && low.coverage < 0.9, `覆盖率应在 [0.8,0.9)，实际 ${low.coverage}`);
    // 阈值提高到 0.9 → 未命中
    const high = fact({ type: 'textual', text, normalized: normalizeText(text) });
    matchFacts([high], frags, 0.9);
    assert.equal(high.traced, false, '阈值提高到 0.9 后应未命中');
  });
});

// ===================== 6. computeProvenanceRate 溯源率 =====================

describe('computeProvenanceRate 溯源率', () => {
  test('6 个事实中 4 个命中 → percent=67', () => {
    const facts: FactItem[] = [
      fact({ type: 'number-unit', normalized: '1', traced: true }),
      fact({ type: 'number-unit', normalized: '2', traced: true }),
      fact({ type: 'material', normalized: '3', traced: true }),
      fact({ type: 'material', normalized: '4', traced: true }),
      fact({ type: 'textual', normalized: '5', traced: false }),
      fact({ type: 'textual', normalized: '6', traced: false }),
    ];
    const rate = computeProvenanceRate(facts);
    assert.equal(rate.percent, 67);
    assert.equal(rate.tracedCount, 4);
    assert.equal(rate.untracedCount, 2);
    assert.equal(rate.totalCount, 6);
    assert.equal(rate.noFacts, false);
  });

  test('0 事实 → noFacts=true、percent=null', () => {
    const rate = computeProvenanceRate([]);
    assert.equal(rate.noFacts, true);
    assert.equal(rate.percent, null);
    assert.equal(rate.tracedCount, 0);
    assert.equal(rate.untracedCount, 0);
    assert.equal(rate.totalCount, 0);
  });
});

// ===================== 8. buildProvenanceResult 结果组装（端到端） =====================

describe('buildProvenanceResult 结果组装（Vault + 关联资料）', () => {
  test('关联资料下的完整溯源结果', async () => {
    const taskId = 9001;
    setTaskKbRefs(taskId, [{ docPath: '产品/充电宝.md' }]);
    const copy: CopyPackage = {
      title: '磁吸充电宝 10000mAh',
      points: ['净重 198g', '通过 GB 31241 认证', '铝合金机身', '四重保护：过充 / 过流 / 过温 / 短路', '通勤场景单手可用'],
      outline: '10000mAh 大容量',
      keywords: ['充电宝'],
    };

    const result = await buildProvenanceResult(taskId, copy);

    assert.equal(result.hasRefs, true);
    assert.equal(result.refCount, 1, '可用片段数应为 1');
    assert.equal(result.refsMeta.length, 1);
    assert.equal(result.refsMeta[0].title, '磁吸充电宝产品资料');
    assert.ok(result.refsMeta[0].mtime.length > 0, 'mtime 应来自 knowledge_docs');
    assert.ok(result.refsMeta[0].hash.length > 0, 'hash 应来自 knowledge_docs');
    assert.ok(!Number.isNaN(Date.parse(result.generatedAt)), 'generatedAt 应为可解析 ISO 时间');

    assert.equal(result.noFacts, false);
    // 17 = 数值(10000mAh/198g) 2 + 认证(GB 31241) 1 + 材质(铝合金) 1 + 文本型 13；
    // 13 条溯源中：通勤场景单手可用 / 磁吸充电宝 / 大容量 / 充电宝 未溯源
    assert.equal(result.totalCount, 17);
    assert.equal(result.tracedCount, 13);
    assert.equal(result.untracedCount, 4);
    assert.equal(result.percent, 76);

    const f10000 = result.facts.find((f) => f.type === 'number-unit' && f.text === '10000mAh')!;
    assert.equal(f10000.traced, true);
    assert.deepEqual(f10000.sources, ['磁吸充电宝产品资料']);

    const untraced = result.facts.find((f) => f.text === '通勤场景单手可用')!;
    assert.equal(untraced.traced, false);

    const fAlu = result.facts.find((f) => f.type === 'material' && f.text === '铝合金')!;
    assert.equal(fAlu.traced, true);
  });

  test('未关联资料：hasRefs=false、refCount=0、全部未溯源', async () => {
    const copy: CopyPackage = { title: '', points: ['10000mAh 大容量'], outline: '', keywords: [] };
    const result = await buildProvenanceResult(99999, copy);
    assert.equal(result.hasRefs, false);
    assert.equal(result.refCount, 0);
    assert.deepEqual(result.refsMeta, []);
    // 事实项：number-unit 10000mAh + textual 大容量 = 2；无资料全部未溯源
    assert.equal(result.totalCount, 2);
    assert.equal(result.tracedCount, 0);
    assert.equal(result.percent, 0);
  });
});
