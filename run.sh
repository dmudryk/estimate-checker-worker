#!/usr/bin/env bash
# Запуск перевіряльника кошторисів без людини за клавіатурою (cron, CI): claude -p («print», headless).
# Вхід — ваша підписка Claude (claude /login один раз) або CLAUDE_CODE_OAUTH_TOKEN з `claude setup-token`.
# Лише для ОСОБИСТОГО використання: продукт для інших людей — лише з API-ключем (README, «Політика»).
# Будова взята з шаблону курсу materials/worker-claude-code/run.sh (koldovsky/2026-quitcode-10-ai-features-hw).
#
#   ./run.sh                 # період за замовчуванням data/golden-3 (демо: дублікат, невідомий пункт, ін'єкція)
#   ./run.sh 2026-W47        # тиждень; для розкладу: ./run.sh "$(date +%G-W%V)"
#
# Чому без --bare: --bare пропускає CLAUDE.md, скіли, .claude/agents і хуки та НЕ читає вхід підпискою —
# працівника без них немає.
set -euo pipefail
cd "$(dirname "$0")"
# Git Bash на Windows перетворює аргументи, що починаються з «/», на шляхи Windows
# («/estimate-checker» → «C:/Program Files/Git/estimate-checker»). Для Linux і macOS змінна нічого не робить.
export MSYS_NO_PATHCONV=1

PERIOD="${1:-golden-3}"
case "$PERIOD" in
  "" | *[!A-Za-z0-9._-]* | [._-]*) echo "Період — лише літери, цифри, «.», «_», «-»: $PERIOD" >&2; exit 2 ;;
esac
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
mkdir -p out/runs

# Ті самі правила, що в .claude/settings.json, — ще й прапорцями: у теці, якій Claude Code ще не довіряє,
# allow з settings.json ігнорується, а налаштування користувача (~/.claude) не мають розширювати межі працівника.
ALLOWED="Skill(estimate-checker),Agent(estimate-verifier),Bash(node scripts/check-estimates.mjs *),PowerShell(node scripts/check-estimates.mjs *),Read(/data/**),Read(/references/**),Read(/out/**),Glob,Grep,Edit(/out/**)"
DENIED="Read(./.env),Read(./.env.*),Read(**/.env*),Read(/tests/**),Read(/docs/**),Read(/README.md),Read(/out/runs/**),Edit(/data/**),Edit(/references/**),Edit(/scripts/**),Edit(/tests/**),Edit(/docs/**),Edit(/.claude/**),WebFetch,WebSearch,Bash(curl *),Bash(wget *),Bash(rm *),Bash(git push *),Bash(node -e *),PowerShell(Invoke-WebRequest *),PowerShell(Invoke-RestMethod *),PowerShell(Remove-Item *)"

# --permission-mode dontAsk: усе, що не дозволено явно, — відмова (без людини нема кому натиснути «так»).
# --setting-sources project: лише .claude/settings.json цього репо, без хуків і дозволів з ~/.claude.
# --strict-mcp-config без --mcp-config: жодних MCP-серверів (пошта, чати, CRM) — працівнику вони не потрібні.
# --max-turns / --max-budget-usd: стеля кроків і оцінки вартості.
# --output-format stream-json --verbose: повний журнал подій (видно виклик перевіряльника); останній рядок —
# підсумок (num_turns, total_cost_usd, result), його ж зберігаємо окремо як <час>.json.
set +e
"$CLAUDE_BIN" -p "/estimate-checker data/${PERIOD}" \
  --permission-mode dontAsk \
  --setting-sources project \
  --strict-mcp-config \
  --allowedTools "$ALLOWED" \
  --disallowedTools "$DENIED" \
  --max-turns 40 \
  --max-budget-usd 5 \
  --output-format stream-json --verbose \
  > "out/runs/${STAMP}.jsonl" 2> "out/runs/${STAMP}.stderr.log"
code=$?
set -e
tail -n 1 "out/runs/${STAMP}.jsonl" > "out/runs/${STAMP}.json" || true

echo "Журнал: out/runs/${STAMP}.jsonl, підсумок: out/runs/${STAMP}.json (код виходу ${code}); звіт — out/${PERIOD}/report.md"
exit "$code"
