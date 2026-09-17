/**
 * migrate-deliverable-images.ts —— 一次性数据迁移（report-driven-fixes D-03 存量迁移）
 *
 * 把存量 `deliverables.content` 里的图片 base64 dataURL 落盘为 `backend/data/uploads/<uuid>.<ext>`，
 * 并将 content 中对应 url 更新为 `/uploads/<file>`（接口响应体积骤降；前端经代理仍可显示）。
 * 写 settings 标记（架构铁律 11），重启不重复迁移。
 *
 * 用法（在 backend/ 下执行）：
 *   node scripts/migrate-deliverable-images.ts          # dry-run（默认）：预览将迁移的行数/图片数，不写库
 *   node scripts/migrate-deliverable-images.ts --apply  # 真迁移：落盘 + 更新 content + settings 标记
 *
 * 幂等：settings 已有 `migrate:deliverableImagesV1` 标记时直接退出。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(here, '../data/workbench.db.ts');
const UPLOAD_DIR = resolve(here, '../data/uploads');

const APPLY = process.argv.includes('--apply');
const MARK_KEY = 'migrate:deliverableImagesV1';

/** dataURL → { buf, ext }；仅 png/jpg/webp，其余返回 null（不迁移） */
function decodeImage(dataUrl: string): { buf: Buffer; ext: string } | null {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    const mediaType = m[1];
    const ext = /png/i.test(mediaType) ? 'png' : /webp/i.test(mediaType) ? 'webp' : 'jpg';
    return { buf: Buffer.from(m[2], 'base64'), ext };
  } catch {
    return null;
  }
}

interface ImageItemLike {
  id?: string;
  name?: string;
  status?: string;
  url?: string;
}

function main(): void {
  if (!existsSync(DB_PATH)) {
    console.error(`[migrate-deliverable-images] 数据库不存在：${DB_PATH}`);
    process.exit(1);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 5000');

  const mark = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(MARK_KEY) as { value: string } | undefined;
  if (mark) {
    console.log(`[migrate-deliverable-images] settings 已有标记 ${MARK_KEY}，已迁移过，跳过（幂等）。`);
    db.close();
    return;
  }

  // 收集需要迁移的行（kind='image' 且 content 含 base64 dataURL）
  const rows = db.prepare(`SELECT id, task_id, stage, version, content FROM deliverables WHERE kind = 'image'`).all() as {
    id: number;
    task_id: number;
    stage: string;
    version: number;
    content: string;
  }[];

  let base64Rows = 0;
  let base64Images = 0;
  for (const r of rows) {
    let items: ImageItemLike[] = [];
    try {
      items = JSON.parse(r.content) as ImageItemLike[];
    } catch {
      continue;
    }
    const hasBase64 = items.some((it) => typeof it.url === 'string' && it.url.startsWith('data:image'));
    if (hasBase64) {
      base64Rows++;
      base64Images += items.filter((it) => typeof it.url === 'string' && it.url.startsWith('data:image')).length;
    }
  }
  console.log(`[migrate-deliverable-images] image 交付物 ${rows.length} 行，其中含 base64 图片的 ${base64Rows} 行 / ${base64Images} 张待迁移。`);

  if (!APPLY) {
    console.log('[migrate-deliverable-images] dry-run（未执行任何写入），确认后加 --apply 执行；执行时写 settings 标记防重复。');
    db.close();
    return;
  }

  db.exec('BEGIN');
  let migratedRows = 0;
  let migratedImages = 0;
  let skipped = 0;
  try {
    for (const r of rows) {
      let items: ImageItemLike[];
      try {
        items = JSON.parse(r.content) as ImageItemLike[];
      } catch {
        continue;
      }
      let changed = false;
      for (const it of items) {
        if (typeof it.url !== 'string' || !it.url.startsWith('data:image')) continue;
        const dec = decodeImage(it.url);
        if (!dec) {
          skipped++;
          continue;
        }
        mkdirSync(UPLOAD_DIR, { recursive: true });
        const name = `${randomUUID()}.${dec.ext}`;
        writeFileSync(join(UPLOAD_DIR, name), dec.buf);
        it.url = `/uploads/${name}`;
        changed = true;
        migratedImages++;
      }
      if (changed) {
        db.prepare(`UPDATE deliverables SET content = ? WHERE id = ?`).run(JSON.stringify(items), r.id);
        migratedRows++;
      }
    }
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(
      MARK_KEY,
      JSON.stringify({ at: new Date().toISOString(), migratedRows, migratedImages, skipped }),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.close();
    throw err;
  }

  // 迁移后校验 0 残留（spec 2.2：迁移后无 base64 残留）
  const left = db.prepare(`SELECT count(*) AS c FROM deliverables WHERE kind = 'image' AND content LIKE '%data:image%'`).get() as { c: number };
  console.log(`[migrate-deliverable-images] 已迁移 ${migratedRows} 行 / ${migratedImages} 张（跳过 ${skipped} 张无法解析）。`);
  console.log(`[migrate-deliverable-images] 校验：迁移后仍含 base64 的 image 交付物 = ${left.c} 行${left.c === 0 ? '（0 残留 ✓）' : '（需人工检查）'}。`);
  console.log(`[migrate-deliverable-images] settings 标记 ${MARK_KEY} 已写入，重启不会重复迁移。`);
  db.close();
}

main();
