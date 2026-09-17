/**
 * 小助理 RAG 轻量检索层测试（backend/src/knowledge/rag.ts）。
 * 运行：pnpm --filter @workbench/backend exec tsx src/knowledge/__tests__/rag.test.ts
 *
 * 覆盖：命中取段落级片段 / 片段数与总长上限 / 三种降级（未连接、无命中、空问题）/ 来源可引用。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-rag-'));
process.env.WORKBENCH_DB = join(dir, 'rag.db');
delete process.env.WORKBENCH_VAULT_ROOT;

const { ensureSchema } = await import('../../db/ensure.ts');
const { saveVaultConfig } = await import('../vault.ts');
const { rebuildIndex } = await import('../indexer.ts');
const { retrieveKnowledge } = await import('../rag.ts');

/** 构造测试用 Vault */
const VAULT = join(dir, 'vault');
function writeVault(rel: string, content: string): void {
  const abs = join(VAULT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** 品牌视觉规范：含明确章节与配色要求（RAG 应定位到「一、配色」章节） */
const VISION_MD = `---
title: 品牌视觉规范
tags: [品牌, 视觉]
---

# 品牌视觉规范

> 描述：主图与详情图的视觉基线。

## 一、配色

- 主色：品牌主色 1 个（大面积：背景/色块），辅助色 ≤ 2 个。
- 首图背景：白底或浅灰，场景图可用生活化暖调，但主色占比 ≥ 60%。
- 文字对比：正文深灰 #333 以上，禁用浅灰小字。

## 二、字体层级

- 层级 ≤ 3 级：钩子标题、卖点短句、说明小字。
- 同图字体族 ≤ 2 种，禁用装饰性花体。
`;

/** 无标题文档：验证行窗口回退分支 */
const NO_HEAD_MD = `这是一篇没有任何标题的笔记。

退货政策说明：支持 7 天无理由退货，商品需保持完好不影响二次销售。

以上为退货相关约定。
`;

const LONG_MD = `# 超长文档\n\n## 参数\n\n${'充电宝容量参数与规格说明。'.repeat(200)}\n`;

before(async () => {
  ensureSchema();
  writeVault('知识库/品牌规范/品牌视觉规范.md', VISION_MD);
  writeVault('知识库/售后/退货说明.md', NO_HEAD_MD);
  writeVault('知识库/产品/超长参数.md', LONG_MD);
  saveVaultConfig({ root: VAULT });
  await rebuildIndex();
});

describe('RAG 检索（FTS5 轻量版）', () => {
  test('命中文档并取到段落级片段（不是整篇），来源可引用', async () => {
    const r = await retrieveKnowledge('视觉规范里关于配色的要求');
    assert.ok(r.chunks.length >= 1, '应有检索片段');
    const chunk = r.chunks[0];
    assert.equal(chunk.path, '知识库/品牌规范/品牌视觉规范.md');
    assert.equal(chunk.title, '品牌视觉规范');
    assert.ok(chunk.content.includes('配色'), `片段应命中配色章节，实际：${chunk.content.slice(0, 80)}`);
    assert.ok(!chunk.content.includes('字体层级'), '不应把不相关章节整篇塞入');
    assert.ok(r.promptBlock.includes(chunk.path), '参考资料块须含来源路径（供模型引用）');
    assert.ok(r.promptBlock.includes('来源文档路径'), '参考资料块须含引用要求');
  });

  test('每篇只取 1 段，片段数不超过上限', async () => {
    const r = await retrieveKnowledge('充电宝', { maxChunks: 1 });
    assert.ok(r.chunks.length <= 1, `片段数应 ≤1，实际 ${r.chunks.length}`);
    for (const p of new Set(r.chunks.map((c) => c.path))) {
      assert.equal(r.chunks.filter((c) => c.path === p).length, 1, '同一文档只取一段');
    }
  });

  test('单片段长度与总长度都不超上限', async () => {
    const r = await retrieveKnowledge('充电宝容量参数', { maxChunkChars: 200, maxTotalChars: 300 });
    assert.ok(r.chunks.length >= 1);
    for (const c of r.chunks) assert.ok(c.content.length <= 201, `单片段超长：${c.content.length}`);
    const total = r.chunks.reduce((s, c) => s + c.content.length, 0);
    assert.ok(total <= 301, `总长超限：${total}`);
  });

  test('无标题文档按命中位置取行窗口（不整篇注入）', async () => {
    const r = await retrieveKnowledge('退货政策');
    const hit = r.chunks.find((c) => c.path === '知识库/售后/退货说明.md');
    assert.ok(hit, '应命中无标题文档');
    assert.equal(hit.anchor, undefined, '无标题文档无章节锚点');
    assert.ok(hit.content.includes('退货'), '应含命中内容');
  });

  test('降级①：知识库未连接 → 空结果，不抛错', async () => {
    saveVaultConfig({ root: '' });
    const r = await retrieveKnowledge('配色');
    assert.deepEqual(r.chunks, []);
    assert.equal(r.promptBlock, '');
    assert.match(String(r.reason), /未连接/);
    saveVaultConfig({ root: VAULT });
  });

  test('降级②：检索无命中 → 空结果，不抛错', async () => {
    const r = await retrieveKnowledge('绝对不存在的关键词zzz');
    assert.deepEqual(r.chunks, []);
    assert.equal(r.promptBlock, '');
    assert.ok(r.reason, '应给出降级原因');
  });

  test('降级③：空问题 → 空结果，不抛错', async () => {
    for (const q of ['', '   ']) {
      const r = await retrieveKnowledge(q);
      assert.deepEqual(r.chunks, [], `q=${JSON.stringify(q)} 应为空`);
      assert.equal(r.promptBlock, '');
    }
  });

  test('异常输入不抛错（含 FTS 特殊字符）', async () => {
    for (const q of ['"AND"', 'a"b', '--/*.', '中文 AND 配色', '🙂🙂']) {
      const r = await retrieveKnowledge(q);
      assert.ok(Array.isArray(r.chunks), `q=${q} 应返回数组`);
    }
  });

  test('Vault 文件被删仍能降级（回退索引正文或不注入，不抛错）', async () => {
    const rel = '知识库/售后/退货说明.md';
    rmSync(join(VAULT, rel));
    const r = await retrieveKnowledge('退货政策');
    assert.ok(Array.isArray(r.chunks), '不应抛错');
    writeVault(rel, NO_HEAD_MD); // 还原
    await rebuildIndex();
  });
});
