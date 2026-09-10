/**
 * 署名气泡 + 生图失败不存占位图 冒烟测试（Node 26 直跑，禁 vitest/tsx；临时 DB 隔离）
 * 运行：node scripts/smoke-announcer.ts
 * 验证：
 *  A. announcer 收到 STAGE_COMPLETED → 群聊出现署名 msg（from=Agent 名，body 带任务号）+ 原 evt 仍存在；
 *     SUB_TASK_COMPLETE 成功 → 署名 msg；失败 → 仅 evt「生成失败」；REVIEW_PASSED → 主管署名 msg
 *  B. 真实生图渠道失败 → 图片 status='failed' 且无 svg dataURL 入库（error 存在）；
 *     failed 视为未决策（不推进），可单独打回且不阻塞其它图决策
 *  C. mock 降级（无渠道配置）→ 保留 svg 占位图（status='pending'，url 为 data:image/svg）
 * 说明：脚本顶部先置空 LLM/生图密钥（process.loadEnvFile 默认不覆盖已存在变量），
 *       保证 CHANNEL.image 为空 → imagegen 无渠道时抛 ImageChannelUnavailableError 走 mock 降级。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

process.env.DEEPSEEK_API_KEY = '';
process.env.IMAGE_BASE_URL = '';
process.env.IMAGE_API_KEY = '';

const dir = mkdtempSync(join(tmpdir(), 'workbench-announcer-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const { ensureSchema } = await import('../src/db/ensure.ts');
const { seed } = await import('../src/db/seed.ts');
const { all } = await import('../src/db/client.ts');
const { setSetting } = await import('../src/agents/channel-settings.ts');
const { installAnnouncer } = await import('../src/agents/announcer.ts');
const { bus } = await import('../src/engine/bus.ts');
const { service } = await import('../src/engine/service.ts');
const { MockProducer, setProducer } = await import('../src/agents/producer.ts');
const { installSmartProducer } = await import('../src/agents/smart-producer.ts');
const { allImagesDecided, updateDeliverableStatus } = await import('../src/delivery/store.ts');

ensureSchema();
seed();
installAnnouncer();

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('[smoke-announcer] 署名气泡 + 生图失败不存占位图 冒烟开始');

/** 查群聊消息（kind 过滤，id 升序） */
function groupMsgs(kind: string): { from: string; to: string; body: string; task_id: number | null }[] {
  return all<{ from: string; to: string; body: string; task_id: number | null }>(
    'SELECT "from", "to", body, task_id FROM messages WHERE chat_kind = ? AND kind = ? ORDER BY id ASC',
    ['group', kind],
  );
}

// ===== A. 完成类事件 → 署名 msg 与 evt 并存 =====
await check('A1: STAGE_COMPLETED（待确认）→ 美美署名 msg + 系统 evt 并存', () => {
  bus.emitEvent({
    id: 9001,
    taskId: 777,
    type: 'STAGE_COMPLETED',
    payload: { stage: 'copy', stageLabel: '卖点文案', awaitingApproval: true },
    createdAt: new Date().toISOString(),
  });
  const evts = groupMsgs('evt');
  const evt = evts.find((m) => m.task_id === 777);
  assert.ok(evt, 'STAGE_COMPLETED 应保留原 evt 播报');
  assert.equal(evt.from, '系统');
  assert.ok(evt.body.includes('卖点文案 完成 · 待你确认'), `evt 文案异常: ${evt.body}`);
  const sig = groupMsgs('msg').find((m) => m.task_id === 777 && m.body.includes('请审阅确认'));
  assert.ok(sig, 'STAGE_COMPLETED 应额外产生署名 msg');
  assert.equal(sig.from, '美美', '署名 msg from 应为 Agent 姓名');
  assert.ok(sig.body.includes('任务 #777'), `署名 msg 应带任务号: ${sig.body}`);
  assert.ok(sig.body.includes('卖点文案已生成 1 版，请审阅确认'), `署名 msg 文案异常: ${sig.body}`);
});

await check('A2: SUB_TASK_COMPLETE 成功署名 / 失败仅 evt 不署名', () => {
  bus.emitEvent({
    id: 9002,
    taskId: 777,
    type: 'SUB_TASK_COMPLETE',
    payload: { stage: 'main-image', itemId: '主图1', ok: true },
    createdAt: new Date().toISOString(),
  });
  bus.emitEvent({
    id: 9003,
    taskId: 777,
    type: 'SUB_TASK_COMPLETE',
    payload: { stage: 'main-image', itemId: '副图2', ok: false, detail: '生图 HTTP 500' },
    createdAt: new Date().toISOString(),
  });
  const msgs = groupMsgs('msg');
  const okMsg = msgs.find((m) => m.body.includes('主图1 已生成'));
  assert.ok(okMsg, 'SUB_TASK_COMPLETE 成功应产生署名 msg');
  assert.equal(okMsg.from, '平平', '主图子任务署名应为设计师');
  const failSig = msgs.find((m) => m.body.includes('副图2 已生成'));
  assert.ok(!failSig, 'SUB_TASK_COMPLETE 失败不应产生署名 msg（不冒充完成）');
  const failEvt = groupMsgs('evt').find((m) => m.body.includes('「副图2」生成失败'));
  assert.ok(failEvt, 'SUB_TASK_COMPLETE 失败应保留 evt 播报');
});

