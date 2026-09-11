/**
 * 交付包 ZIP 打包下载（delivery-ops B4）—— 零新增运行时依赖：
 * - ZIP 组装：node:zlib deflateRaw + 手写 CRC32（查表）+ 本地文件头/中央目录/EOCD
 * - 内容：最终文案（deliver 阶段上架资料包 CopyPackage → 文案.md + 文案.json）+ 全部已采纳图片原图
 * - 图片来源：dataURL / /uploads/ 本地文件 / http(s) URL；单张失败降级同名 .txt 说明，不整体失败
 * - 附 manifest.json 机器可读清单
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import type { CopyPackage, Deliverable, ImageItem, Task } from '@workbench/shared';

/** 上传图片目录（与 routes/tasks.ts UPLOAD_DIR 同源） */
const UPLOAD_DIR = join(import.meta.dirname, '..', '..', 'data', 'uploads');

// ===== CRC32（查表，与 zlib 标准一致；测试向量 "123456789" → 0xCBF43926） =====
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 组装 ZIP（deflate 压缩，UTF-8 文件名标志位） */
export function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const deflated = deflateRawSync(e.data);

    // 本地文件头
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // 版本
    local.writeUInt16LE(0x0800, 6); // 通用标志：UTF-8 文件名
    local.writeUInt16LE(8, 8); // 压缩方式：deflate
    local.writeUInt16LE(0, 10); // 修改时间
    local.writeUInt16LE(0, 12); // 修改日期
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // 额外长度
    localParts.push(local, nameBuf, deflated);

    // 中央目录条目
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    central.writeUInt16LE(20, 4); // 生成版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

// ===== 图片来源解析 =====

function mimeExt(mime: string): string {
  if (/png/i.test(mime)) return 'png';
  if (/webp/i.test(mime)) return 'webp';
  if (/jpe?g/i.test(mime)) return 'jpg';
  return 'png';
}

/** 从 dataURL 解码字节与扩展名 */
function fromDataUrl(url: string): { buf: Buffer; ext: string } | null {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s.exec(url);
  if (!m) return null;
  try {
    return { buf: Buffer.from(m[2], 'base64'), ext: mimeExt(m[1]) };
  } catch {
    return null;
  }
}

/** 从 /uploads/ 本地文件读取字节（与 routes/tasks.ts 的 UPLOAD_DIR 同源） */
function fromUploads(url: string): { buf: Buffer; ext: string } | null {
  const name = url.slice('/uploads/'.length);
  if (!/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/i.test(name)) return null;
  const path = join(UPLOAD_DIR, name);
  if (!existsSync(path)) return null;
  try {
    const buf = readFileSync(path);
    const ext = name.endsWith('.png') ? 'png' : name.endsWith('.webp') ? 'webp' : 'jpg';
    return { buf, ext };
  } catch {
    return null;
  }
}

/** 从 http(s) URL 取回（8s 超时） */
async function fromHttp(url: string): Promise<{ buf: Buffer; ext: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    return { buf: Buffer.from(data), ext: mimeFromBytes(data) };
  } catch {
    return null;
  }
}

/** 按字节魔数判定图片扩展名（png/jpg/webp 兜底 png） */
function mimeFromBytes(buf: Uint8Array): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return 'png';
}

