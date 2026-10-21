/**
 * 从真实数据库导出「作品集沙盒」用的演示数据（一次性脚本）
 *
 * 用途：作品集沙盒要用**真实案例**展示（不再手编假数据）。
 *       本脚本从 backend/data/workbench.db.ts 读取指定任务及其全部关联数据，
 *       抽取成 TypeScript 模块 frontend/src/sandbox/demo-data.ts 的结构，
 *       图片单独落地为文件（压缩后）并改写为相对路径引用。
 *
 * 为什么单独写脚本而不是手抄：
 *   真实数据含 base64 内嵌图片（单个 6~11MB）、事件流、校对报告等，
 *   手抄必然失真；用脚本导出可保证「沙盒里看到的 = 数据库里真实发生的」。
 *
 * 用法：node backend/scripts/export-sandbox-demo.mjs [--apply]
 *   默认 dry-run 只打印将要导出的内容概要；--apply 才真正写文件。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const APPLY = process.argv.includes('--apply');
const ROOT = resolve(import.meta.dirname, '../..');
const DB = join(ROOT, 'backend/data/workbench.db.ts');
const OUT_TS = join(ROOT, 'frontend/src/sandbox/demo-data.ts');
const OUT_IMG = join(ROOT, 'frontend/public/demo');

/** 选定的 6 个真实案例（与用户确认：2 已完成 + 2 进行中 + 1 待确认 + 1 完整闭环） */
const CASE_IDS = [26, 13, 29, 8, 47, 46, 44];

/**
 * 作品集展示用的任务阶段覆盖（**为什么需要**）：
 * 界面按「当前阶段」决定展示哪个板块——小红书工作流只有在「首图设计 / 内页配图」阶段才渲染图片区。
 * 若把已走到 xhs-deliver 的任务直接搬来展示，它的真实图片就永远看不到（图片挂在早期阶段）。
 * 因此对这几个案例指定「停在图片阶段等确认」的展示态——这也符合真实业务：
 * 图片产出后本来就该停在图片阶段等人工确认，不会自动往下走。
 * 注：这里只影响作品集展示，不动数据库。
 */
const SHOW_STAGE = {
  13: { stage: 'xhs-inner', column: 'awaiting' }, // 办公室即溶咖啡：有 2 张真实内页图，停在「内页配图」
  29: { stage: 'xhs-cover', column: 'awaiting' }, // 冬日暖手宝：有首图+内页图，停在「首图设计」
  44: { stage: 'xhs-inner', column: 'done', allApproved: true }, // 华米手表（小红书）：演示「一键采纳 → 已完成」。
  //   为什么 stage 留 xhs-inner 而 column 设 done（两者可并存，已核对源码）：
  //   · 图片区按 **stage** 判定（仅 cover/inner 阶段渲染图片），设成 xhs-deliver 会让 3 张真实图看不到；
  //   · 「已完成」状态按 **column** 判定（XhsDeliveryView: isDone = column === 'done'），与 stage 无关。
  //   该组合既能看到真实图片、又呈现已交付完成的状态。
};

/**
 * 旧阶段 ID → 展示阶段 ID 的对齐映射。
 *
 * 背景：小红书工作流的阶段 ID 在历史上改过名（`xhs-image` → 现在的 `xhs-cover`/`xhs-inner`），
 * 真实数据库里早期任务的交付物仍带旧 ID。作品集展示时，界面按**当前阶段 ID** 精确匹配取图，
 * 旧 ID 命中不到 → 图片区空白（#13 就踩了这个坑）。
 * 因此导出时把旧 ID 归一到当前 ID，保证「任务 stage」与「交付物 stage」口径一致。
 */
const STAGE_ALIGN = {
  'xhs-image': 'xhs-inner', // 旧「首图/内页配图」合并阶段 → 归到「内页配图」
};

if (!existsSync(DB)) {
  console.error(`[export-sandbox-demo] 找不到数据库：${DB}`);
  process.exit(1);
}

const db = new DatabaseSync(DB, { readOnly: true });

/* ---------- 工具：base64 抽图并压缩落地 ---------- */

/**
 * 把交付物里的 base64 图片抽出来落地为文件，返回改写后的交付物内容。
 * 压缩策略：只做「缩尺寸 + 转 JPEG」的等比缩放，目标是让总积体可控（作品集要秒开）。
 * 注意：用 sharp 不现实（未安装），改用浏览器无关的纯 JS 方式不可行，
 *      故这里**只抽不压**，压缩交给后续 Python(Pillow) 环节统一处理。
 */
