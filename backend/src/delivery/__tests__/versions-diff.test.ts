/**
 * 交付物版本历史与差异（delivery-ops B3，组 2/3 模块级回归）：
 * - saveDeliverable 覆盖前留档；版本递增；v1 内容完整保留；首次产出不留多余历史
 * - 完整历史视图「最大版本号 === deliverables.version」；保留上限裁剪
 * - diff：卖点增删/标题/大纲/关键词（含前后值）、图片增删、identical、无上一版明确态
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'workbench-versions-'));
process.env.WORKBENCH_DB = join(dir, 'versions.db');

const { ensureSchema } = await import('../../db/ensure.ts');
const { get, run } = await import('../../db/client.ts');
const { saveDeliverable } = await import('../../delivery/store.ts');
const { fullVersionHistory, backfillVersionHistory, MAX_VERSIONS_PER_DELIVERABLE } = await import('../../delivery/versions.ts');
const { diffDeliverableVersions, noPreviousDiff, normalizePoint } = await import('../../delivery/diff.ts');

ensureSchema();

const v1Copy = { title: '30W 快充 磁吸充电宝', points: ['30W 快充', '磁吸对位', '10000mAh'], outline: '卖点→参数→场景', keywords: ['充电宝', '磁吸'] };
const v2Copy = { title: '30W 快充 磁吸充电宝 Pro', points: ['30W 快充', '磁吸对位', '20000mAh'], outline: '卖点→参数→场景→售后', keywords: ['充电宝', '磁吸', '大容量'] };

describe('2.x 版本历史', () => {
  test('首次产出 version=1 且完整历史恰一条（不留多余历史）', () => {
    const del1 = saveDeliverable(101, 'copy', 'copy', v1Copy);
    assert.equal(del1.version, 1);
    const hist = fullVersionHistory(del1);
    assert.equal(hist.length, 1);
    assert.equal(hist[0].version, 1);
    assert.equal(hist[0].content, JSON.stringify(v1Copy));
  });

  test('二次产出 version=2；完整历史含 v1 与 v2，v1 内容与首次产出逐字段一致', () => {
    const del2 = saveDeliverable(101, 'copy', 'copy', v2Copy);
    assert.equal(del2.version, 2);
    const hist = fullVersionHistory(del2);
    assert.equal(hist.length, 2);
    const h1 = hist.find((v) => v.version === 1)!;
    const h2 = hist.find((v) => v.version === 2)!;
    assert.deepEqual(JSON.parse(h1.content), v1Copy, 'v1 应为首次产出的完整文案包');
    assert.deepEqual(JSON.parse(h2.content), v2Copy, 'v2 应为当前交付物');
    // 历史最大版本号 === deliverables.version
    assert.equal(Math.max(...hist.map((v) => v.version)), del2.version);
    assert.equal(hist[hist.length - 1].version, del2.version);
  });

  test('版本保留上限：超出 MAX_VERSIONS_PER_DELIVERABLE 后裁剪最旧', () => {
    let del = saveDeliverable(102, 'copy', 'copy', v1Copy);
    for (let i = 2; i <= MAX_VERSIONS_PER_DELIVERABLE + 3; i++) {
      del = saveDeliverable(102, 'copy', 'copy', { ...v1Copy, title: `版本${i}` });
    }
    const hist = fullVersionHistory(del);
    assert.ok(hist.length <= MAX_VERSIONS_PER_DELIVERABLE, `历史应裁剪到上限内，实际 ${hist.length}`);
    const versions = hist.map((v) => v.version);
    assert.equal(Math.max(...versions), del.version, '当前版本应保留');
    assert.ok(!versions.includes(1), '最旧版本应被裁剪');
  });
});

describe('backfillVersionHistory 回填基线（幂等）', () => {
  test('既有行补写当前版本基线；再次调用不重复', () => {
    run('INSERT INTO deliverables (task_id, stage, kind, content, status, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      200,
      'copy',
      'copy',
      JSON.stringify(v1Copy),
      'approved',
      3,
      '2026-09-01T00:00:00.000Z',
    ]);
    const added = backfillVersionHistory();
    assert.ok(added >= 1, '应补写基线记录');
    const again = backfillVersionHistory();
    assert.equal(again, 0, '幂等：第二次不再新增');
    const row = get<{ c: number }>('SELECT COUNT(*) AS c FROM deliverable_versions WHERE deliverable_id = ? AND version = 3', [
      (get<{ id: number }>('SELECT id FROM deliverables WHERE task_id = 200')!).id,
    ]);
    assert.equal(row?.c, 1);
  });
});

describe('3.x 相邻版本差异', () => {
  test('copy：卖点增删、标题/大纲/关键词变化（含前后值）', () => {
    const from = { ...v1Copy, keywords: [...v1Copy.keywords, '快充'] };
    const to = { ...v2Copy, keywords: ['磁吸', '大容量'] };
    const diff = diffDeliverableVersions(
      { id: 1, deliverableId: 1, taskId: 101, stage: 'copy', kind: 'copy', version: 1, content: JSON.stringify(from), status: 'pending', createdAt: '' },
      { id: 2, deliverableId: 1, taskId: 101, stage: 'copy', kind: 'copy', version: 2, content: JSON.stringify(to), status: 'pending', createdAt: '' },
    );
    assert.equal(diff.hasPrevious, true);
    assert.equal(diff.fromVersion, 1);
    assert.equal(diff.toVersion, 2);
    assert.deepEqual(diff.addedPoints, ['20000mAh']);
    assert.deepEqual(diff.removedPoints, ['10000mAh']);
    assert.deepEqual(diff.keptPoints.sort(), ['30W 快充', '磁吸对位'].sort());
    assert.equal(diff.titleChanged, true);
    assert.deepEqual(diff.title, { from: from.title, to: to.title });
    assert.equal(diff.outlineChanged, true);
    assert.deepEqual(diff.outline, { from: from.outline, to: to.outline });
    assert.deepEqual(diff.keywordChanges.added, ['大容量']);
    assert.deepEqual(diff.keywordChanges.removed, ['充电宝', '快充']);
    assert.equal(diff.identical, false);
  });

  test('copy：内容完全相同 → identical=true 且差异数组全空', () => {
    const content = JSON.stringify(v1Copy);
    const diff = diffDeliverableVersions(
      { id: 1, deliverableId: 2, taskId: 101, stage: 'copy', kind: 'copy', version: 1, content, status: 'pending', createdAt: '' },
      { id: 2, deliverableId: 2, taskId: 101, stage: 'copy', kind: 'copy', version: 2, content, status: 'pending', createdAt: '' },
    );
    assert.equal(diff.identical, true);
    assert.deepEqual(diff.addedPoints, []);
    assert.deepEqual(diff.removedPoints, []);
    assert.deepEqual(diff.keywordChanges.added, []);
    assert.deepEqual(diff.keywordChanges.removed, []);
    assert.equal(diff.titleChanged, false);
    assert.equal(diff.outlineChanged, false);
  });

  test('image：按 id 集合输出新增/删除图片', () => {
    const from = [{ id: 'a', name: '主图1', url: 'data:image/png;base64,AA==', status: 'approved' }];
    const to = [
      { id: 'a', name: '主图1', url: 'data:image/png;base64,AA==', status: 'approved' },
      { id: 'b', name: '主图2', url: 'data:image/png;base64,AA==', status: 'pending' },
    ];
    const diff = diffDeliverableVersions(
      { id: 1, deliverableId: 3, taskId: 101, stage: 'main-image', kind: 'image', version: 1, content: JSON.stringify(from), status: 'pending', createdAt: '' },
      { id: 2, deliverableId: 3, taskId: 101, stage: 'main-image', kind: 'image', version: 2, content: JSON.stringify(to), status: 'pending', createdAt: '' },
    );
    assert.deepEqual(diff.addedImages, [{ id: 'b', name: '主图2' }]);
    assert.deepEqual(diff.removedImages, []);
    assert.equal(diff.identical, false);
  });

  test('无上一版可对比 → hasPrevious=false 的明确状态对象', () => {
    const diff = noPreviousDiff(1);
    assert.equal(diff.hasPrevious, false);
    assert.equal(diff.fromVersion, null);
    assert.equal(diff.toVersion, 1);
    assert.deepEqual(diff.addedPoints, []);
  });

  test('normalizePoint 折叠空白（含全角空格）', () => {
    assert.equal(normalizePoint('  30W　快充  '), '30W 快充');
    assert.equal(normalizePoint('磁吸\n对位'), '磁吸 对位');
  });
});

test('清理临时目录', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
