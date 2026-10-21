/**
 * 【新增组件前置声明】（沙盒新手引导 GuideTour）
 *
 * 1. 现有组件为何不行：查过组件注册表（docs/规范/01_UI设计与组件规范_0916.md §3），已注册的可复用
 *    交互组件只有 Modal / Empty / Btn / Tabs / Avatar / Glyph。
 *    - Modal（components/ui.tsx）是「居中的对话框」：自带 fixed inset-0 全屏遮罩 + 居中卡片，且自带
 *      Esc/点遮罩关闭语义；而本组件需要的是**非居中的锚点浮层**——气泡必须贴着被高亮元素的矩形定位
 *      （上/下/左/右择一），并且遮罩必须是**挖了洞的**（高亮目标要从遮罩里透出来且可被看清）。
 *      Modal 的 API 没有「锚点矩形」「挖洞」这两个概念，强行复用要么把 Modal 的遮罩改成可穿透
 *      （会改坏所有既有弹窗），要么在 Modal 里塞一个绝对定位气泡（Modal 卡片本身仍是白底居中，遮罩照样盖住目标）。
 *    - 因此本浮层按 G2「确无既有组件可复用」的情形自绘，但**内部按钮仍一律复用 Btn**，不自造按钮。
 * 2. 复用范围：至少 2 处 —— （a）沙盒工作台首次进入的自动引导；（b）右下角「▶ 重看引导」重播。
 *    此外它已按「步骤目标 = CSS 选择器」数据驱动，后续任何新页面（如星图/热点改版）加一步只需加一条配置。
 * 3. 是否应提升为通用组件：暂否。它当前只在沙盒模式（?sandbox=1 / VITE_SANDBOX=1）挂载一次，
 *    且步骤文案与工作台主线强耦合；等出现第二个消费方（如后台引导、新功能 spotlight）再上提到 components/。
 *
 * 设计约束落地：颜色只用 var(--color-*) 令牌；圆角只有 0 / 4px；间距为 4 的倍数；
 * 动效含 prefers-reduced-motion 降级（见本文件内 <style> 的媒体查询）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Btn } from '../components/ui.tsx';

/* ===================== 沙盒模式判定 ===================== */

/**
 * 沙盒模式判定（兼容三种写法，任一命中即视为沙盒）：
 *  1. 构建期环境变量 VITE_SANDBOX === '1'
 *  2. URL 参数 ?sandbox=1
 *  3. URL 参数 ?demo=1（沙盒演示别名）
 * 另外支持 ?guide=1 单独开启引导（用于引导自身的联调/走查，不依赖沙盒数据层是否就绪）。
 * 非沙盒模式下 GuideTour 组件直接不渲染任何 DOM —— 这是「不影响正式工作台」的硬保证。
 */
export function isSandboxMode(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('guide') === '1') return true; // 单独开启引导（走查用）
  if (q.get('sandbox') === '1' || q.get('demo') === '1') return true;
  try {
    if (import.meta.env.VITE_SANDBOX === '1') return true;
  } catch {
    /* 非 Vite 环境（如纯 Node 测试）读不到 import.meta.env：忽略 */
  }
  return false;
}

/* ===================== 引导步骤定义 ===================== */

/** 高亮目标定位方式：bySelector 用 CSS 选择器；byText 用「元素文本」（避免踩到别人组件里的中文，只读不改） */
type Target =
  | { kind: 'selector'; selector: string }
  | { kind: 'text'; container: string; text: string };

interface GuideStep {
  /** 步骤标题（用户视角，不是给面试官看的说明文） */
  title: string;
  /** 说明 1-2 句，第二人称 */
  body: string;
  /** 高亮目标 */
  target: Target;
  /** 若目标此时不在视野内，可先执行一次「带路」动作（如切到对应视图），再等目标出现 */
  goto?: () => void;
  /** 找不到目标时的兜底文案（默认：自动跳过该步） */
  missHint?: string;
}

