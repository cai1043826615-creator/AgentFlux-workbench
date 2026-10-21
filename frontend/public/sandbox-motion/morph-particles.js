/* ==========================================================================
   M1/M5 共用｜粒子汇聚特效（2026-10-11）
   --------------------------------------------------------------------------
   用户定案：首页与尾页**使用同一套效果**（原「旋臂星云」方案废弃）。
   本模块由原 closing-morph.js 泛化而来，首页与尾页各挂载一次，靠参数区分：

   · 尾页：normal 色调、无对齐目标（标题文字已按用户要求删除）
           → 按画布比例成形，scale 1.2（放大 20%）
           → surround = true（四周环绕粒子，填充画面）
   · 首页：light 色调（用户要求「调浅一点」）
           → 对齐真实 HTML 标题 #hero-title，粒子作为标题背后的光晕

   算法来源：用户 2026-10-11 提供的参考实现
   · makeTargets()：离屏 Canvas 画字 → 逐像素采样 alpha>100 得到目标点
   · ease()：三次缓动（前段 4x³、后段 1-(-2x+2)³/2）
   · 逐粒子 delay 错开汇聚时刻，swirl=(1-q)*.15 制造残余旋转
   · 鼠标斥力用**阻尼弹簧**（desired → vx/vy 累加 → *0.82 衰减），手感自然
   · 三色粒子：i%9 深蓝 / i%4 亮蓝 / 其余中蓝

   本项目在参考实现基础上的必要适配：
   1. 确定性抽样（hashIndex 取代 Math.random()），保证每次刷新字形一致；
   2. 设备分级（high/mid/low）控制粒子数与 DPR 上限；
   3. prefers-reduced-motion → 直接渲染终态，不播放聚合过程；
   4. 离开视口 / 页面隐藏 → 停止 rAF；
   5. 边缘渐隐（周围粒子不做硬裁，避免出现可见边界）；
   6. 首页 light 色调 + 对齐 HTML 标题。

   ── 2026-10-11 二次改造：全参数可调（首页滑动条面板）───────────────────
   原实现里上述手感参数全是**硬编码常量**，无法在不改代码的情况下调整。
   现全部提升为 options，默认值 = 原硬编码值（**尾页观感零变化**），
   并由 scripts/motion/hero-tuner.js 的面板实时改写。

   运行期接口（cleanup 函数上挂载，供面板使用）：
   · api.update(patch)  局部改参数；结构类参数会自动重建粒子并重播
   · api.replay()       按当前参数重播一次汇聚
   · api.getConfig()    取当前生效参数快照（面板初始化 / 复制 JSON）
   注意：返回值仍是函数，调用方（motion-init 的 safeMount）按 cleanup 使用不受影响。
   ========================================================================== */

import { canUseCanvas2D, detectTier, hashIndex, pickCount, pickDprCap } from './device.js';

/** Canvas 色彩统一从工作台令牌读取；非浏览器环境用 transparent 降级。 */
const readCssToken = (name) => {
  if (typeof document === 'undefined') return 'transparent';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || 'transparent';
};

const PARTICLE_TOKENS = {
  signal: readCssToken('--color-signal'),
  strong: readCssToken('--color-signal-strong'),
  light: readCssToken('--color-signal-light'),
  pale: readCssToken('--color-signal-pale'),
  soft: readCssToken('--color-signal-soft'),
  line: readCssToken('--color-line-strong'),
  inverse: readCssToken('--color-inverse'),
};

/** 色调预设：light 用于首页（更浅、更淡），normal 用于尾页 */
const TONES = {
  light: {
    alphaScale: 0.60,          // 整体透明度压到 6 成 → 「调浅一点」但仍看得见
    textColor: (i) => (i % 9 === 0 ? PARTICLE_TOKENS.signal : i % 4 === 0 ? PARTICLE_TOKENS.light : PARTICLE_TOKENS.pale),
    ambientColor: (i) => (i % 6 === 0 ? PARTICLE_TOKENS.light : PARTICLE_TOKENS.soft),
  },
  normal: {
    alphaScale: 1,
    textColor: (i) => (i % 9 === 0 ? PARTICLE_TOKENS.strong : i % 4 === 0 ? PARTICLE_TOKENS.signal : PARTICLE_TOKENS.light),
    ambientColor: (i) => (i % 6 === 0 ? PARTICLE_TOKENS.signal : PARTICLE_TOKENS.line),
  },
};

