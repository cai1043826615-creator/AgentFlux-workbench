/**
 * B11 · 生图重试上限与 failed 不计入待决策（image-retry-policy）—— 服务层/存储层集成测试。
 * 运行：node backend/src/engine/__tests__/image-retry.test.ts（或 pnpm --filter @workbench/backend exec tsx src/engine/__tests__/image-retry.test.ts）
 *
 * 覆盖 OpenSpec 任务：4.1 4.2 4.3 4.4 4.5 4.6 4.7 4.8 4.9
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'workbench-imgretry-'));
process.env.WORKBENCH_DB = join(dir, 'retry.db');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { run } = await import('../../db/client.ts');
const { setSetting } = await import('../../agents/channel-settings.ts');
const { SmartProducer, MAX_IMAGE_ATTEMPTS } = await import('../../agents/smart-producer.ts');
const { setProducer, MockProducer } = await import('../../agents/producer.ts');
const { service, RetryLimitError, RetryNotAllowedError } = await import('../service.ts');
const { getDeliverable, allImagesDecided } = await import('../../delivery/store.ts');

before(() => {
  ensureSchema();
  seed();
});

/** 走完文案确认点，把任务推进到 main-image 待确认，并取该阶段 image 交付物 */
async function toMainImageAwaiting(title: string) {
  const t = service.createTask({ title, description: '', platforms: ['天猫'] });
  const task = await service.confirmAndRun(t.id);
  assert.equal(task.stage, 'copy');
  const approved = await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' });
  assert.equal(approved.stage, 'main-image');
  assert.equal(approved.column, 'awaiting');
  const del = getDeliverable(approved.id, 'main-image', 'image')!;
  return { task: approved, del };
}

/** 直接改写某阶段图片交付物内容（造 failed/pending 等状态，绕过生图） */
function setImages(taskId: number, stage: string, images: { id: string; status: string; attempts?: number }[]) {
  run('UPDATE deliverables SET content = ? WHERE task_id = ? AND stage = ? AND kind = ?', [
    JSON.stringify(
      images.map((i) => ({
        id: i.id,
        name: i.id,
        kind: 'sub',
        url: i.status === 'failed' ? '' : `data:image/png;base64,${i.id}`,
        status: i.status,
        attempts: i.attempts,
      })),
    ),
    taskId,
    stage,
    'image',
  ]);
}

describe('4.1 自动重试上限常量与恰好 3 次', () => {
  test('MAX_IMAGE_ATTEMPTS 上限为 3', () => {
    assert.equal(MAX_IMAGE_ATTEMPTS, 3);
  });

  test('注入「必失败」生图桩后自动尝试次数恰为 3（fetch 计数）', async () => {
    setSetting('imageChannel', { baseUrl: 'http://retry-test.invalid', apiKey: 'k', model: 'm' });
    const t = service.createTask({ title: '重试上限', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    const sp = new SmartProducer();
    const origFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      throw new Error('模拟生图渠道持续失败');
    }) as typeof fetch;
    let results;
    try {
      results = await sp.produceImages(task, [{ channel: 'main', items: ['主图1'] }], () => {});
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(fetchCalls, 3, '自动重试恰好 3 次');
    assert.equal(results[0].ok, false);
    assert.equal(results[0].attempts, 3);
    assert.ok(results[0].error);
  });
});

describe('4.2 记录累计尝试次数（服务层落库）', () => {
  test('3 次均失败 → 落 status=failed、attempts=3、error 非空', async () => {
    setSetting('imageChannel', { baseUrl: 'http://retry-test.invalid', apiKey: 'k', model: 'm' });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('模拟渠道失败');
    }) as typeof fetch;
    setProducer(new SmartProducer());
    try {
      const t = service.createTask({ title: '落库失败', description: '', platforms: [] });
      let task = await service.confirmAndRun(t.id);
      task = await service.decideDeliverable({ taskId: t.id, kind: 'copy', decision: 'approve' });
      assert.equal(task.stage, 'main-image');
      assert.equal(task.column, 'awaiting');
      const del = getDeliverable(t.id, 'main-image', 'image')!;
      const images = JSON.parse(del.content) as { id: string; status: string; attempts?: number; error?: string }[];
      assert.equal(images[0].status, 'failed');
      assert.equal(images[0].attempts, 3, '失败路径 attempts 记满上限');
      assert.ok(images[0].error, '保留失败原因文本');
    } finally {
      globalThis.fetch = origFetch;
      setProducer(new MockProducer());
    }
  });

  test('成功路径 attempts 为实际尝试次数（首次成功=1）', async () => {
    setSetting('imageChannel', { baseUrl: 'http://retry-test.invalid', apiKey: 'k', model: 'm' });
    const t = service.createTask({ title: '成功尝试', description: '', platforms: [] });
    const task = await service.confirmAndRun(t.id);
    const sp = new SmartProducer();
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return { ok: true, json: async () => ({ data: [{ b64_json: 'AAAA' }] }) } as Response;
    }) as typeof fetch;
    let results;
    try {
      results = await sp.produceImages(task, [{ channel: 'main', items: ['主图B'] }], () => {});
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(results[0].ok, true);
    assert.equal(results[0].attempts, 1);
    assert.ok((results[0].dataUrl ?? '').startsWith('data:image/png;base64,'));
  });
});