function extractImages(content, taskId, stage, usedNames) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { content, images: [] };
  }
  if (!Array.isArray(parsed)) return { content, images: [] };

  const images = [];
  const rewritten = parsed.map((item, idx) => {
    const raw = String(item?.url ?? '');

    // 情况二：图片是**文件路径**（/uploads/xxx.png）——新版任务（图片落盘后）都是这种。
    // 需要把文件从 backend/data/uploads 复制进作品集，并改写成 /demo/xxx.jpg 引用。
    // 若不处理，新案例会显示「图片失效」（图片实际存在，只是没被带进作品集）。
    const fm = raw.match(/^\/uploads\/([^/?#]+\.(?:png|jpe?g|webp))$/i);
    if (fm) {
      const srcPath = join(ROOT, 'backend/data/uploads', fm[1]);
      if (!existsSync(srcPath)) return item;
      const name = `t${taskId}-${stage}-${idx + 1}.jpg`;
      if (usedNames.has(name)) return item;
      usedNames.add(name);
      images.push({ name, buf: readFileSync(srcPath), fromFile: true });
      return { ...item, url: `/demo/${name}` };
    }

    const m = raw.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s);
    if (!m) return item;
    // 统一落成 .jpg：后续压缩环节（Pillow）会把图转成 JPEG 以控制体积
    // （AI 生成图多为 PNG，动辄 6~11MB；作品集必须秒开）。
    // 这里若沿用原扩展名，就会出现「数据写 .png、磁盘是 .jpg」的 404 事故（曾发生过）。
    const ext = 'jpg';
    let name = `t${taskId}-${stage}-${idx + 1}.${ext}`;
    while (usedNames.has(name)) name = `t${taskId}-${stage}-${idx + 1}-b.${ext}`;
    usedNames.add(name);
    const buf = Buffer.from(m[2], 'base64');
    images.push({ name, buf, srcExt: m[1] });
    return { ...item, url: `/demo/${name}` };
  });
  return { content: JSON.stringify(rewritten), images };
}

/* ---------- 读取 6 个案例 ---------- */

const usedNames = new Set();
const outImages = [];
const tasks = [];
const deliverables = {};
const events = {};

for (const id of CASE_IDS) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!t) {
    console.warn(`[export-sandbox-demo] 跳过：任务 #${id} 不存在`);
    continue;
  }
  // 作品集展示态：有覆盖就用覆盖（让图片停在会被渲染的阶段），否则用数据库原值
  const show = SHOW_STAGE[id];
  tasks.push({
    id: t.id,
    title: t.title,
    workflowId: t.workflow_id,
    stage: show?.stage ?? t.stage,
    column: show?.column ?? t.column,
    ownerAgentId: t.owner_agent_id,
    description: t.description,
    platform: t.platform,
    progress: t.progress,
    stageNote: t.stage_note,
    createdBy: t.created_by,
    createdAt: t.created_at,
    archived: 0,
    brief: t.brief ? JSON.parse(t.brief) : null,
  });

  const rows = db.prepare('SELECT * FROM deliverables WHERE task_id = ? ORDER BY id').all(id);
  deliverables[id] = rows.map((d) => {
    // 阶段对齐：手写区里为作品集调整过任务 stage（让图片落在会被渲染的阶段），
    // 交付物记录里的 stage 若不同步，界面按新阶段取图就会取空（曾发生 #13 图片区空白）。
    // 这里的对齐规则：把「旧阶段 ID」映射到「展示阶段 ID」，保持同一任务内阶段口径一致。
    const shownStage = STAGE_ALIGN[d.stage] ?? d.stage;
    const { content, images } = extractImages(d.content, id, shownStage, usedNames);
    outImages.push(...images);
    return {
      id: d.id,
      taskId: d.task_id,
      stage: shownStage,
      kind: d.kind,
      // 演示态覆盖：让「已交付」的案例其交付物也显示为已采纳，
      // 避免出现「任务已完成、交付物却写着待确认」的自相矛盾（#44 用户要求演示一键采纳后的结果）。
      status: SHOW_STAGE[id]?.allApproved ? 'approved' : d.status,
      version: d.version,
      updatedAt: d.updated_at,
      content,
    };
  });

  events[id] = db
    .prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY id')
    .all(id)
    .map((e) => ({
      id: e.id,
      type: e.type ?? 'stage',
      actor: e.actor ?? '',
      text: e.summary ?? e.text ?? '',
      at: e.created_at,
    }));
}