await check('A3: REVIEW_PASSED → 波波署名 msg + evt 保留', () => {
  bus.emitEvent({
    id: 9004,
    taskId: 777,
    type: 'REVIEW_PASSED',
    payload: { stage: 'review' },
    createdAt: new Date().toISOString(),
  });
  const rev = groupMsgs('msg').find((m) => m.body.includes('主管校对通过，进入交付完成'));
  assert.ok(rev, 'REVIEW_PASSED 应产生署名 msg');
  assert.equal(rev.from, '波波', '校对通过署名应为主管');
  assert.ok(groupMsgs('evt').some((m) => m.body.includes('通过主管校对')), 'REVIEW_PASSED 原 evt 应保留');
});

// ===== C. mock 降级（无渠道）：保留 svg 占位图 =====
await check('C1: mock 降级保留 svg 占位图（status=pending）', async () => {
  setSetting('imageChannel', null); // 明确无渠道
  setProducer(new MockProducer());
  const task = service.createTask({ title: '冒烟占位品', description: 'mock', platforms: ['天猫'] });
  await service.confirmAndRun(task.id);
  await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' }); // 推进到 main-image 停
  const row = all<{ content: string }>('SELECT content FROM deliverables WHERE task_id = ? AND stage = ? AND kind = ?', [
    task.id,
    'main-image',
    'image',
  ])[0];
  assert.ok(row, 'mock 模式应落库 main-image 图片交付物');
  const images = JSON.parse(row.content) as { url: string; status: string; error?: string }[];
  assert.equal(images.length, 3, 'main-image 应为 3 张');
  for (const img of images) {
    assert.equal(img.status, 'pending', 'mock 占位图应保持 pending');
    assert.ok(img.url.startsWith('data:image/svg'), 'mock 降级应保留 svg 占位图');
  }
});

// ===== B. 真实渠道失败：status='failed' 且无 svg 占位图入库 =====
await check('B1: 真实渠道失败 → 图片 status=failed 且无 svg 占位图', async () => {
  // 指向本机不可达端口，模拟真实渠道报错（fetch 拒绝连接 → 非 ImageChannelUnavailableError）
  setSetting('imageChannel', { baseUrl: 'http://127.0.0.1:1', apiKey: 'x', model: 'gpt-image-2' });
  installSmartProducer();
  const task = service.createTask({ title: '冒烟失败品', description: 'fail', platforms: ['天猫'] });
  await service.confirmAndRun(task.id);
  await service.decideDeliverable({ taskId: task.id, kind: 'copy', decision: 'approve' }); // 推进到 main-image（生图失败）停
  const row = all<{ content: string }>('SELECT content FROM deliverables WHERE task_id = ? AND stage = ? AND kind = ?', [
    task.id,
    'main-image',
    'image',
  ])[0];
  assert.ok(row, '真实失败路径应落库 main-image 图片交付物');
  const images = JSON.parse(row.content) as { url: string; status: string; error?: string }[];
  assert.equal(images.length, 3);
  for (const img of images) {
    assert.equal(img.status, 'failed', `真实渠道失败应标记 failed: ${JSON.stringify(img)}`);
    assert.ok(!img.url.includes('data:image/svg'), `失败图不得存 svg 占位图: ${img.url}`);
    assert.ok(img.error, `失败图应写 error 原因: ${JSON.stringify(img)}`);
  }
  // 顺带验证：失败图对应 SUB_TASK_COMPLETE ok=false 的 evt 播报存在（走真实 executor 事件）
  assert.ok(
    groupMsgs('evt').some((m) => m.body.includes('「主图1」生成失败')),
    '真实失败应产生 evt「生成失败」播报',
  );
});

await check('B2: failed 视为未决策，不推进状态机；可单独打回不阻塞其它图', () => {
  // 复用 B1 的 main-image 交付物（3 张全 failed）
  const taskRows = all<{ id: number }>('SELECT id FROM tasks WHERE title = ? ORDER BY id DESC', ['冒烟失败品']);
  const taskId = taskRows[0].id;
  assert.ok(!allImagesDecided(taskId, 'main-image'), '全部 failed 时 allImagesDecided 应为 false（不推进）');

  // 打回 主图1 → rejected；其余仍 failed → 仍未全部决策
  const after = updateDeliverableStatus(taskId, 'main-image', 'image', '主图1', 'rejected');
  assert.ok(after, 'updateDeliverableStatus 应返回交付物');
  const content1 = JSON.parse(after.content) as { id: string; status: string }[];
  assert.equal(content1.find((i) => i.id === '主图1')?.status, 'rejected', '失败图可单独打回为 rejected');
  assert.ok(!allImagesDecided(taskId, 'main-image'), '仍存在 failed 图时不得视为全部决策');
  assert.equal(content1.find((i) => i.id === '副图2')?.status, 'failed', '打回失败图不应影响其它 failed 图');

  // 其余图逐个采纳后：全部 approved/rejected → 达成全部决策
  updateDeliverableStatus(taskId, 'main-image', 'image', '副图2', 'approved');
  updateDeliverableStatus(taskId, 'main-image', 'image', '副图3', 'approved');
  assert.ok(allImagesDecided(taskId, 'main-image'), 'failed 图被处理后（打回/采纳其余图）可达成全部决策');
});

// 清理临时 DB（删不掉也无妨：系统临时目录）
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(`[smoke-announcer] 全部 ${passed} 项断言通过 ✓`);
