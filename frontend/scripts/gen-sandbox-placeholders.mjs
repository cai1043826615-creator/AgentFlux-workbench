/**
 * 生成沙盒占位图 SVG（一次性脚本，产物已入库：frontend/public/sandbox/*.svg）
 *
 * 为什么用脚本生成而不是手写 9 个文件：9 张图共用一套版式（白底 + 中文标签 + 尺寸标注），
 * 用脚本保证「同一套视觉语言」，改一次配色全部重出，也不容易写错尺寸。
 *
 * 用法：node frontend/scripts/gen-sandbox-placeholders.mjs
 *
 * 设计约束（对齐项目 UI 规范）：
 * - 主色 #7c3aed 仅用于极少量焦点元素（角标、定位框）；辅色 #fafafa / #ffffff / #ececee 打底
 * - 圆角只用 0 或 4px；不用渐变、不用玻璃拟态、不用阴影堆叠
 * - 主图 800×800（电商方图）；小红书内页 1080×1440（3:4）
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'sandbox');

/** 令牌取色（与 frontend/src/index.css 的 @theme 一致；SVG 里写死十六进制是刻意的：
 *  静态图片不参与主题切换，写死可避免 file:// 直接打开时 CSS 变量解析失败） */
const C = {
  canvas: '#fafafa',
  surface: '#ffffff',
  sunken: '#f4f4f5',
  ink: '#0a0a0a',
  inkSoft: '#52525b',
  inkFaint: '#71717a',
  line: '#ececee',
  lineStrong: '#dcdce0',
  signal: '#7c3aed',
  signalSoft: '#f3effe',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 主图（800×800）：白底 + 产品线稿框 + 中文标签 + 序号 */
function mainImage({ index, total, label, hint }) {
  const w = 800;
  const h = 800;
  // 角标宽度按文本估算（中文按字号计宽，英文数字约半宽）：写死宽度会截断标签，
  // 这里是静态图，不做 textLength 拉伸（拉伸会让字距变形，比截断更难看）
  const charW = (s) => [...s].reduce((n, ch) => n + (/[\u4e00-\u9fa5]/.test(ch) ? 1 : 0.56), 0);
  const badgeW = Math.round(charW(label) * 20 + 32);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
  <rect width="${w}" height="${h}" fill="${C.surface}"/>
  <!-- 商品主体区：居中留白，四周 40px 安全边距（对齐《电商主图规范》） -->
  <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="${C.line}"/>
  <rect x="150" y="150" width="${w - 300}" height="${h - 340}" rx="4" fill="${C.canvas}" stroke="${C.lineStrong}"/>
  <g stroke="${C.lineStrong}" fill="none">
    <path d="M150 ${h - 190} H${w - 150}"/>
    <path d="M${w / 2} 150 V${h - 190}" stroke-dasharray="6 8"/>
  </g>
  <text x="${w / 2}" y="${h / 2 - 6}" text-anchor="middle" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="34" fill="${C.inkSoft}">商品主体</text>
  <text x="${w / 2}" y="${h / 2 + 36}" text-anchor="middle" font-family="JetBrains Mono, Consolas, monospace" font-size="20" fill="${C.inkFaint}">800 × 800</text>

  <!-- 卖点标注块：每张图只讲一个卖点（规范原文要求） -->
  <rect x="150" y="${h - 176}" width="${w - 300}" height="70" rx="4" fill="${C.sunken}"/>
  <text x="${w / 2}" y="${h - 132}" text-anchor="middle" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="26" font-weight="600" fill="${C.ink}">${esc(hint)}</text>

  <!-- 角标：主色只在这里出现，保持稀疏 -->
  <rect x="40" y="40" width="${badgeW}" height="40" fill="${C.signal}"/>
  <text x="${40 + badgeW / 2}" y="67" text-anchor="middle" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="20" fill="#ffffff">${esc(label)}</text>
  <text x="${w - 40}" y="67" text-anchor="end" font-family="JetBrains Mono, Consolas, monospace" font-size="20" fill="${C.inkFaint}">0${index} / 0${total}</text>
</svg>
`;
}

/** 小红书内页（1080×1440）：3:4 + 顶部标题条 + 内容区 + 底部标签条 */
function xhsImage({ index, total, label, hint }) {
  const w = 1080;
  const h = 1440;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">
  <rect width="${w}" height="${h}" fill="${C.surface}"/>
  <rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="${C.line}" stroke-width="2"/>
  <!-- 首屏标题区（首图标题不超过 2 行的规范在这里体现为固定高度条） -->
  <rect x="60" y="72" width="${w - 120}" height="200" rx="4" fill="${C.canvas}" stroke="${C.lineStrong}"/>
  <text x="100" y="160" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="46" font-weight="600" fill="${C.ink}">${esc(label)}</text>
  <text x="100" y="222" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="28" fill="${C.inkSoft}">${esc(hint)}</text>
  <rect x="100" y="248" width="150" height="6" fill="${C.signal}"/>

  <!-- 内容区 -->
  <rect x="60" y="312" width="${w - 120}" height="880" rx="4" fill="${C.sunken}" stroke="${C.lineStrong}"/>
  <g stroke="${C.lineStrong}" fill="none">
    <path d="M60 752 H${w - 60}"/>
    <path d="M${w / 2} 312 V1192" stroke-dasharray="8 10"/>
  </g>
  <text x="${w / 2}" y="736" text-anchor="middle" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="38" fill="${C.inkSoft}">图文内容区</text>
  <text x="${w / 2}" y="790" text-anchor="middle" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="28" fill="${C.inkFaint}">（示意占位 · 发布时替换为实拍/成品图）</text>

  <!-- 底部标签条 -->
  <rect x="60" y="1240" width="${w - 120}" height="120" rx="4" fill="${C.signalSoft}"/>
  <text x="100" y="1312" font-family="Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif" font-size="30" fill="${C.inkSoft}">#工位好物  #桌面改造  #好物分享</text>
  <text x="${w - 100}" y="1312" text-anchor="end" font-family="JetBrains Mono, Consolas, monospace" font-size="24" fill="${C.inkFaint}">1080 × 1440 · 0${index}/0${total}</text>
</svg>
`;
}

const MAIN = [
  { label: '主图 · 白底磁吸特写', hint: '磁吸即充 · 贴上就开始充电' },
  { label: '场景图 · 通勤地铁', hint: '早高峰边充边刷 · 不用找线' },
  { label: '卖点图 · 22.5W 快充数据', hint: '午休半小时 · 回血 60%' },
  { label: '细节图 · 198g 轻量对比', hint: '198g · 比一瓶矿泉水还轻' },
  { label: '包装图 · 全家福', hint: '充电宝 + 磁吸环 + 双向 C 口线' },
];

const XHS = [
  { label: '封面 · 前后对比', hint: '桌面从缠成一团到一排整齐' },
  { label: '内页 · 磁吸特写', hint: '线一放就固定住 · 拔插单手完成' },
  { label: '内页 · 桌面实拍', hint: '无痕胶固定 · 撕下不留残胶' },
  { label: '内页 · 3 根线固定演示', hint: '一次固定 3 根 · 桌面瞬间清爽' },
];

mkdirSync(OUT_DIR, { recursive: true });

MAIN.forEach((m, i) => {
  const file = join(OUT_DIR, `placeholder-main-${i + 1}.svg`);
  writeFileSync(file, mainImage({ index: i + 1, total: MAIN.length, ...m }), 'utf8');
  console.log('wrote', file);
});

XHS.forEach((m, i) => {
  const file = join(OUT_DIR, `placeholder-xhs-${i + 1}.svg`);
  writeFileSync(file, xhsImage({ index: i + 1, total: XHS.length, ...m }), 'utf8');
  console.log('wrote', file);
});