/* ---------- 概要输出（dry-run 也打印，便于核对） ---------- */

console.log('=== 导出概要 ===');
for (const t of tasks) {
  const dl = deliverables[t.id] ?? [];
  const ev = events[t.id] ?? [];
  const imgs = dl.reduce((n, d) => n + (d.content.match(/\/demo\//g)?.length ?? 0), 0);
  console.log(
    `#${t.id} [${t.workflowId}/${t.stage}/${t.column}] 交付物=${dl.length} 事件=${ev.length} 抽图=${imgs} | ${t.title}`,
  );
}
console.log(`\n图片总数：${outImages.length}，原始总字节：${(outImages.reduce((n, i) => n + i.buf.length, 0) / 1024 / 1024).toFixed(1)} MB`);

if (!APPLY) {
  console.log('\n[dry-run] 未写入任何文件。确认无误后加 --apply 执行。');
  db.close();
  process.exit(0);
}

/* ---------- 落地：图片 + TS 模块 ---------- */

mkdirSync(OUT_IMG, { recursive: true });
for (const img of outImages) {
  writeFileSync(join(OUT_IMG, img.name), img.buf);
}
console.log(`\n已写入 ${outImages.length} 张图片到 ${OUT_IMG.replace(ROOT + '\\', '')}`);

/** 生成 TS 模块：结构对齐后端真实返回，供拦截层直接使用 */
const agents = db.prepare('SELECT id, name, role, model FROM agents').all();
const workflows = db.prepare('SELECT id, name FROM workflows').all();

/** 数据区标记：只替换这两个标记之间的内容，**保留**手写区（热点/知识库/聊天等） */
const DATA_BEGIN = '/* <<<DATA-BEGIN>>> 以下数据由 export-sandbox-demo.mjs 自动生成 */';
const DATA_END = '/* <<<DATA-END>>> */';

const HEAD = `/**
 * 沙盒演示数据 —— **任务类数据来自真实数据库导出**（不是手编样例）
 *
 * 数据来源：
 *   1. 任务/交付物/事件流 → 由 backend/scripts/export-sandbox-demo.mjs 从
 *      backend/data/workbench.db.ts 的 6 个真实案例导出（见脚本 CASE_IDS），位于 DATA-BEGIN/END 之间；
 *   2. 热点/知识库/聊天/统计 → 手写区（真实热点是实时的、知识库是用户私有资料，
 *      不适合直接公开，故用「结构真实、内容示意」方式呈现，界面功能与真实一致、数据已脱敏）。
 *
 * ⚠️ 数据区由脚本维护，不要手改（会被下次导出覆盖）；手写区在 DATA-END 之后，可自由编辑。
 */

`;

const dataBlock =
  `${DATA_BEGIN}\n\n` +
  [
    `export const AGENTS = ${JSON.stringify(agents, null, 2)};`,
    `export const WORKFLOWS = ${JSON.stringify(workflows, null, 2)};`,
    `export const TASKS = ${JSON.stringify(tasks, null, 2)};`,
    `export const DELIVERABLES = ${JSON.stringify(deliverables, null, 2)};`,
    `export const TASK_EVENTS = ${JSON.stringify(events, null, 2)};`,
  ].join('\n\n') +
  `\n\n${DATA_END}\n`;

/**
 * 合并写回：若目标文件已存在且含标记，则**只替换数据区**，完整保留手写区；
 * 否则按新文件写入（首次生成的情况）。
 */
let finalText;
if (existsSync(OUT_TS)) {
  const old = readFileSync(OUT_TS, 'utf8');
  const b = old.indexOf(DATA_BEGIN);
  const e = old.indexOf(DATA_END);
  if (b >= 0 && e > b) {
    const handWritten = old.slice(e + DATA_END.length);
    finalText = HEAD + dataBlock + handWritten;
    console.log('检测到已有文件：仅替换数据区，手写区（热点/知识库/聊天等）已原样保留。');
  } else {
    console.warn('⚠️ 目标文件存在但没有数据区标记：为避免覆盖手写内容，已中止写入。');
    console.warn('   请先手动把文件整理为「HEAD + DATA-BEGIN/END 数据区 + 手写区」结构。');
    db.close();
    process.exit(1);
  }
} else {
  finalText = HEAD + dataBlock;
}

writeFileSync(OUT_TS, finalText, 'utf8');
console.log(`已写入 ${OUT_TS.replace(ROOT + '\\', '')}`);
db.close();