/**
 * 全部可调参数与出厂默认值。
 * 默认值即 2026-10-11 定稿观感 —— 改这里的数值等于改默认效果。
 * alphaScale 为 null 表示「跟随色调预设」（首页 light 0.60 / 尾页 normal 1）。
 */
export const MORPH_DEFAULTS = {
  text: 'AgentFlux.',
  anchorSelector: null,
  scale: 1,
  centerXRatio: 0.5,
  centerYRatio: 0.44,
  centerXOffset: 0,      // 成形中心水平偏移 px（叠加在锚点 / 比例之上）
  centerYOffset: 0,      // 成形中心垂直偏移 px
  tone: 'normal',
  surround: false,
  mouseRepel: true,
  protectSelectors: [],
  /* ── 以下为手感参数（面板滑动条逐个对应）────────────────────────────── */
  alphaScale: null,      // 整体透明度（null = 跟随色调）
  density: 1,            // 成形粒子密度倍率
  ambientDensity: 1,     // 环绕粒子密度倍率
  duration: 4100,        // 汇聚时长 ms
  spread: 0.68,          // 起点散布半径（× 画布长边）
  swirl: 0.15,           // 残余旋转强度
  wobble: 14,            // 汇聚途中摆动幅度 px
  wobbleSpeed: 1,        // 摆动速度倍率
  delaySpread: 0.3,      // 逐粒子错峰范围
  converge: 0.83,        // 收敛窗口（越小越早成形）
  particleSize: 1,       // 成形粒子尺寸倍率
  ambientSize: 1,        // 环绕粒子尺寸倍率
  ambientAlpha: 1,       // 环绕粒子亮度倍率
  edgeFade: 150,         // 边缘渐隐带宽 px
  protectPad: 16,        // 文字保护区外扩 px
  protectSoft: 64,       // 文字保护区柔化带 px
  protectMin: 0,         // 保护区内粒子的最低保留不透明度（0 = 完全避让，1 = 不衰减）
  repelRadius: 155,      // 鼠标斥力半径 px
  repelForce: 45,        // 鼠标斥力力度
  spring: 0.065,         // 斥力弹簧刚度
  damping: 0.82,         // 斥力阻尼（越小回弹越快）
  fps: 40,               // 帧率上限
};

/** 改这些参数必须重建粒子（目标点 / 粒子池 / 事件绑定依赖它们） */
const STRUCTURAL_KEYS = new Set([
  'text', 'anchorSelector', 'scale', 'centerXRatio', 'centerYRatio',
  'centerXOffset', 'centerYOffset',
  'tone', 'surround', 'mouseRepel', 'density', 'ambientDensity', 'spread',
]);

/**
 * 挂载粒子汇聚特效。
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options] 见 MORPH_DEFAULTS
 * @returns {() => void} cleanup（同时挂 update / replay / getConfig）
 */
