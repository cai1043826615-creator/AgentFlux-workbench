import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('./data/workbench.db.ts');
const reps = [
  ['待你拍板', '待你确认'],
  ['待拍板', '待确认'],
  ['已交付 · 已归档', '已交付 · 已完成'],
  ['交付归档', '交付完成'],
];
let total = 0;
for (const [a, b] of reps) {
  const r = db.prepare('UPDATE tasks SET stage_note = REPLACE(stage_note, ?, ?) WHERE instr(stage_note, ?) > 0').run(a, b, a);
  total += r.changes;
}
console.log('stage_note 更新行数:', total);
const left = db
  .prepare("SELECT id, stage_note FROM tasks WHERE stage_note LIKE '%待拍板%' OR stage_note LIKE '%待你拍板%' OR stage_note LIKE '%已交付 · 已归档%' OR stage_note LIKE '%交付归档%'")
  .all();
console.log('残留行数:', left.length);
for (const r of left) console.log(r.id, r.stage_note);
db.close();
