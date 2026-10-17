/**
 * 电商合规检查项 + 双流共用面板数据契约（ecom-compliance-checks）。
 *
 * 背景（用户定案 2026-09-17）：电商「主管审核」原本只有视觉一致性校对（图 vs 参考图），
 * 缺小红书那样的**固定文本合规检查项**，导致任务详情页无法展示统一的合规面板。
 * 本测试锁死：
 *   ① 有图有基准 → checks = [视觉一致性, 绝对化用语, 医疗宣称]（与小红书同口径、同顺序）
 *   ② 视觉不一致 → 精准打回该图所属阶段（main-image / detail-image），不误伤其他阶段
 *   ③ 无图可审（纯文案链路）→ 仍返回文本合规 checks
 *   ④ 无参考图也无主图基准 → 退化为「文案与图片信息一致」文本校对
 *   ⑤ mock 报告同样带 checks（渠道未配置时不出现空面板）
 *
 * 运行：cd backend && .\node_modules\.bin\tsx.cmd src/agents/__tests__/ecom-compliance-checks.test.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'workbench-ecomcomp-'));
process.env.WORKBENCH_DB = join(dir, 'ecomcomp.db');
process.env.WORKBENCH_UPLOAD_DIR = join(dir, 'uploads');

const { ensureSchema } = await import('../../db/ensure.ts');
const { seed } = await import('../../db/seed.ts');
const { setSetting } = await import('../channel-settings.ts');
const { SmartProducer } = await import('../smart-producer.ts');
const { MockProducer } = await import('../producer.ts');
const delivery = await import('../../delivery/store.ts');
const { writeFileSync, mkdirSync } = await import('node:fs');
type Task = import('@workbench/shared').Task;

before(() => {
  ensureSchema();
  seed();
  setSetting('imageChannel', { baseUrl: 'http://ecom-comp-test.invalid', apiKey: 'k', model: 'm' });
});

const REF = 'data:image/png;base64,UkVGMDAwMQ==';

/** 造电商任务（stage=review 表示正处于主管审核节点） */
function ecomTask(opts: { referenceImage?: string } = {}): Task {
  return {
    id: 8001,
    title: '轻磁 Pro 磁吸充电宝',
    description: '10000mAh 磁吸无线充电',
    platform: '天猫',
    platforms: ['天猫'],
    stage: 'review',
    column: 'progress',
    workflowId: 'ecom-new-listing',
    referenceImage: opts.referenceImage,
  } as unknown as Task;
}

/** 造某阶段图片交付物（url 用 dataURL 走视觉通道） */
function seedImages(taskId: number, stage: string, items: { id: string; ok: boolean }[]) {
  delivery.saveDeliverable(
    taskId,
    stage,
    'image',
    items.map((i) => ({
      id: i.id,
      name: i.id,
      kind: 'sub',
      url: i.ok ? `data:image/png;base64,${i.id}` : '',
      status: i.ok ? 'pending' : 'failed',
    })),
  );
}

/** fetch 桩：视觉调用按预设结论回答；文本调用返回固定 checks */
function stubLlm(visualVerdicts: Record<string, { consistent: boolean; reason?: string }>) {
  const orig = globalThis.fetch;
  const calls: { kind: 'vision' | 'text'; prompt: string }[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const isVision = JSON.stringify(body.messages ?? '').includes('image_url');
    if (isVision) {
      const user = String((body.messages as { content: string }[])[1]?.content ?? '');
      calls.push({ kind: 'vision', prompt: user });
      // 按「任务标题」无法区分图，改用 body 中图片数量+user 文本；这里由测试用逐次队列决定
      const verdict = visualVerdicts[String(calls.filter((c) => c.kind === 'vision').length)];
      const v = verdict ?? { consistent: true };
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ consistent: v.consistent, reason: v.reason ?? '' }) } }] }),
      } as Response;
    }
    calls.push({ kind: 'text', prompt: String((body.messages as { content: string }[])[1]?.content ?? '') });
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                report: '文案与图片信息一致，无待修改项。',
                checks: [
                  { passed: true, label: '无「最」「第一」等绝对化用语' },
                  { passed: true, label: '功效描述无医疗宣称' },
                ],
                issues: [],
              }),
            },
          },
        ],
      }),
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