describe('4.3 allImagesDecided 只认 approved/rejected/skipped（failed 不参与）', () => {
  test('四组批次判定', async () => {
    const { task, del } = await toMainImageAwaiting('判定批次');
    const taskId = task.id;
    const stage = 'main-image';
    assert.ok(del);

    setImages(taskId, stage, [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'approved' },
      { id: '图3', status: 'failed' },
    ]);
    assert.equal(allImagesDecided(taskId, stage), true, '[approved, approved, failed] 应为已全部决策');

    setImages(taskId, stage, [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'failed' },
    ]);
    assert.equal(allImagesDecided(taskId, stage), true, '[approved, failed] 应为已全部决策');

    setImages(taskId, stage, [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'rejected' },
    ]);
    assert.equal(allImagesDecided(taskId, stage), true, '[approved, rejected] 应为已全部决策');

    setImages(taskId, stage, [
      { id: '图1', status: 'pending' },
      { id: '图2', status: 'failed' },
    ]);
    assert.equal(allImagesDecided(taskId, stage), false, '[pending, failed] 仍等待（pending 未决策）');
  });
});

describe('4.4 跳过操作（decision=skip）', () => {
  test('只标记目标图跳过、不产生 REJECTED、随后全部已决策并推进', async () => {
    const { task } = await toMainImageAwaiting('跳过测试');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'failed' },
    ]);
    const after = await service.decideDeliverable({ taskId, kind: 'image', imageId: '图2', decision: 'skip' });
    const del = getDeliverable(taskId, 'main-image', 'image')!;
    const images = JSON.parse(del.content) as { id: string; status: string }[];
    assert.equal(images.find((i) => i.id === '图2')!.status, 'skipped', '目标图标记为跳过');
    assert.equal(images.find((i) => i.id === '图1')!.status, 'approved', '同批其他图状态不变');
    const events = service.listEvents(taskId);
    assert.equal(events.some((e) => e.type === 'REJECTED'), false, '无 REJECTED 事件');
    assert.equal(allImagesDecided(taskId, 'main-image'), true, '跳过后全部已决策');
    assert.equal(after.stage, 'detail-image', '全部决策（无 rejected）→ 推进到详情图');
    assert.equal(after.column, 'awaiting');
  });
});

describe('4.5 拍板点推进（部分失败）', () => {
  test('[approved, approved, failed] 不因 failed 阻塞，推进事件记录失败图片数', async () => {
    const { task } = await toMainImageAwaiting('部分失败');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'approved' },
      { id: '图3', status: 'failed', attempts: 3 },
    ]);
    const after = await service.decideDeliverable({ taskId, kind: 'image', imageId: '图3', decision: 'approve' });
    assert.equal(after.stage, 'detail-image', '失败不阻塞推进：主图确认后进入详情图确认点');
    const approvedEvt = service.listEvents(taskId).find((e) => e.type === 'APPROVED' && e.payload.stage === 'main-image');
    assert.ok(approvedEvt, '存在 main-image 的 APPROVED 事件');
    assert.equal(approvedEvt!.payload.failedCount, 1, '推进事件 payload 记录失败图片数');
  });
});

describe('4.6 拍板点推进（全部失败）', () => {
  test('[failed, failed, failed] 仍可推进，APPROVED payload 含「全部图片生成失败」警示', async () => {
    const { task } = await toMainImageAwaiting('全部失败');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'failed', attempts: 3 },
      { id: '图2', status: 'failed', attempts: 3 },
      { id: '图3', status: 'failed', attempts: 3 },
    ]);
    const after = await service.decideDeliverable({ taskId, kind: 'image', imageId: '图1', decision: 'approve' });
    assert.equal(after.stage, 'detail-image', '全部失败也不停留待确认');
    const approvedEvt = service.listEvents(taskId).find((e) => e.type === 'APPROVED' && e.payload.stage === 'main-image');
    assert.ok(approvedEvt);
    assert.equal(approvedEvt!.payload.failedCount, 3);
    assert.match(String(approvedEvt!.payload.note ?? ''), /全部图片生成失败/);
  });
});

