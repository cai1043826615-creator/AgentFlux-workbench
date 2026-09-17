/**
 * 密钥泄露扫描（提交前强制检查）
 *
 * 用法：
 *   node backend/scripts/check-secrets.mjs          # 扫描 git 暂存区（pre-commit 调用）
 *   node backend/scripts/check-secrets.mjs --all    # 全仓扫描已跟踪文件（CI 调用）
 *  - 命中疑似密钥 → 输出位置并退出码 1；无命中 → 退出码 0
 *  - 已被 .git/hooks/pre-commit 调用；也可手动执行（含 `git add -A` 前自查）
 *
 * 排除：占位符（xxx / your- / example / placeholder / <...> / ****）与模板说明文案。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  // 常见 API Key 格式（sk- / ghp_ / AIza / AKIA / xox / Bearer）
  { name: 'sk-* API Key', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'GitHub PAT', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Bearer Token', re: /\bBearer [A-Za-z0-9._~+/=-]{20,}\b/g },
  { name: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  // 通用 key= 赋值（宽松；含 xxx / example / placeholder / <...> / **** 的排除）
  { name: 'key/secret/token 赋值', re: /(?:api[_-]?key|apikey|secret|token|password|access[_-]?key)\s*[:=]\s*['"]?([A-Za-z0-9_\-./+]{16,})['"]?/gi },
];

/** 判定是否占位符（模板/示例值，放行） */
function isPlaceholder(value) {
  const v = String(value).toLowerCase();
  return /(xxx|your[-_]?|example|placeholder|<[^>]*>|\*{2,}|…|fill\s*in|your[-_]key|your[-_]token|sk-xxx)/.test(v);
}

/** 判定是否为环境变量引用（process.env.X —— 密钥不进代码的安全写法，放行） */
function isEnvRef(value) {
  return /^process\.env\./.test(String(value));
}

/**
 * 判定是否为「配置对象字段引用」——形如 `apiKey: CHANNEL.image.apiKey` 或 `apiKey: cfg.xxx.yyy`。
 * 这类是引用既有配置对象，不是硬编码密钥字面量，属安全写法，放行。
 * （2026-09-16 修复：--all 全仓扫描时 backend/src/db/seed.ts 的 `apiKey: CHANNEL.image.apiKey` 被误报）
 */
function isConfigRef(value) {
  const v = String(value);
  // 含点号的标识符链（a.b.c）且不含引号/斜杠（排除 URL 与字符串字面量）
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v);
}

let failed = false;

/** 扫描一段文本，报告命中 */
function scan(text, source) {
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const hit = m[1] ?? m[0];
      if (isPlaceholder(hit) || isEnvRef(hit) || isConfigRef(hit)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      console.error(`[密钥拦截] ${source}:${line} 命中「${name}」-> ${hit.slice(0, 4)}***（已脱敏）`);
      failed = true;
    }
  }
}

const BINARY_RE = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|zip|gz|db|db-wal|db-shm)$/i;

/** 全仓扫描模式（CI 用；无暂存区概念，改扫工作树中的已跟踪文件） */
function scanAllTracked() {
  const names = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of names) {
    scan(name, '文件名');
    if (BINARY_RE.test(name)) continue;
    let text;
    try {
      text = readFileSync(name, 'utf8');
    } catch {
      continue; // 已删除/不可读文件跳过
    }
    scan(text, name);
  }
  if (failed) {
    console.error('');
    console.error('检测到疑似密钥已入库，构建失败！请移除密钥或将其加入 .gitignore。');
    return 1;
  }
  console.log(`[check-secrets] 全仓扫描 ${names.length} 个文件，未发现疑似密钥 ✅`);
  return 0;
}

try {
  if (process.argv.includes('--all')) {
    process.exit(scanAllTracked());
  }

  // 暂存区文件名（含路径）
  const names = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  // 暂存区完整 diff（新增行 + 上下文；仅文本）
  const diff = execFileSync('git', ['diff', '--cached'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  for (const name of names) {
    if (BINARY_RE.test(name)) continue; // 二进制/数据文件跳过内容扫描
    scan(name, '文件名');
  }
  scan(diff, '暂存区');

  if (failed) {
    console.error('');
    console.error('检测到疑似密钥被暂存，已阻止提交！请移除密钥文件或将其加入 .gitignore 后重试。');
    process.exit(1);
  }
  console.log('[check-secrets] 暂存区未发现疑似密钥 ✅');
} catch (err) {
  if (err.status === 1) process.exit(1);
  console.error('[check-secrets] 执行失败（git 不可用？）: ' + err.message);
  process.exit(1);
}
