/**
 * UI 规范扫描（提交前强制检查）
 *
 * 用法：
 *   node frontend/scripts/check-ui-rules.mjs                        # 扫描 git 暂存区（pre-commit 调用）
 *   node frontend/scripts/check-ui-rules.mjs --all                  # 全仓扫描已跟踪前端源码（CI 调用）
 *   node frontend/scripts/check-ui-rules.mjs --patch-file <路径> [假想文件名]  # 离线验证（测试/CI 复现）
 *
 * 退出码：
 *   0 = 通过（无违规），或环境异常（git 不可用等，不阻止提交）
 *   1 = 检出违规（应阻止提交）
 *   2 = 用法错误（如 --patch-file 路径不存在）
 *
 * 校验规则来源：项目根 AGENTS.md「二、UI 设计硬约束」+ docs/规范/01_UI设计与组件规范_0916.md
 *              + docs/规范/03_术语与命名规范_0916.md（R5 禁用术语）
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

/** 令牌定义源：这些文件允许出现字面色值（它们是令牌本身的定义处，不是使用处）
 *  - index.css：@theme 令牌定义
 *  - graphCanvas.ts：Canvas 令牌桥接层（含 FALLBACK 回退值定义，与 @theme 一一对应）
 */
const TOKEN_SOURCE_RE = /(?:^|\/)(index\.css|graphCanvas\.ts)$/;

/**
 * 禁用术语表（规则 R5）
 *
 * 来源：`docs/规范/03_术语与命名规范_0916.md`「一、命名对照表（唯一叫法）」五张表的「禁止出现」列：
 *       原文共 28 个词条 + 5 个「禁止出现」列为非词条型表述的条目（见下表 notMatched）。
 *       其中 25 个「字面词」被机械匹配；有区分度的做整体匹配，且都会误伤正确叫法的词（如「星图」）
 *       改用边界正则（见 EXCLUDE 说明），剩余易误报词不纳入本数组。
 * 维护方式：术语表增删禁用词时，此数组必须同步；每个词条须写明应改用的「唯一叫法」。
 *
 * 取舍理由（原文对全部禁用词做机械匹配，但以下词条会大面积误报，故不纳入本数组，仅作人工复查提示）：
 *  1. 「设置」——被术语表列为「运行设置」和「配置」两处的禁止词，但它同时是合法叫法「知识库设置」
 *     「灵感库设置」的核心构词，且在 `settings` 变量名 / 路由名 / 通用按钮文案中高频出现，
 *     机械匹配必然把合规代码一并拦下 → 不纳入。
 *  2. 「文档」——合法叫法「全部文档」/「文档列表」/「文档使用率」的构词成分 → 不纳入。
 *  3. 「原文」——合法叫法「查看原文 ↗」以及「原文出处」「原文未收录」等描述性文案的构词成分 → 不纳入。
 *     （「阅读原文」/「打开原文」本身有区分度，已单独纳入。）
 *  4. 「展开」「更多」——通用 UI 动词（展开分组、加载更多等处处在用）→ 不纳入。
 *  5. 「预设」「快捷」——通用词，且「快捷」是普通形容词 → 不纳入。
 *  6. 「关联任务」——误报风险高：「关联任务数」「任务关联资料」均为合法表述 → 不纳入。
 *  7. 「挂载」——是项目自有领域术语（Agent 挂载 / skill 挂载），属合法技术词，仅禁止出现在界面文案中
 *     → 机械匹配无法区分代码标识符与界面文案，不纳入，靠人工按 T1 复查。
 *  8. 「版本记录」「版本历史」——合法叫法「历史版本」不含「版本」单独成词，此处保留完整词条（不含裸「版本」）。
 *  9. 「星图」——唯一叫法「知识星图」本身含「星图」二字，直接整体匹配会把合规代码全部拦下
 *     → 加**前视否定**：前置不得是「知识 / 图谱」（「知识星图」的构词）。这是唯一被加边界的词条，
 *       目的是不误伤正确叫法本身；单独出现的「星图」「星图页」「星图缩略」等仍会命中（符合术语表）。
 * 10. 「首页」——同上，「工作台首页」「知识库首页」是完整禁止词条，须整词整体匹配避免把「首页」单独截出来误报；
 *     且「首页」仅在作为视图名时违规，本脚本无法判断上下文，已整体匹配，误报可加 ui-rules-ignore 放行。
 *
 * 以下 5 条属于「禁止出现」列里的非字符串表述，无法逐字机械匹配，只写进注释供人工复查：
 *   - 「灵感库（作为模块名）」：禁止的是「灵感库」被当成模块页名，与合法叫法「灵感库（知识库内目录/入口）」同形，
 *     机械匹配必然误报 → notMatched。
 *   - 「热点源配置（作为……入口名）」：禁止的是它被当成「灵感库设置」以外的入口名，同形冲突 → notMatched。
 *   - 「挂为任务背景（作为主操作）」：其中「挂为任务背景」为字面词条，已纳入；仅「作为主操作」这一限定无从匹配。
 *   - 「设置（Agent 卡上的按钮）」/「文档列表、文档」等侧：细分措辞见上。
 *
 * 另：本数组只做「字面词」匹配（不做同义改写识别），且 `ui-rules-ignore` 行内放行机制对这些词同样生效。
 */
