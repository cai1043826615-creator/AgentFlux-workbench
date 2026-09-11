/**
 * hot-intel 固定样本噪音回归测试（4.4 规则生效性 + 4.5 逐条期望 + 4.6 噪音量化）。
 * 运行：node src/knowledge/__tests__/hot-noise.test.ts
 *
 * 覆盖 OpenSpec 任务：4.4 4.5 4.6
 * - 4.4：清空 competitor.excludeKeywords 后 Apple 发布会条目重新进入必看（证明规则在生效，非样本不命中）；
 * - 4.5：固定语料跑 classifyHot，逐条断言层级 == 写死期望；
 * - 4.6：同一 corpus 下「旧逻辑 vs 新逻辑」mustRead 噪音数从 N 降到 0，量化输出。
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import type { HotTier } from '@workbench/shared';
import type { RawHotItem } from '../attention.ts';

const dir = mkdtempSync(join(tmpdir(), 'workbench-hotnoise-'));
process.env.WORKBENCH_DB = join(dir, 'noise.db');
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { ensureKnowledgeSchema } = await import('../schema.ts');
const { DEFAULT_ATTENTION, normalizeAttention, classifyHot, tierOf } = await import('../attention.ts');
const { HOT_NOISE_CORPUS } = await import('./fixtures/hot-noise-corpus.ts');

before(async () => {
  ensureSchema();
  ensureKnowledgeSchema();
});

/** corpus → classifyHot 输入（含最新进展参与匹配）；stripSource 模拟改动前旧格式（无源分层） */
function toRaw(items: typeof HOT_NOISE_CORPUS, stripSource = false): RawHotItem[] {
  return items.map((c) => ({
    id: c.id,
    title: c.title,
    summary: c.summary ?? null,
    latest: null,
    source: c.sourceId ?? '测试源',
    sourceId: stripSource ? undefined : c.sourceId,
    vertical: stripSource ? undefined : c.vertical,
    sourceCount: c.sourceCount,
    url: null,
    latestAt: '2026-09-11T00:00:00Z',
  }));
}

const NEW_LOGIC_CFG = normalizeAttention(DEFAULT_ATTENTION);

/** 默认规则但展示上限放宽到上限 50（验证「分层规则」而非「截断」；截断由 4.3 ③ 单独覆盖） */
const FULL_CFG = normalizeAttention({ ...DEFAULT_ATTENTION, mustReadLimit: 50, browseLimit: 50, otherLimit: 50 });

/** 旧逻辑（hot-intel 改动前）：无排除词、单关键词命中即成立、旧格式无源分层 */
function oldLogicCfg() {
  return normalizeAttention({
    ...DEFAULT_ATTENTION,
    mustReadLimit: 50,
    browseLimit: 50,
    otherLimit: 50,
    sources: undefined,
    domains: DEFAULT_ATTENTION.domains.map((d) => ({ ...d, excludeKeywords: [], minKeywordHits: 1 })),
  });
}

/** 4.4 验证配置：仅清空 competitor 排除词 + 单词命中，其余规则保留 */
function clearedExcludeCfg() {
  return normalizeAttention({
    ...DEFAULT_ATTENTION,
    mustReadLimit: 50,
    browseLimit: 50,
    otherLimit: 50,
    domains: DEFAULT_ATTENTION.domains.map((d) =>
      d.id === 'competitor' ? { ...d, excludeKeywords: [], minKeywordHits: 1 } : d,
    ),
  });
}

