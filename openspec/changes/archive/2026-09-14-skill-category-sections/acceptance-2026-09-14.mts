/**
 * 验收脚本 — change 2026-09-14-skill-category-sections（Task 6.4 + 4.6 复验）
 * 运行：node openspec/changes/2026-09-14-skill-category-sections/acceptance-2026-09-14.mts
 * 环境：临时库 + seed（mock 渠道），不触碰用户生产库，不消耗 LLM 额度。
 * 覆盖：
 *   A. 真实引擎实跑电商任务：创建 → 确认开工 → 文案阶段产出（6.4「至少走通一个阶段」）
 *   B. 技能注入链路：buildSystemPrompt 含挂载技能全文（子目录化后不静默为空）
 *   C. 工作流专属技能映射未被破坏（xhs-note）
 *   D. pdf→md 幂等迁移：构造存量行 → 连续两次 ensureSchema → 二次零变化
 *   E. seed 挂载全集全部可解析为非空内容
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'acceptance-skill-'));
process.env.WORKBENCH_DB = join(dir, 'a.db');

const REPO = 'C:/Users/Administrator/Desktop/AI-JUMP/vibe coding/12-0908-agent borad/backend/src';
const u = (p: string) => pathToFileURL(join(REPO, p)).href;

const results: { item: string; pass: boolean; note: string }[] = [];
function record(item: string, pass: boolean, note: string) {
  results.push({ item, pass, note });
  console.log((pass ? 'PASS ' : 'FAIL ') + item + ' — ' + note);
}

// 脚本位于 openspec/ 下不在 workspace 链内，@workbench/shared 需以绝对路径导入
const shared = await import(pathToFileURL(join(REPO, '../../packages/shared/src/index.ts')).href);
const { ensureSchema } = await import(u('db/ensure.ts'));
const { seed } = await import(u('db/seed.ts'));
const { all, get } = await import(u('db/client.ts'));
const { service } = await import(u('engine/service.ts'));
const { getDeliverable } = await import(u('delivery/store.ts'));
const { buildSystemPrompt } = await import(u('agents/smart-producer.ts'));
const { readSkillContent, readFileContent, resetSkillIndexForTest } = await import(u('agents/skills.ts'));

ensureSchema();
seed();

// ---- A. 真实引擎实跑（Task 6.4）----
try {
  const t = service.createTask({ title: '验收-磁吸充电宝上架', description: '30W 磁吸充电宝，主打通售与快充', platforms: ['天猫'] });
  const task = await service.confirmAndRun(t.id);
  const copy = getDeliverable(task.id, 'copy', 'copy');
  const events = service.listEvents(task.id).map((e) => e.type);
  const okTask = task.column === 'awaiting' && task.stage === shared.STAGE_COPY;
  record('A1 任务走通到文案确认点', okTask, `column=${task.column} stage=${task.stage}`);
  record('A2 文案交付物已产出', !!copy && copy.status === 'pending', copy ? `id=${copy.id} status=${copy.status}` : 'deliverable 缺失');
  record('A3 执行无异常且事件时间线完整', events.includes('TASK_CREATED') && events.includes('TASK_CONFIRMED') && events.includes('STAGE_COMPLETED'), `events=${[...new Set(events)].join(',')}`);
  if (copy) {
    const parsed = JSON.parse(copy.content) as { title?: string; points?: string[] };
    record('A4 产出为有效 CopyPackage', typeof parsed.title === 'string' && Array.isArray(parsed.points), `title=${parsed.title} points=${parsed.points?.length ?? 0} 条`);
  }
} catch (e) {
  record('A 任务实跑', false, String(e).slice(0, 200));
}

// ---- B. 技能注入链路 ----
try {
  const prompt = await buildSystemPrompt('agent-copy', 'BASE');
  const skills = ['电商文案模板', 'SEO 关键词', '小红书合规违禁词清单'];
  const allIn = skills.every((s) => prompt.includes(`## 技能：${s}`));
  record('B1 挂载技能全部注入', allIn, `美美 skills=${skills.join('、')}`);
  record('B2 技能全文非空（冷启动索引回归）', prompt.includes('绝对化用语'), '命中《小红书合规违禁词清单》正文特征词');
  const file = await readFileContent('品牌手册.md');
  record('B3 挂载文件可读取', file.includes('品牌') && file.length > 100, `品牌手册.md ${file.length} 字符`);
} catch (e) {
  record('B 注入链路', false, String(e).slice(0, 200));
}

// ---- C. 工作流专属技能映射 ----
try {
  const sp = await (await import('node:fs/promises')).readFile(join(REPO, 'agents/smart-producer.ts'), 'utf8');
  record('C1 xhs-note 过滤映射保留', sp.includes("小红书合规违禁词清单: ['xhs-note']") && sp.includes('【工作流专属技能】'), 'WORKFLOW_SKILLS 与段标题在位');
} catch (e) {
  record('C 工作流过滤', false, String(e).slice(0, 200));
}

// ---- D. pdf→md 幂等迁移（Task 4.6 复验：两次执行零变化）----
try {
  const before = all<{ id: string; files: string }>("SELECT id, files FROM agents WHERE files LIKE '%.pdf%'");
  const patched = before.map((r) => ({ ...r }));
  // 构造存量行：把美美的 files 还原为 .pdf 旧值，再连跑两次 ensureSchema
  get("SELECT id FROM agents WHERE id='agent-copy'");
  all("UPDATE agents SET files=? WHERE id='agent-copy'", [JSON.stringify(['品牌手册.pdf'])]);
  ensureSchema();
  const once = (get<{ files: string }>("SELECT files FROM agents WHERE id='agent-copy'"))!.files;
  ensureSchema();
  const twice = (get<{ files: string }>("SELECT files FROM agents WHERE id='agent-copy'"))!.files;
  record('D1 首次执行完成 pdf→md 迁移', once === JSON.stringify(['品牌手册.md']), `once=${once}`);
  record('D2 二次执行幂等零变化', once === twice, `twice=${twice}`);
  void patched; void before;
} catch (e) {
  record('D 迁移幂等', false, String(e).slice(0, 200));
}

// ---- E. seed 挂载全集可解析 ----
try {
  resetSkillIndexForTest(); // 模拟进程冷启动
  const rows = all<{ id: string; skills: string; files: string }>('SELECT id, skills, files FROM agents');
  let total = 0; let ok = 0; const missing: string[] = [];
  for (const r of rows) {
    for (const s of JSON.parse(r.skills || '[]') as string[]) { total++; if (await readSkillContent(s)) ok++; else missing.push(`${r.id}/${s}`); }
    for (const f of JSON.parse(r.files || '[]') as string[]) { total++; if (await readFileContent(f)) ok++; else missing.push(`${r.id}/${f}`); }
  }
  record('E1 全部挂载项冷启动可解析', ok === total, `${ok}/${total} 解析为非空${missing.length ? '，缺失：' + missing.join('、') : ''}`);
} catch (e) {
  record('E 挂载可解析', false, String(e).slice(0, 200));
}

rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r.pass);
console.log(`\n=== 验收汇总：${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { console.log('失败项：' + failed.map((f) => f.item).join('；')); process.exit(1); }