/** 气泡尺寸估算（用于计算避让与是否放得下；实际尺寸由 CSS max-width 约束，这里是保守上界） */
const BUBBLE_W = 320;
const BUBBLE_H = 184;
/** 高亮框与目标元素之间的呼吸间隙 */
const PAD = 6;
/** 气泡与高亮框之间的间隙 */
const GAP = 12;

/**
 * 左栏导航项的文本定位（左栏元素带 Glyph 图标 + 文字，选择器无法按中文匹配，故用文本定位）。
 * 容器用 `aside`（不是 `aside .qs-nav-item`）：后者匹配到的是导航项自身，不是容器。
 */
const NAV = (text: string): Target => ({ kind: 'text', container: 'aside', text });
/** 主区按钮的文本定位（工作流名是用户可改的，按文本定位比按样式类稳）。容器 `main` 即容器本身。 */
const MAIN_BTN = (text: string): Target => ({ kind: 'text', container: 'main', text });
/**
 * 看板四列区域（第③步）：BoardView 的列容器是「main 内唯一横向超出的 flex 容器」，
 * 用属性选择器锁定它，避免依赖 BoardView 里随时会调的样式类。
 * 实测：看板视图下匹配 1 个，包含四个 section（规划中/进行中/待确认/已完成）。
 */
const BOARD_COLUMNS: Target = { kind: 'selector', selector: 'main div.overflow-x-auto' };
/**
 * 任务卡片（第④步）：TaskCard 渲染为 <article class="qs-card ..." title="查看详情">，
 * 用 article[title="查看详情"] 锁定，不依赖卡片内部随时会改的布局类。实测：有任务时匹配 N 张。
 */
const TASK_CARD: Target = { kind: 'selector', selector: 'main article[title="查看详情"]' };

/**
 * 5 步主线（覆盖：看热点 → 派活 → 看进度 → 验收产出 → 查资料来路）。
 * 选择器均已在本机真实运行页面上逐个 querySelector 验证过（见交付报告的实测输出）。
 *
 * 锚点选取原则：优先按「用户能看懂的控件文本」定位（工作流名/标题都是用户可改的），
 * 而非按易变的样式类；文本定位只用于「找元素」，点击走真实 click（不改任何业务组件）。
 */
const STEPS: GuideStep[] = [
  {
    title: '第一步 · 先看看今天有什么值得做',
    body: '选题不用自己憋。点进「每日热点」，它会从多个热榜源聚合当下流行什么，AI 再替你分成「产出方向 / 可参考 / 无关」三组；看到中意的，一键就能收进灵感库。',
    target: NAV('每日热点'),
  },
  {
    title: '第二步 · 把选题派给 AI 团队',
    body: '选好题就点这里派活：写清标题、勾好平台、传一张参考图，剩下的交给 AI 团队。想换条产线，可以在左栏切换工作流后再建。',
    target: MAIN_BTN('＋ 新建任务'),
  },
  {
    title: '第三步 · 看 AI 干到哪一步了',
    body: '派完活回到任务看板，每条任务都实时标着卡在哪个阶段——规划中、进行中、待确认、已完成。轮到该你拍板时，卡片会亮起边框等你确认。',
    target: BOARD_COLUMNS,
  },
  {
    title: '第四步 · 验收 AI 交出来的东西',
    body: '点开任意一张任务卡，默认就落在「内容交付」这一栏：文案和图片逐条过目，满意的采纳，不满意的打回重做，AI 会按你的意见重新产出。',
    target: TASK_CARD,
    // 沙盒里若一张任务卡都没有，这步没有可高亮的对象 —— 明确告知并自动略过，不硬指空气
    missHint: '（沙盒里此刻还没有任务卡，这一步先略过；等有任务了再点开卡片就能验收）',
  },
  {
    title: '第五步 · AI 的参考资料从哪来',
    body: 'AI 写文案会参考品牌规范、技能库和灵感库。沙盒可以浏览现有资料；上传和拆解等写入操作已冻结。',
    target: NAV('知识库'),
  },
  {
    title: '第六步 · 认识右侧 AI 团队',
    body: '右侧头像对应美美（文案）、平平（设计师）和波波（主管），点击可查看各自的对话记录。沙盒聊天输入已冻结。',
    target: { kind: 'selector', selector: '[data-sandbox-ai-team]' },
  },
];