/** 清理文件名非法字符 */
function sanitizeName(name: string): string {
  return String(name ?? '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .trim()
    .slice(0, 60);
}

// ===== 交付包组装 =====

export interface PackageImageInfo {
  name: string;
  stage: string;
  status: string;
  file: string;
}

export interface PackageManifest {
  taskId: number;
  taskTitle: string;
  platform: string;
  createdAt: string;
  copyFile: string | null;
  imageCount: number;
  excludedCount: number;
  excluded: { rejected: number; failed: number };
  images: PackageImageInfo[];
  missing: number;
  /** 部分模型未计价/缺失说明（交付包侧固定为空，供前端/协调者扩展） */
  note?: string;
}

export interface TaskPackageResult {
  zip: Buffer;
  manifest: PackageManifest;
  /** 缺失（降级为 .txt）的图片数量，路由用于 X-Deliverable-Missing 头 */
  missingCount: number;
}

/**
 * 组装任务交付包：
 * - 文案：deliver 阶段「上架资料包」copy 交付物 → 文案.md + 文案.json；缺失时回退 copy 阶段已采纳文案；再无则 null
 * - 图片：全部 image 交付物中 status === 'approved' 的条目；rejected/failed 不入包
 * - 单张图片获取失败 → 同名 .txt 说明 + manifest.missing + missingCount
 */
export async function buildTaskPackage(task: Task, deliverables: Deliverable[]): Promise<TaskPackageResult> {
  const createdAt = new Date().toISOString();
  const entries: ZipEntry[] = [];
  const images: PackageImageInfo[] = [];
  let missingCount = 0;

  // 文案：deliver 阶段优先，回退 copy 阶段已采纳
  const deliverCopy = deliverables.find((d) => d.stage === 'deliver' && d.kind === 'copy');
  const fallbackCopy = deliverables.find((d) => d.stage === 'copy' && d.kind === 'copy' && d.status === 'approved');
  let copyFile: string | null = null;
  const copySource = deliverCopy ?? fallbackCopy;
  if (copySource) {
    let cp: CopyPackage | null = null;
    try {
      cp = JSON.parse(copySource.content) as CopyPackage;
    } catch {
      cp = null;
    }
    if (cp) {
      const title = sanitizeName(cp.title || '文案') || '文案';
      const md =
        `# ${cp.title}\n\n## 核心卖点\n\n` +
        (cp.points ?? []).map((p) => `- ${p}`).join('\n') +
        `\n\n## 详情大纲\n\n${cp.outline ?? ''}\n\n## 关键词\n\n` +
        (cp.keywords ?? []).join('、') +
        '\n';
      const mdName = `文案/${title}.md`;
      const jsonName = `文案/${title}.json`;
      entries.push({ name: mdName, data: Buffer.from(md, 'utf8') });
      entries.push({ name: jsonName, data: Buffer.from(copySource.content, 'utf8') });
      copyFile = mdName;
    }
  }

  // 已采纳图片（按交付物遍历，保持阶段分组）
  const usedNames = new Set<string>();
  for (const d of deliverables) {
    if (d.kind !== 'image') continue;
    let items: ImageItem[] = [];
    try {
      items = JSON.parse(d.content) as ImageItem[];
    } catch {
      continue;
    }
    for (const img of items) {
      if (img.status !== 'approved') continue;
      const stage = sanitizeName(d.stage) || 'image';
      const baseName = sanitizeName(img.name) || `图片${img.id}`;
      let fileName = `${stage}/${baseName}-${img.id.slice(0, 8)}.png`;
      let counter = 1;
      while (usedNames.has(fileName)) {
        fileName = `${stage}/${baseName}-${img.id.slice(0, 8)}-${counter++}.png`;
      }
      usedNames.add(fileName);

      const resolved = await resolveImageBytes(img.url, fileName);
      if (!resolved) {
        missingCount += 1;
        const txtName = fileName.replace(/\.(png|jpg|jpeg|webp)$/i, '') + '.txt';
        const shown = (img.url ?? '').slice(0, 120);
        const reason = img.url?.startsWith('data:image/svg') ? `模拟占位图（非最终成图），不入包：${shown}` : `图片获取失败：${shown}`;
        entries.push({ name: txtName, data: Buffer.from(`${reason}\n已降级为说明文件，不入包。\n`, 'utf8') });
        images.push({ name: img.name, stage: d.stage, status: img.status, file: txtName });
      } else {
        entries.push({ name: fileName, data: resolved });
        images.push({ name: img.name, stage: d.stage, status: img.status, file: fileName });
      }
    }
  }

  // 统计被排除图片
  let rejected = 0;
  let failed = 0;
  for (const d of deliverables) {
    if (d.kind !== 'image') continue;
    try {
      const items = JSON.parse(d.content) as ImageItem[];
      for (const img of items) {
        if (img.status === 'rejected') rejected += 1;
        if (img.status === 'failed') failed += 1;
      }
    } catch {
      /* ignore */
    }
  }

  const manifest: PackageManifest = {
    taskId: task.id,
    taskTitle: task.title,
    platform: task.platforms?.join('、') ?? task.platform ?? '',
    createdAt,
    copyFile,
    imageCount: images.filter((i) => !i.file.endsWith('.txt')).length,
    excludedCount: rejected + failed,
    excluded: { rejected, failed },
    images,
    missing: missingCount,
  };
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });

  return { zip: buildZip(entries), manifest, missingCount };
}

/** 解析一张图片为原始字节；失败返回 null（调用方降级 .txt） */
async function resolveImageBytes(url: string, _fileName: string): Promise<Buffer | null> {
  if (!url) return null;
  if (url.startsWith('data:image/')) {
    const r = fromDataUrl(url);
    return r ? r.buf : null;
  }
  if (url.startsWith('/uploads/')) {
    const r = fromUploads(url);
    return r ? r.buf : null;
  }
  if (/^https?:\/\//i.test(url)) {
    const r = await fromHttp(url);
    return r ? r.buf : null;
  }
  return null;
}

/** 任务是否有任何「已定案交付物」（已采纳文案或含 approved 图片），供 409 判定 */
export function hasAnySettledDeliverable(deliverables: Deliverable[]): boolean {
  return deliverables.some((d) => {
    if (d.kind === 'copy') return d.status === 'approved';
    if (d.kind === 'image') {
      try {
        const items = JSON.parse(d.content) as ImageItem[];
        return items.some((i) => i.status === 'approved');
      } catch {
        return false;
      }
    }
    return false;
  });
}