export function mountMorphParticles(canvas, options = {}) {
  if (!canvas) return () => {};
  const cfg = { ...MORPH_DEFAULTS, ...options };
  let palette = TONES[cfg.tone] || TONES.normal;

  if (!canUseCanvas2D()) {
    canvas.classList.add('is-fallback');
    return () => {};
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.classList.add('is-fallback'); return () => {}; }

  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const tier = detectTier();
  const dprCap = pickDprCap(tier);

  /** 画布容器：用于挂载鼠标事件（默认用 canvas 自身） */
  const container = canvas.parentElement || canvas;

  let CW = 0, CH = 0;
  let particles = [];
  let ambient = [];
  let startTime = 0;
  let started = false;
  /** 上一次绘制使用的汇聚进度时刻（相对 startTime）—— 面板改参数后补帧时复用它 */
  let lastElapsed = 0;

  /** 生效透明度：alphaScale 为 null 时跟随色调预设 */
  const effAlphaScale = () => (cfg.alphaScale == null ? palette.alphaScale : cfg.alphaScale);

  const mouse = { x: -9999, y: -9999, active: false };

  /** 0 = 接近画布边缘（不可见），1 = 画面深处；用于环绕粒子渐隐 */
  function edgeFade(x, y) {
    const band = cfg.edgeFade;
    if (band <= 0) return 1;
    const d = Math.min(x, CW - x, y, CH - y);
    if (d >= band) return 1;
    if (d <= 0) return 0;
    const t = d / band;
    return t * t * (3 - 2 * t);
  }

  /* ── 文字保护带 ──────────────────────────────────────────────────────────
     首页效果放在右侧、粒子会环绕整块画面，若不保护就会飘到左侧标题上。
     量测 protectSelectors 指定的元素矩形，落在其中的粒子按距离平滑衰减，
     边缘 SOFT 带宽内过渡，看起来像粒子"自然避开"文字而不是被切成方块。 */
  let protectRects = [];

  function measureProtectRects() {
    if (!cfg.protectSelectors || !cfg.protectSelectors.length) { protectRects = []; return; }
    const cr = canvas.getBoundingClientRect();
    protectRects = [];
    for (const sel of cfg.protectSelectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      protectRects.push({
        x0: r.left - cr.left - cfg.protectPad,
        y0: r.top - cr.top - cfg.protectPad,
        x1: r.right - cr.left + cfg.protectPad,
        y1: r.bottom - cr.top + cfg.protectPad,
      });
    }
  }

  /**
   * 1 = 不受保护；protectMin = 完全位于保护区内。
   * protectMin 让保护区内不再"归零"：首页用它把标题一带的粒子压成半透明保留，
   * 使左侧的字母 A 以淡字形透出（默认 0 = 原来的完全避让行为，尾页不受影响）。
   */
  function protectionAt(x, y) {
    let keep = 1;
    const soft = Math.max(cfg.protectSoft, 0.001);
    const min = Math.min(Math.max(cfg.protectMin, 0), 1);
    for (let i = 0; i < protectRects.length; i++) {
      const r = protectRects[i];
      const dx = Math.max(r.x0 - x, 0, x - r.x1);
      const dy = Math.max(r.y0 - y, 0, y - r.y1);
      const d = Math.hypot(dx, dy);
      const t = soft <= 0 ? (d > 0 ? 1 : 0) : (d >= soft ? 1 : d / soft);
      const v = min + (1 - min) * t;   // 把 [0,1] 映射到 [min,1]
      if (v < keep) keep = v;
    }
    return keep;
  }

  /**
   * 采样文字目标点 + 建立粒子起点。
   * 关键差异：有 anchorSelector 时按真实元素矩形对齐（首页），
   * 否则按画布比例（尾页，标题已删除）。
   * @param {boolean} [restart] 是否把汇聚进度归零。初始化 / resize / 重播为 true；
   *   面板拖动结构参数时传 false —— 否则每拖一格都会闪回起点重播，无法调参。
   */
  function makeTargets(restart = true) {
    const isLight = cfg.tone === 'light';
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    CW = canvas.clientWidth;
    CH = canvas.clientHeight;
    if (!CW || !CH) return;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 先量文字保护带，再算目标点（两者都依赖最新布局）
    measureProtectRects();

    /* 粒子池规模：色调分级 × 面板密度倍率。
       下限 200 防止面板拉到极小后画面上什么都看不到（看起来像坏了）。 */
    const maxTextParticles = Math.max(200, Math.round(
      (isLight ? pickCount(tier, 6500, 4200, 2400) : pickCount(tier, 11000, 7000, 3800)) * cfg.density
    ));
    const ambientCount = cfg.surround
      ? Math.max(0, Math.round(pickCount(tier, 3200, 2000, 1100) * cfg.ambientDensity))
      : 0;

    let targetW = CW * 0.70 * cfg.scale;
    let centerX = CW * cfg.centerXRatio + cfg.centerXOffset;
    let centerY = CH * cfg.centerYRatio + cfg.centerYOffset;

    if (cfg.anchorSelector) {
      const anchor = document.querySelector(cfg.anchorSelector);
      if (anchor) {
        const cr = canvas.getBoundingClientRect();
        const ar = anchor.getBoundingClientRect();
        if (ar.width && ar.height) {
          targetW = ar.width * cfg.scale;
          centerX = ar.left - cr.left + ar.width / 2 + cfg.centerXOffset;
          centerY = ar.top - cr.top + ar.height / 2 + cfg.centerYOffset;
        }
      }
    }

    const off = document.createElement('canvas');
    off.width = Math.round(CW);
    off.height = Math.round(CH);
    const c = off.getContext('2d', { willReadFrequently: true });
    if (!c) { canvas.classList.add('is-fallback'); return; }

    // 字号自适应：收缩到文字宽度贴合 targetW
    const text = String(cfg.text);
    let fs = Math.min(CH * 0.22, targetW * 0.42);
    c.font = `900 ${fs}px Arial, sans-serif`;
    let guard = 0;
    while (c.measureText(text).width > targetW * 1.02 && fs > 16 && guard < 200) {
      fs -= 2;
      c.font = `900 ${fs}px Arial, sans-serif`;
      guard++;
    }

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = PARTICLE_TOKENS.inverse;
    c.fillText(text, centerX, centerY);

    const data = c.getImageData(0, 0, off.width, off.height).data;
    const step = CW < 700 ? 3 : 3;
    const raw = [];
    for (let y = 0; y < off.height; y += step) {
      for (let x = 0; x < off.width; x += step) {
        const idx = y * off.width + x;
        if (data[idx * 4 + 3] > 100) raw.push(x, y);
      }
    }
    // 空文字用于纯环境粒子场（工作台品牌区）；仍继续生成 surround 粒子，不走 fallback。

    // 确定性抽样（参考实现用 Math.random()>.24，会让每次刷新字形不同）
    const pts = [];
    for (let i = 0; i < raw.length; i += 2) {
      const x = raw[i], y = raw[i + 1];
      if (hashIndex(x * 7919 + y * 104729) > 0.24) pts.push([x, y]);
    }
    let finalPts = pts;
    if (pts.length > maxTextParticles) {
      const stride = Math.ceil(pts.length / maxTextParticles);
      finalPts = pts.filter((_, i) => i % stride === 0);
    }

    // 起点：以画布中心为圆盘的散布
    const seed = 20261011;
    particles = finalPts.map(([tx, ty], i) => {
      const a = hashIndex(i + seed) * Math.PI * 2;
      const r = Math.sqrt(hashIndex(i * 31 + seed)) * Math.max(CW, CH) * cfg.spread;
      return {
        tx, ty,
        sx: CW / 2 + Math.cos(a) * r,
        sy: CH / 2 + Math.sin(a) * r,
        phase: hashIndex(i * 17 + seed) * 6.283,
        // baseSize：出厂尺寸；实际尺寸 = baseSize × cfg.particleSize（面板可实时改）
        baseSize: (isLight ? 0.6 : 0.7) + hashIndex(i * 23 + seed) * (isLight ? 1.1 : 1.5),
        delay: hashIndex(i * 41 + seed) * cfg.delaySpread,
        vx: 0, vy: 0, ox: 0, oy: 0,
      };
    });

    /* 四周环绕粒子（用户要求「四周也要有粒子效果环绕，要不然画面太空了」）：
       它们不参与成形，只按各自相位缓慢漂浮，铺在画面四周，
       让成形文字周围有持续流动的星尘感。边缘用 edgeFade 渐隐避免硬边。 */
    ambient = new Array(ambientCount);
    for (let i = 0; i < ambientCount; i++) {
      ambient[i] = {
        // 基础位置：覆盖整幅，但对角线方向略微外扩，强化"环绕"的感觉
        bx: hashIndex(i * 3 + 11) * CW,
        by: hashIndex(i * 7 + 23) * CH,
        phase: hashIndex(i * 13 + 37) * 6.283,
        // 漂浮幅度与速度：每颗不同，避免整体同步移动
        amp: 6 + hashIndex(i * 19 + 53) * 22,
        speed: 0.00006 + hashIndex(i * 29 + 71) * 0.00012,
        baseSize: 0.5 + hashIndex(i * 37 + 97) * (isLight ? 1.1 : 1.6),
        baseAlpha: (isLight ? 0.16 : 0.22) + hashIndex(i * 43 + 113) * (isLight ? 0.18 : 0.30),
      };
    }

    if (restart) startTime = performance.now();
  }

  /** 三次缓动（参考实现的 ease） */
  function ease(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function draw(t) {
    ctx.clearRect(0, 0, CW, CH);
    const p = reduce.matches ? 1 : clamp((t - startTime) / Math.max(cfg.duration, 1), 0, 1);
    if (!reduce.matches) lastElapsed = Math.max(0, t - startTime);
    /* reduced-motion 下把时间冻住：
       环绕粒子的漂浮（下面 ambient 的 sin/cos）只依赖 t，不受 p 约束，
       若不冻结时间，即使 p=1 它们也会一直动 —— 实测发现该 bug
       （heroStatic 为 false）。冻结后整幅画面完全静止。 */
    if (reduce.matches) t = 0;

    const alphaScale = effAlphaScale();

    // ── ① 四周环绕粒子（先画，让成形文字压在它们之上）───────────────────
    for (let i = 0; i < ambient.length; i++) {
      const m = ambient[i];
      const drift = Math.sin(t * m.speed + m.phase);
      const x = m.bx + drift * m.amp;
      const y = m.by + Math.cos(t * m.speed * 0.8 + m.phase) * m.amp * 0.8;

      const ef = edgeFade(x, y);
      if (ef <= 0.02) continue;
      // 文字保护带：环绕粒子也不许飘到标题上
      const pf = protectionAt(x, y);
      if (pf <= 0.02) continue;
      // 汇聚过程中环绕粒子略微退让（把视觉重心让给字形），完成后恢复
      const a = m.baseAlpha * cfg.ambientAlpha * ef * pf * (0.72 + 0.28 * p);
      if (a <= 0.004) continue;
      ctx.fillStyle = palette.ambientColor(i);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, m.baseSize * cfg.ambientSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── ② 成形粒子 ──────────────────────────────────────────────────────
    const window0 = Math.max(cfg.converge, 0.01);
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      const q = ease(clamp((p - a.delay) / Math.max(window0 - a.delay, 0.01), 0, 1));
      const swirl = (1 - q) * cfg.swirl;

      const tx = a.sx + (a.tx - a.sx) * q
        + Math.sin(t * 0.001 * cfg.wobbleSpeed + a.phase) * cfg.wobble * swirl;
      const ty = a.sy + (a.ty - a.sy) * q
        + Math.cos(t * 0.0013 * cfg.wobbleSpeed + a.phase) * cfg.wobble * swirl;

      let x = tx;
      let y = ty;

      // 鼠标斥力：软半径 + 阻尼弹簧（参考实现的核心手感来源）
      if (cfg.mouseRepel) {
        const dx = tx - mouse.x;
        const dy = ty - mouse.y;
        const dist = Math.hypot(dx, dy);
        const radius = Math.max(cfg.repelRadius, 1);
        const force = mouse.active ? Math.pow(clamp(1 - dist / radius, 0, 1), 2) : 0;
        const desiredX = dx / (dist + 1) * force * cfg.repelForce * q;
        const desiredY = dy / (dist + 1) * force * cfg.repelForce * q;
        a.vx += (desiredX - a.ox) * cfg.spring;
        a.vy += (desiredY - a.oy) * cfg.spring;
        a.vx *= cfg.damping;
        a.vy *= cfg.damping;
        a.ox += a.vx;
        a.oy += a.vy;
        x += a.ox;
        y += a.oy;
      }

      // 成形后靠边也要渐隐，避免字形被画布硬切
      const ef = edgeFade(x, y);
      if (ef <= 0.02) continue;
      // 文字保护带（首页用；尾页文字已删，不传该参数即不生效）
      const pf = protectionAt(x, y);
      if (pf <= 0.02) continue;

      const alpha = (0.55 + 0.45 * q) * alphaScale * ef * pf;
      if (alpha <= 0.004) continue;
      ctx.fillStyle = palette.textColor(i);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, a.baseSize * cfg.particleSize * (0.75 + q * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ── 交互 ────────────────────────────────────────────────────────────────
  function onPointerMove(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
    mouse.active = true;
  }
  function onPointerLeave() { mouse.active = false; }

  /** 鼠标事件按 cfg.mouseRepel 绑定/解绑（面板可实时切换） */
  let mouseBound = false;
  function syncMouseBinding() {
    if (cfg.mouseRepel && !mouseBound) {
      container.addEventListener('pointermove', onPointerMove, { passive: true });
      container.addEventListener('pointerleave', onPointerLeave);
      mouseBound = true;
    } else if (!cfg.mouseRepel && mouseBound) {
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerleave', onPointerLeave);
      mouseBound = false;
      mouse.active = false;
    }
  }
  syncMouseBinding();

  // ── 循环 ────────────────────────────────────────────────────────────────
  let raf = 0, running = false, last = 0, visible = false;

  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / Math.max(cfg.fps, 1)) return;   // 帧率上限（面板可调）
    last = t;
    draw(t);
  }
  function start() {
    if (running) return;
    running = true;
    last = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // ── 滚动触发：进入视口即开始汇聚 ────────────────────────────────────────
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !started) { started = true; startTime = performance.now(); }
    /* reduced-motion：只画一帧静态终态，不启动 rAF（省电且真正静止）。
       否则即便冻结时间，仍会以 40fps 反复重绘同一画面。 */
    if (reduce.matches) {
      if (visible) draw(0);
      return;
    }
    if (visible && !document.hidden) start(); else stop();
  }, { threshold: 0.08 });
  io.observe(canvas);

  const onVis = () => {
    if (reduce.matches) { if (visible) draw(0); return; }
    if (document.hidden) stop();
    else if (visible) start();
  };
  document.addEventListener('visibilitychange', onVis);

  // ── 尺寸 ────────────────────────────────────────────────────────────────
  let resizeTimer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      makeTargets();
      if (reduce.matches) draw(performance.now() + 99999);
    }, 180);
  });
  ro.observe(canvas);

  makeTargets();
  if (reduce.matches) draw(performance.now() + 99999);

  // ── 运行期接口（面板用）────────────────────────────────────────────────
  /**
   * 局部改参数并立即生效。
   * 结构类参数（尺寸/密度/起点散布/色调/开关）会重建粒子池；
   * 纯手感参数（透明度、尺寸、斥力…）下一帧即生效，不需要重建。
   */
  function update(patch = {}) {
    let rebuild = false;
    for (const key of Object.keys(patch)) {
      if (STRUCTURAL_KEYS.has(key) && cfg[key] !== patch[key]) rebuild = true;
      cfg[key] = patch[key];
    }
    if ('tone' in patch) palette = TONES[cfg.tone] || TONES.normal;
    syncMouseBinding();
    if (rebuild) {
      makeTargets(false);   // 重建粒子池但不闪回起点：画面停在当前进度
    } else if ('protectPad' in patch || 'protectSelectors' in patch) {
      // 保护区依赖 pad，量测矩形要跟着重算（目标点不变，无需重建粒子）
      measureProtectRects();
    }
    /* 参数改完**立即同步重画一帧**，不等下一帧 rAF：
       makeTargets 会重设 canvas.width 把画布清空，而 rAF 在后台标签 / 被浏览器
       节流时可能一秒后才来 —— 实测拖动密度时画面出现约 1.2s 空白（0 像素）。
       同步补帧后空窗消失；rAF 正常时多画一帧，开销可忽略。 */
    if (reduce.matches) draw(0);
    else draw(startTime + lastElapsed);
    return rebuild;
  }

  /** 按当前参数重播一次汇聚（面板「重播」按钮 / 结构参数改完看效果） */
  function replay() {
    if (reduce.matches) { draw(0); return; }
    startTime = performance.now();
    started = false;
    if (visible && !document.hidden) { started = true; start(); }
  }

  function cleanup() {
    stop();
    clearTimeout(resizeTimer);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerleave', onPointerLeave);
    mouseBound = false;
    ctx.clearRect(0, 0, CW, CH);
  }

  cleanup.update = update;
  cleanup.replay = replay;
  /* 面板读参数用：alphaScale 回传**生效值**（null 时跟随色调），
     否则滑条会拿到 null 而不显示当前透明度。 */
  cleanup.getConfig = () => ({ ...cfg, alphaScale: effAlphaScale() });
  return cleanup;
}
