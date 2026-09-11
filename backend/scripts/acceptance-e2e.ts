/**
 * acceptance-e2e.ts —— 干净环境真实端到端验收（openspec real-ops-enhancement 任务 2.3）
 *
 * 前置：后端已启动（127.0.0.1:4311）、数据库已由 reset-demo.ts 清空。
 * 流程：新建任务(参考图) → 确认开工 → 文案拍板采纳 → 主图逐张采纳 → 详情图逐张采纳 → 校对自动放行 → 交付归档
 * 说明：approve/reject 决策接口同步等待 advance 完成（生图阶段数分钟），响应返回即已进入下一拍板点或 done。
 *
 * 用法：node scripts/acceptance-e2e.ts
 */
const BASE = 'http://127.0.0.1:4311';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function j<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  // 仅在有 body 时声明 JSON 类型，避免无 body 的 POST 触发 FST_ERR_CTP_EMPTY_JSON_BODY
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json() as Promise<T>;
}

/** 单任务查询：后端无 GET /api/tasks/:id，从列表过滤（避免 404） */
async function getTask(taskId: number): Promise<{ id: number; stage: string; column: string }> {
  const { tasks } = await j<{ tasks: { id: number; stage: string; column: string }[] }>('/api/tasks');
  const t = tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`task ${taskId} not found in list`);
  return t;
}

async function main(): Promise<void> {
  console.log('[acceptance] ===== 真实端到端验收开始 =====');

  // 1. 新建任务（参考图复用 uploads 现有文件）
  const ref = '/uploads/0f5010e9-318f-4c6a-8503-e44649866804.jpg';
  const created = await j<{ task: { id: number; title: string; stage: string; column: string } }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: '无线磁吸充电宝 10000mAh 新品上架全套物料',
      description: '品名：无线磁吸充电宝；容量 10000mAh；卖点：磁吸无线充、20W 快充、超薄便携、Type-C 双向快充、支架一体。目标客群：通勤/差旅人群。',
      platforms: ['天猫', '京东'],
      referenceImage: ref,
    }),
  });
  const taskId = created.task.id;
  console.log(`[acceptance] 1. 任务已创建 #${taskId}「${created.task.title}」 -> ${created.task.stage}/${created.task.column}`);

  // 2. 确认开工 → 自动推进到首个拍板点（文案）
  console.log('[acceptance] 2. 确认开工（真实 LLM 产出需求单 + 文案…）');
  const afterConfirm = await j<{ task: { id: number; stage: string; column: string } }>(`/api/tasks/${taskId}/confirm`, { method: 'POST' });
  console.log(`[acceptance]    -> ${afterConfirm.task.stage}/${afterConfirm.task.column}`);
  if (afterConfirm.task.column === 'done') {
    console.log('[acceptance]    意外直接完成（线性模式？），退出');
    return;
  }

  // 3. 文案拍板点：查看交付物 → 采纳（响应返回时主图阶段已产出完成）
  const deliv = await j<{ deliverables: { kind: string; status: string; content: string }[] }>(`/api/tasks/${taskId}/deliverables`);
  const copy = deliv.deliverables.find((d) => d.kind === 'copy');
  if (!copy) throw new Error('文案交付物缺失');
  const cp = JSON.parse(copy.content) as { title: string; points: string[]; outline: string; keywords: string[] };
  console.log(`[acceptance] 3. 文案拍板：标题「${cp.title}」卖点 ${cp.points?.length ?? 0} 条 -> 采纳`);
  await j(`/api/tasks/${taskId}/deliverables/decide`, { method: 'POST', body: JSON.stringify({ kind: 'copy', decision: 'approve' }) });
  let t = await getTask(taskId);
  console.log(`[acceptance]    -> ${t.stage}/${t.column}（主图阶段 3 张真实生图完成）`);

  // 4+5. 图片拍板：取「最新图片集」逐张采纳（最后一张响应返回时 advance 已同步完成）
  const approveLatestImageSet = async (label: string) => {
    let guard = 0;
    while (guard++ < 80) {
      const list = await j<{ deliverables: { kind: string; content: string }[] }>(`/api/tasks/${taskId}/deliverables`);
      const imageRows = list.deliverables.filter((d) => d.kind === 'image');
      const row = imageRows[imageRows.length - 1]; // 最新图片集（主图行 id < 详情图行 id）
      if (!row) throw new Error(`[${label}] 图片交付物缺失`);
      const items = JSON.parse(row.content) as { id: string; name?: string; status: string }[];
      const pending = items.filter((i) => i.status === 'pending' || i.status === 'failed');
      if (pending.length === 0) break;
      for (const img of pending) {
        await j(`/api/tasks/${taskId}/deliverables/decide`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'image', imageId: img.id, decision: 'approve' }),
        });
        console.log(`[acceptance]    [${label}] 采纳 ${img.id}（${img.name ?? ''}）`);
      }
      await sleep(4000);
    }
  };

  await approveLatestImageSet('主图');
  t = await getTask(taskId);
  console.log(`[acceptance] 4. 主图已全部采纳 -> ${t.stage}/${t.column}（详情图阶段 4 张真实生图完成）`);

  await approveLatestImageSet('详情图');
  t = await getTask(taskId);
  console.log(`[acceptance] 5. 详情图已全部采纳 -> ${t.stage}/${t.column}（校对自动放行，交付归档完成）`);

  // 6. 终态核对
  const final = await getTask(taskId);
  console.log(`[acceptance] 6. 终态：task #${final.id} stage=${final.stage} column=${final.column}`);

  const finalDeliv = await j<{ deliverables: { kind: string; status: string; stage: string }[] }>(`/api/tasks/${taskId}/deliverables`);
  const approved = finalDeliv.deliverables.filter((d) => d.status === 'approved');
  console.log(`[acceptance]    交付物：共 ${finalDeliv.deliverables.length} 个，已采纳 ${approved.length} 个（${approved.map((d) => `${d.kind}@${d.stage}`).join(', ')}）`);

  if (final.column === 'done' && approved.length === finalDeliv.deliverables.length) {
    console.log('[acceptance] ===== ACCEPTANCE PASS：6 阶段 3 拍板点真实走通 =====');
  } else {
    console.log('[acceptance] ===== ACCEPTANCE INCOMPLETE（见上）=====');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[acceptance] 失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