/* ===================== 带路动作（点击真实界面，不改任何业务组件） ===================== */

/**
 * 在容器内按可见文本找元素（文本匹配只用于「找」，点击走真实 click）。
 *
 * ⚠️ 踩坑记录：containerSel 必须是**容器**，不能写成目标元素自身的类选择器。
 *    例：左栏导航项自身就是 `aside .qs-nav-item`，若把它当容器再往里找 button，
 *    会得到 0 个候选（它内部没有 button），表现为「目标永远找不到 → 该步被跳过」。
 *    正确写法是容器 `aside`、再在其内按文本找。
 */
export function findByText(containerSel: string, text: string): HTMLElement | null {
  const root = document.querySelector(containerSel);
  if (!root) return null;
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, '');
  const want = norm(text);
  const nodes = [...root.querySelectorAll<HTMLElement>('button, a, [role="button"]')];
  return nodes.find((el) => norm(el.textContent) === want) ?? nodes.find((el) => norm(el.textContent).includes(want)) ?? null;
}

/** 解析某一步的目标元素（导出以便自动化测试复用同一套定位逻辑） */
export function resolveTarget(t: Target): HTMLElement | null {
  if (t.kind === 'selector') return document.querySelector<HTMLElement>(t.selector);
  return findByText(t.container, t.text);
}

/* ===================== 组件主体 ===================== */

/** localStorage 记忆键：刷新不重复弹；「▶ 重看引导」会清掉它并重播 */
const SEEN_KEY = 'wb.guideTour.seen';
/** 等待目标出现的总时长（轮询）；首屏慢渲染时给足余量，超时才算「元素不存在」并跳过 */
const WAIT_MS = 5000;
const WAIT_TICK = 120;

/** 高亮矩形（视口坐标） */
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * 新手引导浮层（聚光灯 + 气泡）。
 * - open=false 时返回 null：非沙盒模式 / 已看过且未重播 → 一个 DOM 节点都不渲染。
 * - 目标不存在 → 自动跳过该步（不报错、不卡死）。
 */