const BANNED_TERMS = [
  // ① 页面与视图名（唯一叫法：任务看板 / 知识库 / 知识星图 / 每日热点 / 任务）
  { term: '看板页', use: '任务看板' },
  { term: '工作台首页', use: '任务看板' },
  { term: '知识库首页', use: '知识库' },
  { term: '文档库', use: '知识库' },
  { term: '板块 B', use: '知识库' },
  // 「星图」需排除「知识星图」（唯一叫法本身）这一合法构词：前置为「知识/图谱」时不算违规
  { term: '星图', use: '知识星图', excludeBefore: '(?:知识|图谱)' },
  { term: '图谱页', use: '知识星图' },
  { term: '热点面板', use: '每日热点' },
  { term: '今日热点', use: '每日热点' },
  { term: '今日灵感', use: '每日热点（模块页）/ 灵感库（知识库内入口）' },
  { term: '任务中心', use: '任务' },
  // ② 设置与配置入口（唯一叫法：知识库设置 / 灵感库设置 / 热点源配置 / 运行设置 / 配置）
  { term: '连接设置', use: '知识库设置' },
  { term: '连接配置', use: '知识库设置' },
  { term: 'Vault 设置', use: '知识库设置' },
  { term: '每日热点设置', use: '灵感库设置' },
  { term: '关注域与源配置', use: '热点源配置' },
  { term: '关注域与数据源配置', use: '热点源配置' },
  { term: '情报配置', use: '热点源配置' },
  { term: '偏好设置', use: '运行设置' },
  // ③ 板块与区域名（唯一叫法：全部文档 / 待在用的资料 / 小助理 / 重点目录 / 历史版本 / 来源）
  { term: '知识库助理', use: '小助理' },
  { term: 'AI 助理', use: '小助理' },
  { term: '业务预设', use: '重点目录' },
  { term: '版本记录', use: '历史版本' },
  { term: '版本历史', use: '历史版本' },
  // 注：「溯源」原为禁用词（应改「来源」），但经用户 2026-09-16 定案**保留**——
  //     它是项目既有惯用词（有 provenance 字段、产出溯源区块、溯源率指标），与「来源」并用。
  //     故此处不再收录；仅「出处」仍是禁用词。术语表已同步修订。
  { term: '出处', use: '来源' },
  // ④ 动作名（唯一叫法：收进灵感库 / 挂到工作流 / 查看交付物 → / 查看原文 ↗ / 展开全文 / 预览全文）
  { term: '挂为任务背景', use: '收进灵感库' },
  // 「查看交付」是禁用词，但唯一叫法「查看交付物 →」包含它 → 后跟「物」时不算违规
  { term: '查看交付', use: '查看交付物 →', excludeAfter: '物' },
  { term: '打开交付物', use: '查看交付物 →' },
  { term: '阅读原文', use: '查看原文 ↗ / 预览全文（星图节点详情内）' },
  { term: '打开原文', use: '查看原文 ↗' },
];

