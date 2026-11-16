# Запуск перевіряльника кошторисів без людини (Планувальник завдань Windows): claude -p (headless).
# Вхід — ваша підписка Claude (claude /login один раз) або CLAUDE_CODE_OAUTH_TOKEN з `claude setup-token`.
# Лише для ОСОБИСТОГО використання: продукт для інших людей — лише з API-ключем (README, «Політика»).
# Будова взята з шаблону курсу materials/worker-claude-code/run.ps1 (koldovsky/2026-quitcode-10-ai-features-hw).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 -Period 2026-W47
#
# Чому без --bare: --bare пропускає CLAUDE.md, скіли, .claude/agents і хуки та НЕ читає вхід підпискою.
param(
  [string]$Period = "golden-3",
  [string]$ClaudeBin = "claude"
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
if ($Period -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { Write-Error "Період — лише літери, цифри, «.», «_», «-»: $Period"; exit 2 }

$stamp = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
New-Item -ItemType Directory -Force -Path "out\runs" | Out-Null
$log = "out\runs\$stamp.jsonl"

# Ті самі правила, що в .claude/settings.json, — ще й прапорцями (див. коментарі в run.sh).
$allowed = "Skill(estimate-checker),Agent(estimate-verifier),Bash(node scripts/check-estimates.mjs *),PowerShell(node scripts/check-estimates.mjs *),Read(/data/**),Read(/references/**),Read(/out/**),Glob,Grep,Edit(/out/**)"
$denied = "Read(./.env),Read(./.env.*),Read(**/.env*),Read(/tests/**),Read(/docs/**),Read(/README.md),Read(/out/runs/**),Edit(/data/**),Edit(/references/**),Edit(/scripts/**),Edit(/tests/**),Edit(/docs/**),Edit(/.claude/**),WebFetch,WebSearch,Bash(curl *),Bash(wget *),Bash(rm *),Bash(git push *),Bash(node -e *),PowerShell(Invoke-WebRequest *),PowerShell(Invoke-RestMethod *),PowerShell(Remove-Item *)"

$ErrorActionPreference = "Continue"
& $ClaudeBin -p "/estimate-checker data/$Period" `
  --permission-mode dontAsk `
  --setting-sources project `
  --strict-mcp-config `
  --allowedTools $allowed `
  --disallowedTools $denied `
  --max-turns 40 `
  --max-budget-usd 5 `
  --output-format stream-json --verbose 2> "out\runs\$stamp.stderr.log" | Out-File -FilePath $log -Encoding utf8
$code = $LASTEXITCODE
Get-Content -Path $log -Tail 1 | Out-File -FilePath "out\runs\$stamp.json" -Encoding utf8

Write-Output "Журнал: $log, підсумок: out\runs\$stamp.json (код виходу $code); звіт — out\$Period\report.md"
exit $code