export function GuideTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  /** 当前高亮矩形；null = 本步没有目标（整屏提示，无聚光灯） */
  const [rect, setRect] = useState<Rect | null>(null);
  /** 当前步是否正在等目标出现（用于给用户一个「正在定位」的安心反馈） */
  const [locating, setLocating] = useState(false);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const timerRef = useRef<number | null>(null);

  const step = STEPS[index] ?? null;

  /** 收尾：标记已看过 + 关闭（跳过 / 开始体验 共用） */
  const finish = useCallback(
    (markSeen: boolean) => {
      if (markSeen) {
        try {
          window.localStorage.setItem(SEEN_KEY, '1');
        } catch {
          /* 隐私模式等写入失败：不影响本次关闭 */
        }
      }
      onClose();
    },
    [onClose],
  );

  /**
   * 定位当前步骤的目标：滚动到视野内 → 量矩形。
   * 统一走「轮询等待目标出现」这一条路径（不做同步首测），原因：
   *   引导可能在首屏数据尚未渲染完时启动（React 挂载瞬间 aside/main 还可能是空壳），
   *   同步首测会拿到 null 并误判为「元素不存在」，把第①步直接跳过（实测踩过）。
   *   统一轮询后，元素早到就早命中、晚到就等着，找不到（超时）才跳过，行为确定。
   */
  useEffect(() => {
    if (!open || !step) return;
    let cancelled = false;

    const apply = (el: HTMLElement) => {
      // 滚动到视野内（block:center 让目标尽量落在中央，气泡更好摆）
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      // smooth 滚动过程中矩形会变，故稍后再量一次补正
      const measure = () => {
        if (cancelled) return;
        setRect(rectOf(el));
      };
      measure();
      window.setTimeout(measure, 260);
    };

    setRect(null);
    setLocating(true);

    let gotoDone = false;
    const started = Date.now();
    const tick = () => {
      if (cancelled) return;
      const el = resolveTarget(step.target);
      if (el) {
        window.clearInterval(timerRef.current!);
        timerRef.current = null;
        setLocating(false);
        apply(el);
        return;
      }
      // 目标还没出现：执行一次带路动作（如切回看板），再继续等
      if (!gotoDone && step.goto) {
        gotoDone = true;
        step.goto();
      }
      if (Date.now() - started > WAIT_MS) {
        window.clearInterval(timerRef.current!);
        timerRef.current = null;
        setLocating(false);
        // 元素确实不存在 → 跳过该步（不报错）：还有下一步就前进，没有就收尾
        if (index < STEPS.length - 1) setIndex((n) => n + 1);
        else finish(true);
      }
    };
    tick();
    if (timerRef.current == null && !cancelled) {
      // tick 内部若已命中会清空 timerRef；此处仅在未命中时挂上轮询
      timerRef.current = window.setInterval(tick, WAIT_TICK);
    }

    return () => {
      cancelled = true;
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, step]);

  /** 视口尺寸（窗口变化 / 目标滚动后重新摆位） */
  useEffect(() => {
    if (!open) return;
    const sync = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [open]);

  /** 键盘：Esc = 跳过，← → = 上一步/下一步 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, finish]);

  const goNext = () => {
    if (index >= STEPS.length - 1) {
      finish(true);
      return;
    }
    setIndex((n) => n + 1);
  };
  const goPrev = () => setIndex((n) => Math.max(0, n - 1));

  if (!open || !step) return null;

  const vw = vp.w || (typeof window === 'undefined' ? 1280 : window.innerWidth);
  const vh = vp.h || (typeof window === 'undefined' ? 800 : window.innerHeight);

  // 高亮框：clamp 到视口内，避免目标半出屏时框跑出去
  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        right: Math.min(vw, rect.left + rect.width + PAD),
        bottom: Math.min(vh, rect.top + rect.height + PAD),
      }
    : null;

  /** 气泡位置：优先放下方，放不下放上方，再不行放右侧/左侧；最后 clamp 进视口 */
  const bubblePos = ((): CSSProperties => {
    if (!hole) {
      // 无目标：整屏居中偏上（教学位）
      return { top: Math.max(24, Math.round(vh * 0.18)), left: Math.max(16, Math.round((vw - BUBBLE_W) / 2)) };
    }
    const belowTop = hole.bottom + GAP;
    const aboveTop = hole.top - GAP - BUBBLE_H;
    let top: number;
    if (belowTop + BUBBLE_H <= vh - 16) top = belowTop;
    else if (aboveTop >= 16) top = aboveTop;
    else top = Math.min(Math.max(16, hole.bottom + GAP), Math.max(16, vh - BUBBLE_H - 16));
    let left = hole.left;
    if (left + BUBBLE_W > vw - 16) left = vw - 16 - BUBBLE_W;
    left = Math.max(16, left);
    return { top, left };
  })();

  // 聚光灯：用 4 块矩形遮罩拼出「洞」，比 clip-path 兼容性更稳（老浏览器也支持）
  const maskStyle: CSSProperties = {
    position: 'fixed',
    // ui-rules-ignore 遮罩半透明层：引导遮罩必须压暗背景，令牌表无「蒙层」色，故用主色 ink 的合法 rgba 表达（规范允许的浮层例外）
    background: 'rgba(10,10,10,0.55)',
    zIndex: 80,
  };
  const masks = hole
    ? [
        { top: 0, left: 0, width: vw, height: hole.top },
        { top: hole.bottom, left: 0, width: vw, height: Math.max(0, vh - hole.bottom) },
        { top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top },
        { top: hole.top, left: hole.right, width: Math.max(0, vw - hole.right), height: hole.bottom - hole.top },
      ]
    : [{ top: 0, left: 0, width: vw, height: vh }];

  return (
    <div className="qs-guide-root" data-guide-tour aria-live="polite">
      <style>{GUIDE_CSS}</style>
      {/* 遮罩（点遮罩不关闭：引导是分步教学，误触关闭会让用户以为「点坏了」） */}
      {masks.map((m, i) => (
        <div key={i} style={{ ...maskStyle, top: m.top, left: m.left, width: m.width, height: m.height }} />
      ))}
      {/* 高亮描边：给目标一个清晰边界（不拦截点击：pointerEvents none，保证引导期间目标仍可被看清） */}
      {hole ? (
        <div
          className="qs-guide-hole"
          style={{
            position: 'fixed',
            top: hole.top,
            left: hole.left,
            width: hole.right - hole.left,
            height: hole.bottom - hole.top,
            zIndex: 81,
            border: '2px solid var(--color-signal)',
            borderRadius: 4,
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* 气泡卡片 */}
      <div
        className="qs-guide-bubble qs-card"
        data-guide-bubble
        data-guide-step={index + 1}
        data-guide-total={STEPS.length}
        style={{
          position: 'fixed',
          ...bubblePos,
          width: BUBBLE_W,
          zIndex: 82,
          padding: 16,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line-strong)',
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="qs-meta tabular" style={{ color: 'var(--color-signal-strong)' }}>
            {index + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            className="qs-clickable qs-meta"
            style={{ color: 'var(--color-ink-faint)' }}
            onClick={() => finish(true)}
            title="跳过引导"
          >
            跳过
          </button>
        </div>

        <h3
          className="font-display mt-2 text-[15px] font-semibold leading-snug"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {step.title}
        </h3>
        <p className="qs-meta mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-ink-soft)' }}>
          {step.body}
        </p>
        {locating ? (
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            正在带你找到它…
          </p>
        ) : null}
        {!locating && !rect && step.missHint ? (
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            {step.missHint}
          </p>
        ) : null}
        {!locating && !rect && !step.missHint ? (
          <p className="qs-meta mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            （这一步在演示沙盒里没有对应元素，已自动略过）
          </p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          {index > 0 ? (
            <Btn size="sm" variant="ghost" onClick={goPrev}>
              上一步
            </Btn>
          ) : null}
          <div className="flex-1" />
          {index < STEPS.length - 1 ? (
            <Btn size="sm" variant="primary" onClick={goNext}>
              下一步
            </Btn>
          ) : (
            <Btn size="sm" variant="primary" onClick={() => finish(true)}>
              开始体验
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===================== 引导浮层样式（含 reduced-motion 降级） ===================== */

const GUIDE_CSS = `
/* 遮罩与气泡的出现动效：轻微淡入，不做位移动画（避免「晃眼」） */
.qs-guide-root { position: fixed; inset: 0; z-index: 80; }
.qs-guide-bubble { animation: qs-guide-in var(--dur-standard) var(--ease-standard); }
.qs-guide-hole { animation: qs-guide-in var(--dur-fast) var(--ease-standard); }
@keyframes qs-guide-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  /* 降级：取消所有入场动效与滚动平滑，直接呈现终态 */
  .qs-guide-bubble, .qs-guide-hole { animation: none; }
  .qs-guide-root * { transition: none !important; }
}
`;

/* ===================== 重看入口（引导结束后常驻的小按钮） ===================== */

/**
 * 右下角「▶ 重看引导」入口（不打扰：小字、低对比、hover 才强调）。
 * 与 Toast 堆叠（z-70）错开：本入口放在左下角，避免与右下角 Toast 打架。
 */
export function GuideReplayButton({ onReplay }: { onReplay: () => void }) {
  return (
    <button
      type="button"
      className="qs-clickable qs-meta fixed z-[60] rounded-[4px] border px-3 py-1.5"
      data-guide-replay
      style={{
        left: 16,
        bottom: 16,
        background: 'var(--color-surface)',
        borderColor: 'var(--color-line)',
        color: 'var(--color-ink-soft)',
        transition: 'border-color var(--dur-fast) var(--ease-standard)',
      }}
      onClick={onReplay}
      title="重新播放新手引导"
    >
      ▶ 重看引导
    </button>
  );
}
