/**
 * 生图落文件（report-driven-fixes D-03）：把 producer 返回的图片 dataURL 落盘到
 * `backend/data/uploads/`，交付物 content 里只存 `/uploads/<file>` 相对路径（前端经代理可访问）。
 *
 * 只落盘 png / jpg / webp 三种**最终成图**；mock SVG 占位图与空串**不落盘**（原样返回），
 * 保证「交付包」里 SVG 占位图仍走既有降级逻辑（非最终成图 → .txt 说明），与既有测试语义一致。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

/** 上传目录（与 routes/tasks.ts UPLOAD_DIR 同源：backend/data/uploads）；
 *  可用环境变量 WORKBENCH_UPLOAD_DIR 覆盖（测试隔离用，同 WORKBENCH_DB 模式）。 */
export const UPLOAD_DIR = process.env.WORKBENCH_UPLOAD_DIR?.trim()
  ? process.env.WORKBENCH_UPLOAD_DIR.trim()
  : join(import.meta.dirname, '..', '..', 'data', 'uploads');

/**
 * dataURL → 落盘 `<uuid>.<ext>`，返回 `/uploads/<file>`。
 * 非 png/jpg/webp 的 dataURL（如 mock SVG 占位图）或非法输入 → 原样返回（不落盘）。
 * 落盘失败（写权限/磁盘异常）也原样返回，不阻断生图链路。
 */
export function persistImageDataUrl(dataUrl: string): string {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s.exec(dataUrl);
  if (!m) return dataUrl;
  try {
    const mediaType = m[1];
    const ext = /png/i.test(mediaType) ? 'png' : /webp/i.test(mediaType) ? 'webp' : 'jpg';
    const name = `${randomUUID()}.${ext}`;
    mkdirSync(UPLOAD_DIR, { recursive: true });
    writeFileSync(join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
    return `/uploads/${name}`;
  } catch {
    return dataUrl;
  }
}