describe('4.5 固定样本回归：逐条断言层级等于写死期望', () => {
  test(`语料共 ${HOT_NOISE_CORPUS.length} 条（≥20），全部按期望归层`, () => {
    assert.ok(HOT_NOISE_CORPUS.length >= 20, `语料应 ≥20 条，实际 ${HOT_NOISE_CORPUS.length}`);
    const tiers = classifyHot(toRaw(HOT_NOISE_CORPUS), FULL_CFG);
    const failures: string[] = [];
    for (const c of HOT_NOISE_CORPUS) {
      const item = [...tiers.mustRead, ...tiers.browse, ...tiers.other].find((i) => i.id === c.id);
      assert.ok(item, `条目 ${c.id} 应出现在分层结果中`);
      const actual = tierOf(item!, tiers);
      if (actual !== c.expected) {
        failures.push(`${c.id}「${c.title}」期望 ${c.expected} 实际 ${actual}`);
      }
    }
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  test('实证反例必须归入 other（Apple / DeepSeek 不进必看也不进浏览）', () => {
    const tiers = classifyHot(toRaw(HOT_NOISE_CORPUS), FULL_CFG);
    for (const id of ['noise-apple', 'noise-deepseek']) {
      const item = [...tiers.mustRead, ...tiers.browse, ...tiers.other].find((i) => i.id === id)!;
      assert.equal(tierOf(item, tiers), 'other', `${id} 应归 other`);
    }
  });

  test('真·电商样本进必看（平台规则/促销节点/品类趋势/竞品动态覆盖 ≥2 类）', () => {
    const tiers = classifyHot(toRaw(HOT_NOISE_CORPUS), FULL_CFG);
    const mustReadIds = new Set(tiers.mustRead.map((i) => i.id));
    for (const id of ['real-platform-rule', 'real-promo', 'real-jd618', 'real-content', 'real-competitor', 'real-platform-multi']) {
      assert.ok(mustReadIds.has(id), `${id} 应进必看`);
    }
    const caps = new Set<string>();
    for (const i of tiers.mustRead) for (const d of i.domains ?? []) caps.add(d.id);
    assert.ok(caps.size >= 2, `必看层覆盖关注域 ${caps.size} 类（${[...caps].join('/')}），需 ≥2`);
  });
});

describe('4.4 规则生效性：清空排除词后 Apple 发布会条目重新进入浏览', () => {
  test('默认配置下 Apple 在 other；清空 competitor.excludeKeywords + 阈值 1 后重新进入浏览', () => {
    // 新逻辑（默认排除词 + 阈值 2）：other
    const t1 = classifyHot(toRaw([HOT_NOISE_CORPUS.find((c) => c.id === 'noise-apple')!]), NEW_LOGIC_CFG);
    assert.equal(tierOf(t1.other[0], t1), 'other');
    // 清空 competitor 排除词 + 单词命中（其余规则保留）：competitor 命中「发布」→ 成立；
    // sourceCount 3 ≥2 → strong 候选，但 aihot 源 tierCap=browse（独立规则，见 4.3）→ 进浏览
    const t2 = classifyHot(toRaw([HOT_NOISE_CORPUS.find((c) => c.id === 'noise-apple')!]), clearedExcludeCfg());
    const item = [...t2.browse, ...t2.mustRead].find((i) => i.id === 'noise-apple');
    assert.ok(item, '清空排除词+阈值1 后 Apple 应离开 other 重新进入浏览/必看');
    assert.equal(tierOf(item!, t2), 'browse', 'aihot 源被 tierCap 限制在浏览（独立于排除词的规则）');
  });
});

describe('4.6 噪音下降量化：mustRead 噪音条目数从 N 降到 0', () => {
  test('新逻辑 mustRead 无噪音；旧逻辑 mustRead 有噪音（数值输出）', () => {
    const noiseIds = new Set(HOT_NOISE_CORPUS.filter((c) => c.noise).map((c) => c.id));

    // 新逻辑：默认规则 + 带源元数据（排除词/阈值/tierCap 全部生效）
    const newTiers = classifyHot(toRaw(HOT_NOISE_CORPUS), FULL_CFG);
    // 旧逻辑：无排除词、单词命中、旧格式无源分层
    const oldTiers = classifyHot(toRaw(HOT_NOISE_CORPUS, true), oldLogicCfg());

    const noiseInNewMustRead = newTiers.mustRead.filter((i) => noiseIds.has(i.id)).length;
    const noiseInOldMustRead = oldTiers.mustRead.filter((i) => noiseIds.has(i.id)).length;
    const totalInNew = newTiers.mustRead.length;

    console.log(`[hot-noise] 旧逻辑 mustRead 噪音条目数=${noiseInOldMustRead}，新逻辑=${noiseInNewMustRead}（新逻辑 mustRead 共 ${totalInNew} 条，噪音 ${noiseInNewMustRead}）`);
    assert.ok(noiseInOldMustRead > 0, '旧逻辑应存在噪音进必看（否则对比无意义）');
    assert.equal(noiseInNewMustRead, 0, `新逻辑 mustRead 噪音条目数应为 0，实际 ${noiseInNewMustRead}`);
  });

  test('新逻辑 mustRead 全部为真·电商样本（噪音占比 0%）', () => {
    const tiers = classifyHot(toRaw(HOT_NOISE_CORPUS), FULL_CFG);
    const noiseIds = new Set(HOT_NOISE_CORPUS.filter((c) => c.noise).map((c) => c.id));
    const bad = tiers.mustRead.filter((i) => noiseIds.has(i.id));
    assert.deepEqual(bad.map((i) => i.id), [], '必看层不得出现噪音');
  });
});

// 类型锚点：HotTier 用于断言（避免未使用告警）
export type _Anchor = HotTier;
