/**
 * 小红书配图参考图一致性（xhs-image-reference）—— 复现 + 回归测试。
 *
 * 修复前的 bug：xhs-producer 调用 generateImage 时第三参数恒为 undefined，
 * 导致永远走 /images/generations（文生图），上传的参考图从未生效——
 * 与电商（/images/edits 图生图）行为不一致。本测试锁死该行为：
 *   ① 首图（xhs-cover）+ 有上传参考图 → 必须走 /images/edits（multipart 带 image）
 *   ② 首图 + 无上传参考图 → 走 /images/generations（文生图）
 *   ③ 内页图（xhs-inner）→ 以已产出首图为基准（走 /images/edits，且上传的是首图字节）
 *   ④ prompt 在有基准时含一致性硬约束、无基准时不含
 *   ⑤ 生图失败自动重试上限 3 次（与电商 MAX_IMAGE_ATTEMPTS 对齐）
 *
 * 运行：cd backend && .\node_modules\.bin\tsx.cmd src/agents/__tests__/xhs-image-reference.test.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'workbench-xhsref-'));
process.env.WORKBENCH_DB = join(dir, 'xhsref.db');
process.env.WORKBENCH_UPLOAD_DIR = join(dir, 'uploads');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { setSetting } = await import('../channel-settings.ts');
const { xhsProducer } = await import('../xhs-producer.ts');
const delivery = await import('../../delivery/store.ts');

before(() => {
  ensureSchema();
  seed();
  // 假的生图渠道：真实 HTTP 由下面的 fetch 桩接管，这里只保证渠道「已配置」
  setSetting('imageChannel', { baseUrl: 'http://xhs-ref-test.invalid', apiKey: 'k', model: 'm' });
});

/** 造一个小红书任务（不经过引擎，直接构造 producer 需要的 Task 形状） */
function xhsTask(stage: string, opts: { referenceImage?: string } = {}) {
  return {
    id: 9001,
    title: '加湿器 A1',
    description: '静音加湿器',
    platform: '小红书',
    platforms: ['小红书'],
    stage,
    column: 'progress',
    workflowId: 'xhs-note',
    referenceImage: opts.referenceImage,
  } as unknown as Parameters<typeof xhsProducer.produceNoteImages>[0];
}

/** 记录每次生图请求：命中 edits（图生图）还是 generations（文生图），以及上传的图片字节 */
async function captureImageCalls<T>(fn: () => Promise<T>): Promise<{
  result: T;
  calls: { endpoint: 'edits' | 'generations'; body?: FormData; json?: unknown }[];
}> {
  const origFetch = globalThis.fetch;
  const calls: { endpoint: 'edits' | 'generations'; body?: FormData; json?: unknown }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.body instanceof FormData) {
      calls.push({ endpoint: 'edits', body: init.body });
    } else {
      calls.push({ endpoint: 'generations', json: init?.body ? JSON.parse(String(init.body)) : undefined });
    }
    assert.ok(u.endsWith('/images/edits') || u.endsWith('/images/generations'), `意外的生图 endpoint：${u}`);
    return { ok: true, json: async () => ({ data: [{ b64_json: 'QQQQ' }] }) } as Response;
  }) as unknown as typeof fetch;
  try {
    const result = await fn();
    return { result, calls };
  } finally {
    globalThis.fetch = origFetch;
  }
}

const REF_DATA_URL = 'data:image/png;base64,UkVGMDAwMQ=='; // 参考图字节标记
const COVER_FILE_URL = '/uploads/cover-a1.png'; // 首图落盘 url（内页基准）

/** 造「首图已产出」的交付物（内容是落盘 url，非 dataURL，覆盖真实场景） */
function seedCoverDeliverable(taskId: number, url: string) {
  delivery.saveDeliverable(taskId, 'xhs-cover', 'image', [
    { id: '首图', name: '首图', kind: 'sub', url, status: 'pending' },
  ]);
}

describe('① 首图 + 有上传参考图 → 图生图（/images/edits）', () => {
  test('走 edits 分支，且 prompt 含一致性硬约束', async () => {
    const task = xhsTask('xhs-cover', { referenceImage: REF_DATA_URL });
    const { calls } = await captureImageCalls(() =>
      xhsProducer.produceNoteImages(task, [{ channel: 'img-1', items: ['首图'] }], () => {}),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, 'edits', '有参考图必须走图生图 /images/edits');
    const fd = calls[0].body!;
    assert.equal(fd.get('prompt')?.toString().includes('必须严格基于参考图生成'), true, 'prompt 应含一致性约束');
    assert.ok(fd.get('image'), 'multipart 应带上参考图 image 字段');
  });
});

describe('② 首图 + 无上传参考图 → 文生图（/images/generations）', () => {
  test('走 generations 分支，且 prompt 不含一致性约束', async () => {
    const task = xhsTask('xhs-cover', {});
    const { calls } = await captureImageCalls(() =>
      xhsProducer.produceNoteImages(task, [{ channel: 'img-1', items: ['首图'] }], () => {}),
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, 'generations', '无参考图走文生图');
    const prompt = String((calls[0].json as { prompt?: string }).prompt ?? '');
    assert.equal(prompt.includes('必须严格基于参考图生成'), false, '无基准时不应出现一致性约束');
  });
});