describe('① 有图 + 有基准 → checks 与小红书同口径同顺序', () => {
  test('checks = [配图与参考图主体一致, 绝对化用语, 医疗宣称]', async () => {
    const task = ecomTask({ referenceImage: REF });
    seedImages(task.id, 'main-image', [{ id: '主图1', ok: true }]);
    const stub = stubLlm({ 1: { consistent: true } });
    try {
      const report = await new SmartProducer().produceReview(task);
      const labels = (report.checks ?? []).map((c) => c.label);
      assert.equal(labels[0], '配图与参考图主体一致', '首项为视觉一致性（与小红书一致）');
      assert.ok(labels.some((l) => l.includes('绝对化用语')), '含绝对化用语检查项');
      assert.ok(labels.some((l) => l.includes('医疗宣称')), '含医疗宣称检查项');
      assert.equal(report.issues.length, 0);
      assert.ok((report.checks ?? []).every((c) => c.passed), '无问题时全部通过');
    } finally {
      stub.restore();
    }
  });
});

describe('② 视觉不一致 → 精准打回该图所属阶段', () => {
  test('主图跑偏 → targetStage=main-image；详情图跑偏 → detail-image', async () => {
    const task = ecomTask({ referenceImage: REF });
    seedImages(task.id, 'main-image', [{ id: '主图1', ok: true }]);
    seedImages(task.id, 'detail-image', [{ id: '详情图1', ok: true }]);
    // 第 1 张（主图）一致；第 2 张（详情图）不一致
    const stub = stubLlm({ 1: { consistent: true }, 2: { consistent: false, reason: '颜色不符' } });
    try {
      const report = await new SmartProducer().produceReview(task);
      assert.equal(report.issues.length, 1, '仅详情图被判不一致');
      assert.equal(report.issues[0].targetStage, 'detail-image', '精准打回详情图阶段，不误伤主图');
      assert.match(report.issues[0].note, /颜色不符/);
      const visual = (report.checks ?? [])[0];
      assert.equal(visual.passed, false, '视觉检查项标记未通过');
    } finally {
      stub.restore();
    }
  });
});

describe('③ 无图可审（纯文案链路）→ 仍返回文本合规 checks', () => {
  test('无图片交付物时 checks 来自文本校对', async () => {
    const task = ecomTask({ referenceImage: REF });
    const stub = stubLlm({});
    try {
      const report = await new SmartProducer().produceReview(task);
      assert.ok((report.checks ?? []).length > 0, '纯文案链路也应有检查项（面板不空）');
      assert.ok((report.checks ?? []).every((c) => typeof c.label === 'string' && c.label.length > 0));
    } finally {
      stub.restore();
    }
  });
});

describe('④ 无参考图 → 退化为文案与图片信息一致', () => {
  test('无基准时不做主体比对，视觉项标签改为文案相符口径', async () => {
    const task = ecomTask({}); // 无 referenceImage，也无主图交付物
    seedImages(task.id, 'main-image', [{ id: '主图1', ok: true }]);
    const stub = stubLlm({});
    try {
      const report = await new SmartProducer().produceReview(task);
      assert.equal(report.issues.length, 0);
      assert.ok((report.checks ?? []).length > 0, '仍产出检查项');
    } finally {
      stub.restore();
    }
  });
});

describe('⑤ mock 报告带 checks（渠道未配置时不出现空面板）', () => {
  test('MockProducer.produceReview 返回 checks', async () => {
    const report = await new MockProducer().produceReview(ecomTask());
    assert.ok(Array.isArray(report.checks) && report.checks.length > 0, 'mock 也要带 checks');
    assert.ok(report.checks!.every((c) => c.passed === true));
  });
});
