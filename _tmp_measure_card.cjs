// 临时诊断脚本：零依赖解码 PNG，测量看板卡片边框的物理像素高度（用后即删）
const fs = require('fs');
const zlib = require('zlib');
const file = process.argv[2];
const buf = fs.readFileSync(file);
let off = 8, w, h, depth, ctype, interlace;
const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off);
  const type = buf.toString('ascii', off + 4, off + 8);
  const data = buf.slice(off + 8, off + 8 + len);
  if (type === 'IHDR') {
    w = data.readUInt32BE(0); h = data.readUInt32BE(4);
    depth = data[8]; ctype = data[9]; interlace = data[12];
  } else if (type === 'IDAT') idat.push(data);
  else if (type === 'IEND') break;
  off += 12 + len;
}
console.log(`PNG ${w}x${h} depth=${depth} ctype=${ctype} interlace=${interlace}`);
if (depth !== 8 || (ctype !== 6 && ctype !== 2) || interlace !== 0) { console.log('不支持的格式'); process.exit(1); }
const bpp = ctype === 6 ? 4 : 3;
const raw = zlib.inflateSync(Buffer.concat(idat));
const stride = w * bpp;
const img = Buffer.alloc(h * stride);
let pos = 0;
for (let y = 0; y < h; y++) {
  const f = raw[pos++];
  const row = y * stride;
  for (let i = 0; i < stride; i++) {
    const x = i >= bpp ? img[row + i - bpp] : 0;
    const up = y > 0 ? img[row - stride + i] : 0;
    const ul = y > 0 && i >= bpp ? img[row - stride + i - bpp] : 0;
    let v = raw[pos + i];
    if (f === 1) v = (v + x) & 255;
    else if (f === 2) v = (v + up) & 255;
    else if (f === 3) v = (v + ((x + up) >> 1)) & 255;
    else if (f === 4) {
      const p = x + up - ul, pa = Math.abs(p - x), pb = Math.abs(p - up), pc = Math.abs(p - ul);
      v = (v + (pa <= pb && pa <= pc ? x : pb <= pc ? up : ul)) & 255;
    }
    img[row + i] = v;
  }
  pos += stride;
}
const px = (x, y) => { const o = y * stride + x * bpp; return [img[o], img[o + 1], img[o + 2]]; };
// --color-line #ececee=(236,236,238)：浅灰细边框（含抗锯齿容差）
const isLine = (x, y) => { const [r, g, b] = px(x, y); return r >= 224 && r <= 247 && g >= 224 && g <= 247 && b >= 226 && b <= 249 && Math.max(r, g, b) - Math.min(r, g, b) <= 7; };

// 1) 水平扫描 y=700（卡片中部）：找竖直边框 → 卡片左右边界
const yScan = 700;
const runsX = [];
let s = -1;
for (let x = 330; x <= 840; x++) {
  const m = isLine(x, yScan);
  if (m && s < 0) s = x;
  if (!m && s >= 0) { runsX.push([s, x - 1]); s = -1; }
}
console.log(`y=${yScan} 竖边框x区段:`, JSON.stringify(runsX));

// 取第2、3个区段为卡片左右边框（第1个是列容器左边框）
if (runsX.length >= 3) {
  const Lc = (runsX[1][0] + runsX[1][1]) / 2, Rc = (runsX[2][0] + runsX[2][1]) / 2;
  console.log(`卡片左右边框中心: L=${Lc} R=${Rc} 卡片物理宽=${(Rc - Lc).toFixed(0)}`);
  // 2) 竖直扫描两条线：卡片左内侧(列与卡之间) + 卡片水平中线，找水平边框
  for (const xs of [Math.round(Lc) - 8, Math.round((Lc + Rc) / 2)]) {
    const runsY = [];
    s = -1;
    for (let y = 500; y < Math.min(h, 1200); y++) {
      const m = isLine(xs, y);
      if (m && s < 0) s = y;
      if (!m && s >= 0) { runsY.push([s, y - 1]); s = -1; }
    }
    const centers = runsY.map(([a, b]) => +(((a + b) / 2).toFixed(1)));
    const gaps = centers.slice(1).map((c, i) => +(c - centers[i]).toFixed(1));
    console.log(`x=${xs} 水平边框y中心:`, JSON.stringify(centers));
    console.log(`x=${xs} 相邻间距:`, JSON.stringify(gaps));
  }
} else {
  console.log('竖边框区段不足3个，请人工看 runsX');
}
