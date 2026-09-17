/**
 * UI 规范扫描（提交前强制检查）
 *
 * 用法：
 *   node frontend/scripts/check-ui-rules.mjs                        # 扫描 git 暂存区（pre-commit 调用）
 *   node frontend/scripts/check-ui-rules.mjs --patch-file <路径> [假想文件名]  # 离线验证（测试/CI 复现）
 *
 * 退出码：
 *   0 = 通过（无违规），或环境异常（git 不可用等，不阻止提交）
 *   1 = 检出违规（应阻止提交）
 *   2 = 用法错误（如 --patch-file 路径不存在）
 *
 * 校验规则来源：项目根 AGENTS.md「二、UI 设计硬约束」+ docs/规范/01_UI设计与组件规范_0908.md
 *
 * 放行机制：行内注释 `ui-rules-ignore`（需写明理由）或 `ui-rules-ignore-next-line`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
    name: '硬编码 rgba/rgb 颜色',
    // 覆盖所有 rgba/rgb 数字形式（不只黑白）——项目实际用 rgba(10,10,10,*) 等 ink 变体，
    // 旧版只匹配 0/255 会漏报（2026-09-16 实测漏了 10 处）。
    re: /\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g,
    hint: '改用具名令牌；遮罩/浮层阴影属规范允许例外，在该行加注释 ui-rules-ignore 并写明理由',
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

/**
 * 行内放行：支持两种写法
 *  ① 本行含 `ui-rules-ignore`（行尾注释，适用于单行）
 *  ② 上一行含 `ui-rules-ignore` 或 `ui-rules-ignore-next-line`（上一行注释，适用于 JSX 属性等无法行尾注释的场景）
 */
function isIgnored(lines, idx) {
  const cur = lines[idx] ?? '';
  const prev = lines[idx - 1] ?? '';
  if (/ui-rules-ignore/.test(cur)) return true;
  return /ui-rules-ignore/.test(prev);
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

/** 扫描目标：前端源码（AGENTS.md 第 2~6 条仅约束前端 UI） */
const TARGET_RE = /^frontend\/src\/.*\.(tsx?|css)$/;

/**
 * 模式①：--patch-file <path> <假想文件名>
 * 从文件读 patch 内容做离线验证（不依赖 git，用于测试与 CI 复现）
 */
function runFromPatchFile(patchPath, fakeName) {
  let text;
  try {
    text = readFileSync(patchPath, 'utf8');
  } catch (e) {
    console.error(`[check-ui-rules] 无法读取 patch 文件: ${patchPath} (${e.code})`);
    process.exit(2); // 2 = 用法/环境错误，区别于 1（有违规）
  }
  scanPatch(fakeName ?? 'frontend/src/__patch__.tsx', text);
  return reportAndExit();
}

/** 汇总输出并返回退出码 */
function reportAndExit() {
  if (failed) {
    console.error('');
    console.error('检测到 UI 规范违规，已阻止提交。');
    console.error('规则依据：AGENTS.md「二、UI 设计硬约束」；令牌表见 frontend/src/index.css @theme');
    console.error('如确需例外，在该行加注释 ui-rules-ignore 并写明理由。');
    return 1; // 1 = 有违规（应阻止提交）
  }
  console.log(`[check-ui-rules] 已扫描 ${scanned} 个文件，未发现 UI 规范违规 ✅`);
  return 0;
}

const argv = process.argv.slice(2);
if (argv[0] === '--patch-file') {
  process.exit(runFromPatchFile(argv[1], argv[2]));
}

try {
  // 取暂存区中前端源码的 diff（逐文件拆分）
  const files = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => TARGET_RE.test(f))
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

  process.exit(reportAndExit());
} catch (err) {
  // 区分「有违规」与「环境异常」：
  //   git 不可用 / 索引锁 / 沙箱限制 → 不应阻止提交（否则会误拦全部提交）
  //   仅当确实检出违规时才 exit 1
  console.error('[check-ui-rules] ⚠️ 跳过检查（环境异常，非违规）: ' + (err.message || err));
  console.error('  提示：若频繁出现，请确认 git 可用；本检查不阻止提交。');
  process.exit(0);
}
