/* ==========================================================================
   粒子特效共享工具（2026-10-11）
   --------------------------------------------------------------------------
   适配参考实现时需要抽出两件事：
   1. 设备性能分级 —— 参考实现写死 12500 个粒子，低配笔记本会吃力；
   2. 确定性伪随机 —— 参考实现到处用 Math.random()，
      导致每次刷新星云形状与粒子字形都不同（面试官看到的画面不稳定）。

   注：本页 M1/M5 已确认走原生 Canvas 2D（参考实现即如此，零依赖、无需 three.js），
   故这里不再做 WebGL 探测，只保留 2D 上下文探测。
   ========================================================================== */

/** 2D 上下文是否可用（不可用则隐藏画布，露出 CSS 背景） */
export function canUseCanvas2D() {
  try {
    return !!document.createElement('canvas').getContext('2d');
  } catch {
    return false;
  }
}

/**
 * 设备性能分级：'high' | 'mid' | 'low'
 * 判据保守（宁可少画也不要卡）：核心数 / 设备内存 / DPR / 屏幕面积 / 是否触屏。
 */
export function detectTier() {
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;   // GB，仅 Chromium 提供
  const dpr = window.devicePixelRatio || 1;
  const area = window.innerWidth * window.innerHeight;
  const coarse = matchMedia('(pointer: coarse)').matches;

  let score = 0;
  if (cores >= 8) score += 3; else if (cores >= 4) score += 2; else score += 1;
  if (mem >= 8) score += 3; else if (mem >= 4) score += 2; else score += 1;
  if (dpr <= 1.5) score += 2; else if (dpr <= 2) score += 1;
  if (area <= 1920 * 1080) score += 2; else if (area <= 2560 * 1440) score += 1;
  if (coarse) score -= 1;                    // 移动端保守一档

  if (score >= 9) return 'high';
  if (score >= 6) return 'mid';
  return 'low';
}

/**
 * 确定性伪随机（mulberry32）。
 * 每次调用传入固定 seed，即可在 resize 后复现同一分布，
 * 取代参考实现里的 Math.random()。
 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由整数下标得到稳定哈希（用于逐像素抽样，与遍历顺序无关） */
export function hashIndex(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** 按分级取粒子数量 */
export function pickCount(tier, high, mid, low) {
  if (tier === 'high') return high;
  if (tier === 'mid') return mid;
  return low;
}

/** 按分级取 DPR 上限（Canvas 2D 下 DPR 是主要性能旋钮） */
export function pickDprCap(tier) {
  if (tier === 'high') return 1.5;
  if (tier === 'mid') return 1.25;
  return 1;
}
