/**
 * B1 · 产出溯源集成测试（deliverable-provenance）—— 服务层自动持久化 + REST 查询接口。
 * 运行：node backend/src/delivery/__tests__/provenance-integration.test.ts
 *
 * 覆盖 OpenSpec 任务：2.4（copy 产出后自动持久化 provenance、返工重产出 version 递增）、
 * 2.5（GET /api/tasks/:id/provenance）、2.6（溯源率与明细数值一致）、2.7（未关联资料 hasRefs=false）
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

const dir = mkdtempSync(join(tmpdir(), 'workbench-provint-'));
process.env.WORKBENCH_DB = join(dir, 'prov.db');
process.env.NODE_ENV = 'test';
const VAULT = join(dir, 'vault');
process.env.WORKBENCH_VAULT_ROOT = VAULT;
process.env.WORKBENCH_ATTENTION_CONFIG = join(dir, 'attention.json');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { ensureKnowledgeSchema } = await import('../../knowledge/schema.ts');
const { saveVaultConfig } = await import('../../knowledge/vault.ts');
const { setTaskKbRefs } = await import('../../knowledge/refs.ts');
const { service } = await import('../../engine/service.ts');
const { buildApp } = await import('../../index.ts');
const { listDeliverables } = await import('../store.ts');
const { MockProducer, setProducer } = await import('../../agents/producer.ts');
import type { CopyPackage } from '@workbench/shared';

let app: FastifyInstance;

function writeVault(rel: string, content: string): void {
  const abs = join(VAULT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

async function waitIndexed(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await app.inject({ method: 'GET', url: '/api/knowledge/stats' });
    const { stats } = res.json() as { stats: { indexing: boolean } };
    if (!stats.indexing) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('索引超时未完成');
}

before(async () => {
  writeVault(
    '产品/磁吸充电宝.md',
    `---
title: 磁吸充电宝产品资料
tags: [产品, 充电]
---

# 产品规格

无线磁吸充电宝，容量 10000mAh，重量 198g，通过 GB 31241 认证，外壳采用铝合金材质。
具备过充、过流、过温、短路四重保护。
`,
  );
  ensureSchema();
  ensureKnowledgeSchema();
  seed();
  saveVaultConfig({ root: VAULT, excludeDirs: ['私密'] });
  app = await buildApp();
  await app.ready();
  await app.inject({ method: 'POST', url: '/api/knowledge/reindex' });
  await waitIndexed();
});

describe('2.4 copy 产出后自动持久化溯源结果', () => {
  test('确认开工 → 文案采纳 → deliverables 出现 kind=provenance 行（含事实明细）', async () => {
    const t = service.createTask({ title: '溯源持久化', description: '', platforms: ['天猫'] });
    setTaskKbRefs(t.id, [{ docPath: '产品/磁吸充电宝.md' }]);
    const task = await service.confirmAndRun(t.id);
    await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
    const rows = listDeliverables(t.id);
    const prov = rows.find((d) => d.kind === 'provenance');
    assert.ok(prov, '存在 kind=provenance 交付物行');
    const result = JSON.parse(prov!.content) as { percent: number; tracedCount: number; totalCount: number; hasRefs: boolean; facts: unknown[] };
    assert.ok(Array.isArray(result.facts) && result.facts.length > 0, '含事实项明细');
    assert.equal(result.hasRefs, true, '已关联资料');
  });

  test('文案返工重产出后 provenance 版本递增（version+1 覆盖，保留同一任务最新结果）', async () => {
    const t = service.createTask({ title: '版本递增', description: '', platforms: ['天猫'] });
    setTaskKbRefs(t.id, [{ docPath: '产品/磁吸充电宝.md' }]);
    await service.confirmAndRun(t.id);
    const v1 = listDeliverables(t.id).filter((d) => d.kind === 'provenance').at(-1)!.version;
    // 任务仍在 copy 确认点：直接打回 → 自动重产出
    const afterReject = await service.decideDeliverable({ taskId: t.id, kind: 'copy', decision: 'reject', note: '参数需核对' });
    assert.equal(afterReject.stage, 'copy');
    const provs = listDeliverables(t.id).filter((d) => d.kind === 'provenance');
    assert.ok(provs.length >= 1);
    assert.ok(provs.at(-1)!.version > v1, '重产出后 provenance 版本递增');
    const latest = provs.at(-1)!;
    assert.ok(JSON.parse(latest.content).generatedAt, '最新结果含 generatedAt');
  });
});

describe('2.5 溯源查询接口', () => {
  test('GET /api/tasks/:id/provenance 返回溯源结果', async () => {
    const t = service.createTask({ title: '接口查询', description: '', platforms: ['天猫'] });
    setTaskKbRefs(t.id, [{ docPath: '产品/磁吸充电宝.md' }]);
    await service.confirmAndRun(t.id);
    await service.decideDeliverable({ taskId: t.id, kind: 'copy', decision: 'approve' });
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/provenance` });
    assert.equal(res.statusCode, 200);
    const { provenance } = res.json() as { provenance: { percent: number | null; totalCount: number; hasRefs: boolean; refCount: number; refsMeta: unknown[] } };
    assert.ok(provenance);
    assert.equal(provenance.hasRefs, true);
    assert.ok(provenance.refCount >= 1, '有可用资料片段');
    assert.ok(provenance.totalCount >= 4, '抽取出事实项');
  });

  test('文案未产出时返回 provenance=null', async () => {
    const t = service.createTask({ title: '未产出', description: '', platforms: ['天猫'] });
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/provenance` });
    const { provenance } = res.json() as { provenance: unknown };
    assert.equal(provenance, null, '无 provenance 行时返回 null');
  });
});

describe('2.6 溯源率与明细数值一致（可人工核对）', () => {
  test('资料中的 10000mAh / 198g / GB 31241 / 铝合金 / 四重保护 均溯源；未在资料中的 100W 未溯源', async () => {
    const t = service.createTask({ title: '数值核对', description: '', platforms: ['天猫'] });
    setTaskKbRefs(t.id, [{ docPath: '产品/磁吸充电宝.md' }]);
    // 注入与资料匹配的文案产出（真实流程中文案 Agent 基于资料生成）
    class ProvProducer extends MockProducer {
      async produceCopy(): Promise<CopyPackage> {
        return {
          title: '磁吸充电宝',
          points: [
            '10000mAh 大容量，重量仅 198g',
            '通过 GB 31241 认证，铝合金外壳',
            '具备过充、过流、过温、短路四重保护',
            '100W 超级快充',
          ],
          outline: '测试',
          keywords: ['充电宝'],
        };
      }
    }
    setProducer(new ProvProducer());
    try {
      await service.confirmAndRun(t.id);
      await service.decideDeliverable({ taskId: t.id, kind: 'copy', decision: 'approve' });
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/provenance` });
      const { provenance } = res.json() as {
        provenance: {
          percent: number | null;
          tracedCount: number;
          untracedCount: number;
          totalCount: number;
          facts: { type: string; text: string; traced: boolean; sources: string[] }[];
        };
      };
      const byText = new Map(provenance.facts.map((f) => [f.text, f]));
      const find = (sub: string) => [...byText.entries()].find(([text]) => text.includes(sub))?.[1];
      const mAh = find('10000mAh');
      assert.ok(mAh && mAh.traced, '10000mAh 已溯源');
      const g = find('198g');
      assert.ok(g && g.traced, '198g 已溯源');
      const gb = find('GB 31241');
      assert.ok(gb && gb.traced, 'GB 31241 已溯源');
      const mat = find('铝合金');
      assert.ok(mat && mat.traced, '铝合金 已溯源');
      const protect = find('四重保护');
      assert.ok(protect && protect.traced, '四重保护 已溯源（文本型覆盖率判定）');
      const w = find('100W');
      assert.ok(w && !w.traced, '100W 未在资料中 → 未溯源');
      // 溯源率口径：percent=Math.round(traced/total*100) 且 分子+分母=总数
      if (provenance.percent !== null && provenance.totalCount > 0) {
        assert.equal(provenance.percent, Math.round((provenance.tracedCount / provenance.totalCount) * 100));
        assert.equal(provenance.tracedCount + provenance.untracedCount, provenance.totalCount);
      }
    } finally {
      setProducer(new MockProducer());
    }
  });
});

describe('2.7 未关联资料的核对警示数据', () => {
  test('未关联任何知识库资料 → hasRefs=false、refCount=0', async () => {
    const t = service.createTask({ title: '无资料', description: '', platforms: ['天猫'] });
    await service.confirmAndRun(t.id);
    await service.decideDeliverable({ taskId: t.id, kind: 'copy', decision: 'approve' });
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/provenance` });
    const { provenance } = res.json() as { provenance: { hasRefs: boolean; refCount: number; facts: unknown[] } };
    assert.equal(provenance.hasRefs, false, 'hasRefs=false 供界面显示「参数由模型生成，请人工核对」');
    assert.equal(provenance.refCount, 0);
  });
});
