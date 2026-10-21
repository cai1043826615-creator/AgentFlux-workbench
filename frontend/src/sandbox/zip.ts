/**
 * 浏览器端最小 ZIP 打包器（沙盒演示用）
 *
 * 为什么自己写：
 *   前端没有 zip 依赖，而沙盒里「下载交付包」原先返回的是一个**假 zip**
 *   （Content-Type 写 application/zip，内容却是纯文本）——访客下载后用解压软件打不开，
 *   比"不能下载"更尴尬。这里实现一个真正能被解压的 ZIP（存储模式，不压缩），
 *   让访客下载到的交付包是**真的能打开**的。
 *
 * 实现依据：ZIP 规范（APPNOTE.TXT）的最小可用子集——本地文件头 + 中央目录 + 结束记录。
 * 采用 STORE（compression method 0，不压缩）：实现简单可靠，演示包体积很小（文案+几张图），
 * 不压缩完全够用；避免手写 deflate 带来的出错风险（浏览器端无 node:zlib）。
 *
 * 支持中文文件名（ZIP 规范里用 UTF-8 + 通用位标记 bit 11 声明）。
 */

/** 待打包的条目 */
export interface ZipEntry {
  /** 文件路径（可含 / 表示目录层级，如 `文案/卖点.txt`） */
  name: string;
  /** 文件内容 */
  data: Uint8Array;
}

/** CRC-32 查表（ZIP 要求每个文件带校验和） */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 把 JS Date 转成 ZIP 的 DOS 时间格式（两个 16 位字段拼成 32 位） */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)) & 0x1f) & 0xffff;
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  return { time, date };
}

/** 小端写入工具 */
function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/**
 * 打包成 ZIP 字节流。
 * @param entries 文件列表
 * @param modifiedAt 文件修改时间（默认当前时间）
 */
export function makeZip(entries: ZipEntry[], modifiedAt = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(modifiedAt);
  const chunks: number[] = [];
  /** 中央目录项记录（每个文件一条） */
  const central: number[] = [];
  /** 已写入的字节偏移，用于中央目录里的相对偏移 */
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    // 通用位标记 bit 11（0x0800）：文件名按 UTF-8 编码（中文路径必需）
    const flags = 0x0800;

    const header = [
      ...u32(0x04034b50), // 本地文件头签名
      ...u16(20), // 需要的版本
      ...u16(flags), // 通用位标记
      ...u16(0), // 压缩方法 0 = STORE
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(size), // 压缩后大小（STORE 模式下等于原始大小）
      ...u32(size), // 原始大小
      ...u16(nameBytes.length),
      ...u16(0), // 扩展字段长度
    ];
    chunks.push(...header, ...nameBytes, ...entry.data);

    central.push(
      ...u32(0x02014b50), // 中央目录头签名
      ...u16(20), // 创建版本
      ...u16(20), // 需要版本
      ...u16(flags),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), // 扩展字段
      ...u16(0), // 注释
      ...u16(0), // 磁盘号
      ...u16(0), // 内部属性
      ...u32(0), // 外部属性
      ...u32(offset), // 本地头偏移
      ...nameBytes,
    );

    offset += header.length + nameBytes.length + size;
  }

  const centralSize = central.length;
  const end = [
    ...u32(0x06054b50), // 结束记录签名
    ...u16(0),
    ...u16(0),
    ...u16(entries.length), // 本盘条目数
    ...u16(entries.length), // 总条目数
    ...u32(centralSize),
    ...u32(offset), // 中央目录偏移
    ...u16(0), // 注释长度
  ];

  return new Uint8Array([...chunks, ...central, ...end]);
}
