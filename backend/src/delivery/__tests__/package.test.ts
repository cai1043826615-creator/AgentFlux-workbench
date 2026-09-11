/**
 * 交付包 ZIP 打包（delivery-ops B4，组 4 模块级回归）：
 * - CRC32 已知向量校验；ZIP 结构可解（本地头 + deflate 还原）
 * - 文案.md/文案.json、已采纳图片、manifest.json；rejected/failed 不入包
 * - 外链图片取回失败 → 同名 .txt 降级 + missing 计数（不整体失败）
 */
import { inflateRawSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import type { Deliverable, Task } from '@workbench/shared';

const dir = mkdtempSync(join(tmpdir(), 'workbench-package-'));
process.env.WORKBENCH_DB = join(dir, 'pkg.db');

const { buildZip, crc32, buildTaskPackage, hasAnySettledDeliverable } = await import('../package.ts');

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1PX}`;

const task = { id: 1, title: '磁吸充电宝上架', platform: '天猫', platforms: ['天猫'] } as Task;

const copyDel: Deliverable = {
  id: 1,
  taskId: 1,
  stage: 'deliver',
  kind: 'copy',
  content: JSON.stringify({ title: '30W磁吸充电宝', points: ['30W 快充', '磁吸对位'], outline: '卖点→参数', keywords: ['充电宝'] }),
  status: 'approved',
  version: 1,
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function imgDel(urls: string[]): Deliverable {
  return {
    id: 2,
    taskId: 1,
    stage: 'main-image',
    kind: 'image',
    content: JSON.stringify(urls.map((url, i) => ({ id: `img${i}`, name: `主图${i + 1}`, url, status: url === 'rejected' ? 'rejected' : 'approved' }))),
    status: 'pending',
    version: 2,
    updatedAt: '2026-09-01T00:00:00.000Z',
  };
}

/** 从 zip 中按条目名读取并解压数据 */
function readZipEntry(zip: Buffer, name: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) break;
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const compSize = zip.readUInt32LE(offset + 18);
    const method = zip.readUInt16LE(offset + 8);
    const entryName = zip.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const dataStart = offset + 30 + nameLen + extraLen;
    const compData = zip.subarray(dataStart, dataStart + compSize);
    if (entryName === name) return method === 8 ? inflateRawSync(compData) : Buffer.from(compData);
    offset = dataStart + compSize;
  }
  return null;
}

describe('4.x CRC32 与 ZIP 结构', () => {
  test('CRC32 已知向量：crc32("123456789") === 0xCBF43926', () => {
    assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
  });

  test('buildZip 产出的 zip 可解：本地头 + deflate 还原原文', () => {
    const hello = Buffer.from('你好 world', 'utf8');
    const zip = buildZip([
      { name: 'a.txt', data: hello },
      { name: 'dir/b.bin', data: Buffer.from([0, 1, 2, 3, 255]) },
    ]);
    assert.equal(zip.readUInt32LE(0), 0x04034b50, '应以本地文件头开始');
    assert.ok(zip.subarray(zip.length - 22, zip.length - 18).readUInt32LE(0) === 0x06054b50, '应以 EOCD 结束');
    assert.deepEqual(readZipEntry(zip, 'a.txt'), hello, '中文条目应可解回原文');
    assert.deepEqual(readZipEntry(zip, 'dir/b.bin'), Buffer.from([0, 1, 2, 3, 255]));
  });
});

describe('4.x 交付包组装', () => {
  test('文案 + 已采纳图片 + manifest；rejected 不入包', async () => {
    const del = imgDel([PNG_DATA_URL, 'rejected']);
    const { zip, manifest, missingCount } = await buildTaskPackage(task, [copyDel, del]);
    assert.equal(missingCount, 0);
    assert.equal(manifest.copyFile, '文案/30W磁吸充电宝.md');
    assert.equal(manifest.imageCount, 1, '仅已采纳图片入包');
    assert.equal(manifest.excluded.rejected, 1);

    const md = readZipEntry(zip, '文案/30W磁吸充电宝.md')?.toString('utf8') ?? '';
    assert.ok(md.includes('30W 快充'));
    assert.ok(md.includes('卖点→参数'));
    assert.ok(readZipEntry(zip, '文案/30W磁吸充电宝.json'), '应附 JSON 源文件');
    assert.ok(readZipEntry(zip, manifest.images[0].file), '图片原图字节应在包内');
    assert.equal(readZipEntry(zip, 'manifest.json')?.toString('utf8'), JSON.stringify(manifest, null, 2));
  });

  test('外链图片取回失败 → 同名 .txt 降级 + missing 计数（不整体失败）', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://example.com/')) throw new Error('connect refused (stub)');
      return origFetch(url);
    };
    try {
      const del = imgDel([PNG_DATA_URL, 'https://example.com/never.png']);
      const { zip, manifest, missingCount } = await buildTaskPackage(task, [del]);
      assert.equal(missingCount, 1);
      assert.equal(manifest.missing, 1);
      assert.equal(manifest.imageCount, 1, '取回成功的图仍入包');
      const failed = manifest.images.find((i) => i.name === '主图2');
      assert.ok(failed?.file.endsWith('.txt'), '失败图应降级为 .txt 说明');
      const txt = readZipEntry(zip, failed!.file)?.toString('utf8') ?? '';
      assert.ok(txt.includes('图片获取失败'), '.txt 应含失败说明');
      assert.equal(readZipEntry(zip, 'manifest.json')?.toString('utf8'), JSON.stringify(manifest, null, 2));
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('无文案交付物（仅有图片）→ copyFile=null，zip 仍含图片与清单', async () => {
    const del = imgDel([PNG_DATA_URL]);
    const { zip, manifest } = await buildTaskPackage(task, [del]);
    assert.equal(manifest.copyFile, null);
    assert.ok(readZipEntry(zip, 'manifest.json'), '仍应生成清单');
    assert.equal(readZipEntry(zip, manifest.images[0].file) != null, true);
  });

  test('hasAnySettledDeliverable 判定', () => {
    assert.equal(hasAnySettledDeliverable([]), false);
    assert.equal(hasAnySettledDeliverable([copyDel]), true);
    const onlyPending = imgDel(['rejected']);
    assert.equal(hasAnySettledDeliverable([onlyPending]), false, '仅被拒图片不算已定案');
  });

  test('4.8 已定案判定：pending/rejected 文案不算已定案（409 前提）', () => {
    const pendingCopy = { ...copyDel, status: 'pending' as const };
    const rejectedCopy = { ...copyDel, status: 'rejected' as const };
    assert.equal(hasAnySettledDeliverable([pendingCopy]), false, '待拍板文案不算已定案 → 应 409');
    assert.equal(hasAnySettledDeliverable([rejectedCopy]), false, '已打回文案不算已定案 → 应 409');
    assert.equal(hasAnySettledDeliverable([copyDel]), true, '已采纳文案算已定案');
  });
});

after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
