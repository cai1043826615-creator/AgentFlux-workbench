/**
 * UI 规范扫描（提交前强制检查）
 *
 * 用法：node frontend/scripts/check-ui-rules.mjs
 *  - 扫描 git 暂存区中前端源码（frontend/src/**\/*.tsx|*.ts|*.css）的新增行
 *  - 命中违规 → 输出位置与修法并退出码 1（阻止提交）；无命中 → 退出码 0
 *  - 由 .git/hooks/pre-commit 调用；也可手动执行
 *
 * 校验规则来源：项目根 AGENTS.md「二、UI 设计硬约束」+ docs/规范/01_UI设计与组件规范_0908.md
 *
 * 放行机制：行内注释 `ui-rules-ignore`（需写明理由）或 `ui-rules-ignore-next-line`
 */
import { execFileSync } from 'node:child_process';

/** 允许的 CSS 变量前缀与白名单（AGENTS.md 第 2 条） */
const ALLOWED_COLOR_TOKENS = [
  'canvas', 'surface', 'sunken', 'ink', 'ink-soft', 'ink-faint',
  'line', 'line-strong', 'signal', 'signal-strong', 'signal-soft',
  'ok', 'ok-soft', 'warn', 'warn-soft', 'danger', 'danger-soft',
  'space-1', 'space-2', 'space-3', 'space-4', 'space-5', 'space-6',
  'dur-fast', 'dur-standard', 'dur-deliberate', 'ease-standard',
];

const RULES = [
  {
    id: 'R1',
    name: '硬编码颜色（hex）',
    // 命中 #abc / #aabbcc，但排除纯 #fff/#000 之外的一切裸色值
    re: /#[0-9a-fA-F]{3,8}\b/g,
    hint: '改用 var(--color-*) 令牌，令牌表见 frontend/src/index.css @theme',
    allowFile: (f) => /index\.css$/.test(f), // index.css 是令牌定义源，允许
  },
  {
    id: 'R2',
    name: '硬编码半透明黑/白（rgba/rgb）',
    re: /\brgba?\(\s*0\s*,\s*0\s*,\s*0\b|\brgba?\(\s*255\s*,\s*255\s*,\s*255\b/g,
    hint: '改用具名令牌（如 var(--color-sunken)）；遮罩类语义色可用 var(--color-ink) + opacity',
    allowFile: (f) => false,
  },
  {
    id: 'R3',
    name: '非法圆角（只允许 0 或 4px）',
    // rounded-[Npx] / borderRadius: 'Npx'，值为 3/5/6/7/8/9/10 等非 0/4 值
    re: /rounded-\[(\d+)px\]|borderRadius:\s*['"](\d+)px['"]/g,
    hint: '大结构用 0（qs-card 直角），小控件用 4px；pill 仅限极短状态标签',
    allowFile: (f) => false,
    validate: (m) => {
      const n = Number(m[1] ?? m[2]);
      return n !== 0 && n !== 4; // 仅 0 与 4 合规
    },
  },
  {
    id: 'R4',
    name: '非 4 倍数间距（写死的 px）',
    // padding/margin/gap 的裸 px 值
    re: /\b(?:padding|margin|gap|paddingTop|paddingBottom|paddingLeft|paddingRight|marginTop|marginBottom|marginLeft|marginRight)(?:Top|Bottom|Left|Right)?:\s*['"]?(\d+)px/g,
    hint: '间距用 4 的倍数并优先引用 var(--space-1..6)',
    allowFile: (f) => false,
    validate: (m) => Number(m[1]) % 4 !== 0,
  },
];

/** 行内放行：本行或上一行含忽略标记 */
function isIgnored(lines, idx) {
  const cur = lines[idx] ?? '';
  const prev = lines[idx - 1] ?? '';
  return /ui-rules-ignore/.test(cur) || /ui-rules-ignore-next-line/.test(prev);
}

let failed = false;
let scanned = 0;

/** 扫描单个补丁文本 */
function scanPatch(file, patch) {
  // 只取新增行（以 + 开头，排除 +++ 文件头）
  const lines = patch.split('\n');
  const added = [];
  for (const raw of lines) {
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      added.push(raw.slice(1));
    }
  }
  if (added.length === 0) return;
  scanned++;

  for (let i = 0; i < added.length; i++) {
    const line = added[i];
    if (!line.trim()) continue;
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line) && !/style=|className=/.test(line)) continue; // 纯注释行跳过

    for (const rule of RULES) {
      if (rule.allowFile(file)) continue;
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        if (rule.validate && !rule.validate(m)) continue;
        if (isIgnored(added, i)) continue;
        console.error(`[UI规范拦截] ${file} 命中「${rule.id} ${rule.name}」`);
        console.error(`    ${line.trim().slice(0, 120)}`);
        console.error(`    → ${rule.hint}`);
        failed = true;
      }
    }
  }
}

try {
  // 取暂存区中前端源码的 diff（逐文件拆分）
  const files = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => /^frontend\/src\/.*\.(tsx?|css)$/.test(f))
    .filter((f) => !/\.(test|spec)\./.test(f)); // 测试文件不校验样式

  if (files.length === 0) {
    console.log('[check-ui-rules] 暂存区无前端源码变更，跳过 ✅');
    process.exit(0);
  }

  for (const f of files) {
    let patch = '';
    try {
      patch = execFileSync('git', ['diff', '--cached', '--', f], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch {
      continue;
    }
    scanPatch(f, patch);
  }

  if (failed) {
    console.error('');
    console.error('检测到 UI 规范违规，已阻止提交。');
    console.error('规则依据：AGENTS.md「二、UI 设计硬约束」；令牌表见 frontend/src/index.css @theme');
    console.error('如确需例外，在该行加注释 ui-rules-ignore 并写明理由。');
    process.exit(1);
  }
  console.log(`[check-ui-rules] 已扫描 ${scanned} 个前端文件，未发现 UI 规范违规 ✅`);
} catch (err) {
  if (err.status === 1) process.exit(1);
  console.error('[check-ui-rules] 执行失败: ' + err.message);
  process.exit(1);
}
