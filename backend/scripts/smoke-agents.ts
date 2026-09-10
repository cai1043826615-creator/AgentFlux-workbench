/**
 * 冒烟脚本：组3 任务 3.1-3.6（Agent 工位运行时 / 执行日志 / 执行统计）。
 * 用法：在 backend 目录运行 `node scripts/smoke-agents.ts`（Node 26 直跑 TS；临时 DB，跑完即退）。
 * 覆盖：seed 工位行、toAgent 转换、markBusy/markIdle/markOnline、logExecution 写入、
 *       executionStats 计算、service.advance 全流程 6 阶段日志（mock 标注）与状态机走通。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 临时目录 DB：必须在 import db/client 之前设置 WORKBENCH_DB
const dir = mkdtempSync(join(tmpdir(), 'smoke-agents-'));
process.env.WORKBENCH_DB = join(dir, 'smoke.db');

const { ensureSchema } = await import('../src/db/ensure.ts');
const { seed } = await import('../src/db/seed.ts');
const { all, get, run } = await import('../src/db/client.ts');
const { markBusy, markIdle, markOnline, toAgent } = await import('../src/agents/runtime.ts');
const { logExecution } = await import('../src/agents/execution-logger.ts');
const { executionStats } = await import('../src/routes/agents.ts');

ensureSchema();
seed();

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('[smoke-agents] 组3 · Agent 运行时 / 执行日志 / 执行统计 冒烟开始');

// 1. seed 后工位齐全
await check('seed 后 3 个工位且 id 顺序正确', () => {
  const rows = all('SELECT id, name, role, model, online_status FROM agents ORDER BY id') as { id: string; name: string; role: string; model: string; online_status: string }[];
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.id), ['agent-copy', 'agent-design', 'agent-supervisor']);
  assert.deepEqual(rows.map((r) => r.name), ['美美', '平平', '波波']);
});

// 2. toAgent 行转换（snake_case → camelCase + skills/files JSON.parse）
await check('toAgent 转换正确', () => {
  const row = get('SELECT * FROM agents WHERE id = ?', ['agent-copy'])!;
  const agent = toAgent(row);
  assert.equal(agent.name, '美美');
  assert.equal(agent.role, '文案');
  assert.equal(agent.onlineStatus, 'idle');
  assert.deepEqual(agent.skills, ['电商文案模板', 'SEO 关键词']);
  assert.deepEqual(agent.files, ['品牌手册.pdf']);
  assert.equal(agent.model, 'deepseek-chat');
  assert.ok(agent.createdAt);
});

// 3. 工位在线状态流转
await check('markBusy 置忙并更新活动/最近活跃', () => {
  markBusy('agent-copy', '卖点文案');
  const row = get('SELECT online_status, activity, last_active_at FROM agents WHERE id = ?', ['agent-copy'])!;
  assert.equal(row.online_status, 'busy');
  assert.equal(row.activity, '卖点文案');
  assert.ok(row.last_active_at);
});

await check('markIdle 复位待命', () => {
  markIdle('agent-copy');
  const row = get('SELECT online_status, activity FROM agents WHERE id = ?', ['agent-copy'])!;
  assert.equal(row.online_status, 'idle');
  assert.equal(row.activity, '待命');
});

await check('markOnline 签到上线', () => {
  markOnline('agent-copy');
  const row = get('SELECT online_status FROM agents WHERE id = ?', ['agent-copy'])!;
  assert.equal(row.online_status, 'online');
  markIdle('agent-copy'); // 复位，避免影响后续
});

// 4. logExecution 写入（taskId=999 预置记录，避免与后续 createTask 的 id=1 冲突）
await check('logExecution 写入成功记录并返回完整行', () => {
  const rec = logExecution({
    agentId: 'agent-copy',
    taskId: 999,
    stage: 'copy',
    model: 'deepseek-chat',
    status: 'success',
    inputSummary: '便携榨汁杯 Pro',
    outputSummary: '文案标题：便携榨汁杯 Pro · 旗舰升级款',
    durationMs: 320,
  });
  assert.equal(rec.agentId, 'agent-copy');
  assert.equal(rec.taskId, 999);
  assert.equal(rec.stage, 'copy');
  assert.equal(rec.status, 'success');
  assert.equal(rec.durationMs, 320);
  assert.ok(rec.createdAt);
});

// 5. stats：再插 2 成 1 败（合计 4 条：3 成 1 败）
await check('executionStats 统计正确（4 条 3 成 1 败）', () => {
  logExecution({ agentId: 'agent-copy', taskId: 999, stage: 'copy', model: 'deepseek-chat', status: 'success', inputSummary: 't', outputSummary: 'ok', durationMs: 100 });
  logExecution({ agentId: 'agent-copy', taskId: 999, stage: 'review', model: 'deepseek-chat', status: 'success', inputSummary: 't', outputSummary: 'ok', durationMs: 300 });
  logExecution({ agentId: 'agent-copy', taskId: 999, stage: 'deliver', model: 'deepseek-chat', status: 'failed', inputSummary: 't', outputSummary: '', error: 'boom', durationMs: 50 });

  const stats = executionStats('agent-copy');
  assert.equal(stats.runs, 4);
  assert.equal(stats.successCount, 3);
  assert.equal(stats.successRate, 75); // 3/4
  assert.equal(stats.avgDurationMs, Math.round((320 + 100 + 300 + 50) / 4)); // 770/4 = 192.5 → 193
  assert.deepEqual(stats.byStage.map((s) => s.stage).sort(), ['copy', 'deliver', 'review']);

  const copy = stats.byStage.find((s) => s.stage === 'copy')!;
  assert.equal(copy.runs, 2);
  assert.equal(copy.successRate, 100);
  assert.equal(copy.avgDurationMs, 210); // (320+100)/2
});

// 6. 无记录工位：0 / 100 / 0
await check('无记录工位统计为 0/100/0', () => {
  const stats = executionStats('agent-design');
  assert.equal(stats.runs, 0);
  assert.equal(stats.successCount, 0);
  assert.equal(stats.successRate, 100);
  assert.equal(stats.avgDurationMs, 0);
  assert.deepEqual(stats.byStage, []);
});

// 7. failed 记录 error 落库
await check('failed 记录 error 落库', () => {
  const rows = all("SELECT status, error FROM agent_executions WHERE status = 'failed'") as { status: string; error: string | null }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, 'boom');
});

// 8. service.advance 全流程（mock producer）：6 阶段日志齐全 + (mock) 标注 + 状态机走通
await check('advance 全流程 6 阶段日志齐全（mock 标注）', async () => {
  const { MockProducer, setProducer } = await import('../src/agents/producer.ts');
  setProducer(new MockProducer());
  const { service } = await import('../src/engine/service.ts');

  const created = service.createTask({ title: '冒烟测试品', description: '冒烟', platform: '测试平台' });
  const after = await service.confirmAndRun(created.id);
  assert.equal(after.column, 'awaiting'); // graph 模式：copy 确认点停

  await service.decideDeliverable({ taskId: created.id, kind: 'copy', decision: 'approve' });
  const main = await service.decideDeliverable({ taskId: created.id, kind: 'image', decision: 'approve' });
  assert.equal(main.column, 'awaiting'); // graph 模式：detail-image 确认点停（意见7）
  assert.equal(main.stage, 'detail-image');
  const final = await service.decideDeliverable({ taskId: created.id, kind: 'image', decision: 'approve' });
  assert.equal(final.column, 'done'); // 全链走通（detail 确认通过后直达交付完成）

  const rows = all(
    'SELECT stage, status, output_summary, agent_id FROM agent_executions WHERE task_id = ? ORDER BY id ASC',
    [created.id],
  ) as { stage: string | null; status: string; output_summary: string; agent_id: string }[];
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.map((r) => r.stage), ['requirement', 'copy', 'main-image', 'detail-image', 'review', 'deliver']);
  for (const r of rows) {
    assert.equal(r.status, 'success');
    assert.ok(r.output_summary.includes('(mock)'), `${r.stage} 应标注 (mock)`);
  }
  assert.equal(rows.find((r) => r.stage === 'main-image')!.output_summary, '生成 3 张图片 (mock)');
  assert.equal(rows.find((r) => r.stage === 'detail-image')!.output_summary, '生成 4 张图片 (mock)');
  assert.equal(rows.find((r) => r.stage === 'review')!.output_summary, '校对结论：无问题，准予放行 (mock)');
  assert.equal(rows.find((r) => r.stage === 'deliver')!.output_summary, '交付完成：冒烟测试品_上架资料包 (mock)');

  // 工位在阶段结束后回到待命
  const copyAgent = get('SELECT online_status, activity FROM agents WHERE id = ?', ['agent-copy'])!;
  assert.equal(copyAgent.online_status, 'idle');
  assert.equal(copyAgent.activity, '待命');
});

// 9. 意见7：详情图设计成为确认点（图定义断言）
await check('detail-image 为确认点：approvalPoint + approved/rejected 边 + 常量为确认点', async () => {
  const { ECOM_WORKFLOW, APPROVAL_POINT_STAGES, STAGE_DETAIL_IMAGE, STAGE_REVIEW } = await import('@workbench/shared');
  const node = ECOM_WORKFLOW.nodes.find((n) => n.id === STAGE_DETAIL_IMAGE)!;
  assert.equal(node.approvalPoint, true);
  assert.equal(node.autoNext, undefined, 'detail-image 应移除 autoNext');
  const approved = ECOM_WORKFLOW.edges.find((e) => e.from === STAGE_DETAIL_IMAGE && e.condition === 'approved')!;
  assert.equal(approved.to, STAGE_REVIEW, 'detail approved 边应指向 review');
  const rejected = ECOM_WORKFLOW.edges.find((e) => e.from === STAGE_DETAIL_IMAGE && e.condition === 'rejected')!;
  assert.equal(rejected.to, STAGE_DETAIL_IMAGE, 'detail rejected 边应回自身返工');
  assert.ok(APPROVAL_POINT_STAGES.includes(STAGE_DETAIL_IMAGE), 'APPROVAL_POINT_STAGES 应含 detail-image');
});

// 10. linear 降级模式：detail-image 确认自动通过直达交付完成
await check('linear 模式：detail-image 确认自动通过直达交付完成', async () => {
  run("UPDATE settings SET value = ? WHERE key = 'orchestrationMode'", [JSON.stringify({ mode: 'linear' })]);
  try {
    const { service } = await import('../src/engine/service.ts');
    const created = service.createTask({ title: '线性冒烟品', description: 'linear', platform: '测试平台' });
    const final = await service.confirmAndRun(created.id);
    assert.equal(final.column, 'done', 'linear 下三个确认点（copy/main-image/detail-image）均自动通过');
    assert.equal(final.stage, 'deliver');
  } finally {
    run("UPDATE settings SET value = ? WHERE key = 'orchestrationMode'", [JSON.stringify({ mode: 'graph' })]);
  }
});

// 清理临时 DB（删不掉也无妨：系统临时目录）
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(`[smoke-agents] 全部 ${passed} 项断言通过 ✓`);
