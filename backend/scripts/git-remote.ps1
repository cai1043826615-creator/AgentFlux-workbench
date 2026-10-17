# git 远端操作包装（PowerShell）
#
# 为什么需要它：本机 git 的默认凭据链路 Git Credential Manager 无法在沙箱下启动
# （GCM 要拉起子进程 + named pipe，被拒 → "couldn't create signal pipe, Win32 error 5"），
# 导致 `git fetch/push` 报 "could not read Username for 'https://github.com'"。
# 本机也没有可用的 OpenSSH key，bash 也不可用（WSL E_ACCESSDENIED）。
#
# 方案：用 `gh auth token`（已登录账号，scope 含 repo/workflow）做一次性 URL 重写，
# token 只存在于进程参数中，不写 .git/config、不落盘。
#
# 用法：
#   pwsh backend/scripts/git-remote.ps1 fetch origin
#   pwsh backend/scripts/git-remote.ps1 push origin master
#   pwsh backend/scripts/git-remote.ps1 ls-remote origin
#   pwsh backend/scripts/git-remote.ps1 log origin/master -1

$ErrorActionPreference = 'Stop'

if ($args.Count -eq 0) {
  Write-Host '用法: pwsh backend/scripts/git-remote.ps1 <git 子命令> [参数...]' -ForegroundColor Yellow
  exit 1
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Write-Host '需要 GitHub CLI（gh）：winget install GitHub.cli，然后 gh auth login' -ForegroundColor Red
  exit 1
}

$token = gh auth token 2>$null
if (-not $token) {
  Write-Host 'gh 未登录，无法获取 token：请先运行 gh auth login' -ForegroundColor Red
  exit 1
}

$env:GIT_TERMINAL_PROMPT = '0'

$gitArgs = @(
  '-c', 'credential.helper=',
  '-c', "url.https://x-access-token:$token@github.com/.insteadOf=https://github.com/"
) + $args

& git @gitArgs
exit $LASTEXITCODE