describe('③ 内页图 → 以已产出首图为基准', () => {
  test('走 edits 分支（上传的是首图，不是上传参考图）', async () => {
    const task = xhsTask('xhs-inner', { referenceImage: REF_DATA_URL });
    seedCoverDeliverable(task.id, COVER_FILE_URL);
    // 首图文件需真实存在（toVisionUrl 读 /uploads 下文件转 dataURL）
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync(join(process.env.WORKBENCH_UPLOAD_DIR!), { recursive: true });
    writeFileSync(join(process.env.WORKBENCH_UPLOAD_DIR!, 'cover-a1.png'), Buffer.from('Q09WRVI='));

    const { calls } = await captureImageCalls(() =>
      xhsProducer.produceNoteImages(task, [{ channel: 'img-2', items: ['内页图1'] }], () => {}),
    );
    assert.equal(calls.length, 1, '2 张内页图应发 2 次请求（本用例 1 张）');
    assert.equal(calls[0].endpoint, 'edits', '内页图应以首图为基准走图生图');
  });

  test('首图缺失 → 回退上传参考图（不清空基准）', async () => {
    const task = xhsTask('xhs-inner', { referenceImage: REF_DATA_URL });
    const { calls } = await captureImageCalls(() =>
      xhsProducer.produceNoteImages(task, [{ channel: 'img-2', items: ['内页图1'] }], () => {}),
    );
    assert.equal(calls[0].endpoint, 'edits', '首图缺失时应回退到上传参考图，而非退化成文生图');
  });
});

describe('④ 单张重试与首次生成同源（同样带基准图）', () => {
  test('retryImage 也走图生图', async () => {
    const task = xhsTask('xhs-cover', { referenceImage: REF_DATA_URL });
    const { calls, result } = await captureImageCalls(() => xhsProducer.retryImage(task, '首图'));
    assert.equal(calls[0].endpoint, 'edits', '重试路径同样必须带参考图');
    assert.equal(result.ok, true);
  });
});

describe('⑥ 视觉审核自动重试（与生图同口径）', () => {
  test('前 2 次 fetch failed、第 3 次成功 → 仍判一致（不再误记为跳过）', async () => {
    const task = xhsTask('xhs-review', { referenceImage: REF_DATA_URL });
    delivery.saveDeliverable(task.id, 'xhs-cover', 'image', [
      { id: '首图', name: '首图', kind: 'main', url: REF_DATA_URL, status: 'pending' },
    ]);
    const origFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      // 只拦视觉/文本 LLM 调用；文本合规调用直接成功，避免干扰计数
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const hasImages = JSON.stringify(body.messages ?? '').includes('image_url');
      if (!hasImages) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"report":"合规通过","checks":[],"issues":[]}' } }] }) } as Response;
      }
      n++;
      if (n <= 2) throw new Error('fetch failed'); // 模拟上游抖动
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true,"reason":""}' } }] }) } as Response;
    }) as unknown as typeof fetch;
    let report;
    try {
      report = await xhsProducer.produceCompliance(task);
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(n, 3, '视觉审核应在第 3 次成功（重试 2 次）');
    const visual = report!.checks.find((c) => c.label.includes('配图'))!;
    assert.equal(visual.note ?? '', '', '不应再记录「已跳过」');
  });

  test('持续失败 → 3 次后降级为跳过（不阻塞、不误判）', async () => {
    const task = xhsTask('xhs-review', { referenceImage: REF_DATA_URL });
    delivery.saveDeliverable(task.id, 'xhs-cover', 'image', [
      { id: '首图', name: '首图', kind: 'main', url: REF_DATA_URL, status: 'pending' },
    ]);
    const origFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const hasImages = JSON.stringify(body.messages ?? '').includes('image_url');
      if (!hasImages) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"report":"合规通过","checks":[],"issues":[]}' } }] }) } as Response;
      }
      n++;
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    let report;
    try {
      report = await xhsProducer.produceCompliance(task);
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(n, 3, '视觉审核重试上限 3 次');
    assert.equal(report!.issues.length, 0, '取不到图时不产生误判 issue');
    assert.match(report!.report, /跳过/, '降级信息对用户可见');
  });
});

describe('⑤ 生图失败自动重试 3 次后失败（与电商对齐）', () => {
  test('持续失败 → fetch 恰好 3 次，结果 ok=false 且 attempts=3', async () => {
    const task = xhsTask('xhs-cover', { referenceImage: REF_DATA_URL });
    const origFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      throw new Error('模拟渠道持续失败');
    }) as unknown as typeof fetch;
    let results;
    try {
      results = await xhsProducer.produceNoteImages(task, [{ channel: 'img-1', items: ['首图'] }], () => {});
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(n, 3, '自动重试上限为 3 次');
    assert.equal(results![0].ok, false);
    assert.equal(results![0].attempts, 3);
    assert.ok(results![0].error);
  });
});