describe('4.7 打回优先级回归', () => {
  test('[failed, rejected] 仍触发 REJECTED 返工，failed 不掩盖 rejected', async () => {
    const { task } = await toMainImageAwaiting('打回优先');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'failed', attempts: 3 },
      { id: '图2', status: 'rejected' },
    ]);
    // decideDeliverable 会同步完成返工重产出：打回后重新生成并回到 main-image 确认点（awaiting）
    const after = await service.decideDeliverable({ taskId, kind: 'image', imageId: '图2', decision: 'reject', note: '主图与产品不符' });
    const events = service.listEvents(taskId);
    assert.equal(events.some((e) => e.type === 'REJECTED'), true, '触发 REJECTED');
    assert.equal(after.stage, 'main-image', '返工重产出回到主图确认点');
    assert.equal(service.rework(taskId).count, 1, '返工次数统计包含该次');
  });
});

describe('4.8 单张重试接口', () => {
  test('只重新生成目标图：其余图 url/status 完全不变，成功后目标图 pending 且 attempts 递增', async () => {
    const { task } = await toMainImageAwaiting('单张重试');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'failed', attempts: 2 },
    ]);
    class RetryOkProducer extends MockProducer {
      async retryImage() {
        return { ok: true, dataUrl: 'data:image/png;base64,retry-ok' };
      }
    }
    setProducer(new RetryOkProducer());
    const before = getDeliverable(taskId, 'main-image', 'image')!;
    const beforeImages = JSON.parse(before.content) as { id: string; status: string; url: string }[];
    const { image } = await service.retryImage(taskId, '图2');
    assert.equal(image.status, 'pending');
    assert.equal(image.url, 'data:image/png;base64,retry-ok');
    assert.equal(image.attempts, 3, 'attempts 递增');
    const after = getDeliverable(taskId, 'main-image', 'image')!;
    const afterImages = JSON.parse(after.content) as { id: string; status: string; url: string }[];
    const img1After = afterImages.find((i) => i.id === '图1')!;
    const img1Before = beforeImages.find((i) => i.id === '图1')!;
    assert.equal(img1After.status, img1Before.status, '其余图片状态不变');
    assert.equal(img1After.url, img1Before.url, '其余图片 url 不变');
  });

  test('重试仍失败：该图保持 failed、error 更新、attempts 递增、其他图不受影响', async () => {
    const { task } = await toMainImageAwaiting('重试失败');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'approved' },
      { id: '图2', status: 'failed', attempts: 1 },
    ]);
    class RetryFailProducer extends MockProducer {
      async retryImage() {
        return { ok: false, error: '生图渠道超时' };
      }
    }
    setProducer(new RetryFailProducer());
    const { image } = await service.retryImage(taskId, '图2');
    assert.equal(image.status, 'failed');
    assert.equal(image.error, '生图渠道超时');
    assert.equal(image.attempts, 2);
    const after = getDeliverable(taskId, 'main-image', 'image')!;
    const imgs = JSON.parse(after.content) as { id: string; status: string }[];
    assert.equal(imgs.find((i) => i.id === '图1')!.status, 'approved');
  });

  test('非失败图不可重试：直接调用按校验拒绝', async () => {
    const { task } = await toMainImageAwaiting('非失败图');
    const taskId = task.id;
    setImages(taskId, 'main-image', [
      { id: '图1', status: 'pending' },
      { id: '图2', status: 'approved' },
    ]);
    await assert.rejects(() => service.retryImage(taskId, '图1'), RetryNotAllowedError);
    await assert.rejects(() => service.retryImage(taskId, '图2'), RetryNotAllowedError);
    await assert.rejects(() => service.retryImage(taskId, '不存在的图'), RetryNotAllowedError);
  });
});

describe('4.9 重试上限拦截', () => {
  test('已用尽 3 次尝试再次重试 → RetryLimitError、生图桩不被调用、状态仍 failed', async () => {
    const { task } = await toMainImageAwaiting('上限拦截');
    const taskId = task.id;
    setImages(taskId, 'main-image', [{ id: '图X', status: 'failed', attempts: 3 }]);
    let retryCalled = false;
    class RetryCountProducer extends MockProducer {
      async retryImage() {
        retryCalled = true;
        return { ok: true, dataUrl: 'data:image/png;base64,x' };
      }
    }
    setProducer(new RetryCountProducer());
    await assert.rejects(() => service.retryImage(taskId, '图X'), RetryLimitError);
    assert.equal(retryCalled, false, '生图桩不被调用（不发出第 4 次请求）');
    const del = getDeliverable(taskId, 'main-image', 'image')!;
    const imgs = JSON.parse(del.content) as { id: string; status: string; attempts?: number }[];
    assert.equal(imgs[0].status, 'failed');
    assert.equal(imgs[0].attempts, 3);
  });
});