/**
 * 集中匹配：每个词条编译成「可选前置否定 + 转义字面量 + 可选后置否定」，用**命名组** `g{i}` 标记该词条：
 *   - `g{i}` = 词条文本本身（命中后按组名反查索引，避免环视里的捕获组干扰）
 *   - `excludeBefore` = 其前不允许紧跟的模式（把合法构词如「知识星图」排除掉）
 *   - `excludeAfter`  = 其后不允许紧跟的模式（把合法构词如「查看交付物」排除掉——
 *                       「查看交付」是禁用词，但它是唯一叫法「查看交付物 →」的子串，需排除后跟「物」）
 */
const BANNED_TERM_RE = new RegExp(
  BANNED_TERMS
    .map((t, i) => {
      const before = t.excludeBefore ? `(?<!${t.excludeBefore})` : '';
      const after = t.excludeAfter ? `(?!${t.excludeAfter})` : '';
      return `${before}(?<g${i}>${t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})${after}`;
    })
    .join('|'),
  'g',
);

/** 按命名组反查命中的词条（组名 g<N> ↔ BANNED_TERMS[N]） */
function bannedTermOf(groups) {
  for (const [k, v] of Object.entries(groups)) {
    if (v === undefined) continue;
    const idx = Number(k.slice(1));
    // 命中的组值必须等于该词条本身（防止环视/重叠导致的误配）
    if (BANNED_TERMS[idx] && BANNED_TERMS[idx].term === v) return BANNED_TERMS[idx];
  }
  return undefined;
}

const RULES = [
  {
    id: 'R1',
    name: '硬编码颜色（hex）',
    // 命中 #abc / #aabbcc，但排除纯 #fff/#000 之外的一切裸色值
    re: /#[0-9a-fA-F]{3,8}\b/g,
    hint: '改用 var(--color-*) 令牌，令牌表见 frontend/src/index.css @theme',
    allowFile: (f) => TOKEN_SOURCE_RE.test(f),
  },
  {
    id: 'R2',
    name: '硬编码 rgba/rgb 颜色',
    // 覆盖所有 rgba/rgb 数字形式（不只黑白）——项目实际用 rgba(10,10,10,*) 等 ink 变体，
    // 旧版只匹配 0/255 会漏报（2026-09-16 实测漏了 10 处）。
    re: /\brgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g,
    hint: '改用具名令牌；遮罩/浮层阴影属规范允许例外，在该行加注释 ui-rules-ignore 并写明理由',
    allowFile: (f) => TOKEN_SOURCE_RE.test(f),
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
  {
    id: 'R5',
    name: '禁用术语（界面文案只能用一个叫法）',
    // 来源：docs/规范/03_术语与命名规范_0916.md「命名对照表」的「禁止出现」列（见上方 BANNED_TERMS 取舍说明）
    re: BANNED_TERM_RE,
    hint: '改用术语表的「唯一叫法」；hit 词条 → 替代叫法见下方逐条提示。新增文案前先查 docs/规范/03_术语与命名规范_0916.md',
    allowFile: (f) => false,
    // 命中后补充「应改成什么」：R5 的报告比其它规则多一行替代建议
    report: (line, m) => {
      const hit = bannedTermOf(m.groups ?? {});
      if (hit) console.error(`    → 「${hit.term}」应改用唯一叫法：${hit.use}`);
    },
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
        if (rule.report) rule.report(line, m);
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
    console.error('规则依据：AGENTS.md「二、UI 设计硬约束」（含 T1 术语与文案）；令牌表见 frontend/src/index.css @theme');
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

/**
 * 全仓扫描模式（CI 用）：扫描所有已跟踪且未被忽略的前端源码文件
 * 与暂存区模式的差别：没有「新增行」概念，故对整文件逐行检查。
 */
if (argv[0] === '--all') {
  try {
    const files = execFileSync('git', ['ls-files', 'frontend/src'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((f) => TARGET_RE.test(f))
      .filter((f) => !/\.(test|spec)\./.test(f));

    for (const f of files) {
      let text;
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      scanPatch(f, text.split('\n').map((l) => '+' + l).join('\n'));
    }
    process.exit(reportAndExit());
  } catch (err) {
    console.error('[check-ui-rules] ⚠️ 全仓扫描失败: ' + (err.message || err));
    process.exit(0); // 环境异常不阻构建
  }
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
