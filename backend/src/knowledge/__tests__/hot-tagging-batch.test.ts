/**
 * Q1 分批打标测试（hot-tagging.ts）。
 *
 * 背景（历史教训）：展示集改为全量上屏后条目可达 200+ 条，
 * 一次喂给 LLM 会因输出超长被截断 → extractJson 失败 → 静默全批降级。
 * 故 tagHotItems 改为按批（TAG_BATCH_SIZE 条/批）循环调用并合并。
 *
 * 覆盖：
 * ① 批大小在 20~30；
 * ② 200 条分 8 批调用，覆盖全部条目不重不漏；
 * ③ 单批失败不整体降级（其余批结果保留，aiTagged 仍为 true）；
 * ④ 全部批失败 → 返回 null（聚合层标注 aiDegraded）；
 * ⑤ 空输入 → 空 Map，不触发 LLM。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { tagHotItems, TAG_BATCH_SIZE, __setTagLlmForTest } = await import('../hot-tagging.ts');

/** 假 LLM：按批记录调用，可指定某些批抛错或返回非法 JSON */
function installFakeLlm(opts: { throwOn?: number[]; badJsonOn?: number[] } = {}): { batches: string[][]; calls: number } {
  const batches: string[][] = [];
  let n = 0;
  __setTagLlmForTest(async (input) => {
    const idx = n++;
    const parsed = JSON.parse(input.user.split('\n')[1]) as { items: { t: string }[] };
    batches.push(parsed.items.map((i) => i.t));
    if (opts.throwOn?.includes(idx)) throw new Error('渠道 429 限流');
    if (opts.badJsonOn?.includes(idx)) return { content: '抱歉，我无法完成该请求' };
    return {
      content: JSON.stringify({
        items: parsed.items.map((i) => ({ t: i.t, c: 'ref', tag: '参考', use: '仅供参考' })),
      }),
    };
  });
  return { batches, calls: 0 };
}

describe('Q1 分批打标（hot-tagging）', () => {
  test('① 批大小 TAG_BATCH_SIZE 在 20~30 之间', () => {
    assert.ok(TAG_BATCH_SIZE >= 20 && TAG_BATCH_SIZE <= 30, `批大小 ${TAG_BATCH_SIZE} 应在 20~30（建议区间）`);
  });

  test('② 200 条 → 8 批调用，覆盖全部条目不重不漏', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `h${i}`, title: `热点${i}` }));
    const fake = installFakeLlm();
    try {
      const map = await tagHotItems(items);
      assert.ok(map, '全部批成功应返回 Map');
      assert.equal(fake.batches.length, 8, `200/25 应分 8 批，实际 ${fake.batches.length}`);
      assert.equal(fake.batches.reduce((n, b) => n + b.length, 0), 200, '分批应覆盖全部条目');
      assert.equal(new Set(fake.batches.flat()).size, 200, '条目不重复');
      assert.equal(map!.size, 200, `打标结果应为 200 条，实际 ${map!.size}`);
    } finally {
      __setTagLlmForTest(null);
    }
  });

  test('③ 单批失败不整体降级：其余批结果保留（aiTagged 仍 true）', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `h${i}`, title: `热点${i}` }));
    const fake = installFakeLlm({ badJsonOn: [0] });
    try {
      const map = await tagHotItems(items);
      assert.ok(map, '部分批失败仍应返回 Map（不静默全批降级）');
      assert.equal(fake.batches.length, 2, '50 条分 2 批');
      assert.equal(map!.size, 25, `第 1 批解析失败 → 只保留第 2 批 25 条，实际 ${map!.size}`);
    } finally {
      __setTagLlmForTest(null);
    }
  });

  test('④ 全部批失败 → 返回 null（聚合层标注 aiDegraded）', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, title: `热点${i}` }));
    installFakeLlm({ badJsonOn: [0, 1] });
    try {
      const map = await tagHotItems(items);
      assert.equal(map, null, '全部批失败应返回 null');
    } finally {
      __setTagLlmForTest(null);
    }
  });

  test('⑤ 空输入 → 空 Map 且不触发 LLM', async () => {
    let called = 0;
    __setTagLlmForTest(async () => {
      called++;
      return { content: '{}' };
    });
    try {
      const map = await tagHotItems([]);
      assert.ok(map);
      assert.equal(map!.size, 0);
      assert.equal(called, 0, '空输入不应调用 LLM');
    } finally {
      __setTagLlmForTest(null);
    }
  });
});
