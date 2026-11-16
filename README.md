# Перевіряльник кошторисів вендорів — віртуальний працівник на Claude Code

Бонус WS10 курсу QuitCode (шлях 1: Claude Code як рушій на власній підписці). Працівник агенції з управління
нерухомістю: коли в `data/<період>/` з'являються нові кошториси вендорів, він перевіряє їх за правилами агенції й пише
звіт для менеджера з вердиктом `ok` / `flag` / `reject` на кожен кошторис. **Затверджує й оплачує лише людина.**

> **Усі дані синтетичні.** Вендори (`Alpha Plumbing (synthetic)` … `Kilo Electric (synthetic)`), адреси
> (`… Example Street`), ціни й контакти (`*@example.test`) вигадані. Ключів, токенів і `.env` у репо немає.

Звіт для курсу (картка ролі, межі, перевіряльник, golden data, запуск без людини, вартість) —
**[docs/worker/README.md](docs/worker/README.md)**.

## Як це влаштовано

- **Рахує скрипт, а не модель:** `scripts/check-estimates.mjs` (+ `scripts/lib.mjs`, Node 24, без залежностей) —
  арифметика в цілих центах, ціни проти прайсу з допуском 10 %, невідомі пункти, дублікати номерів, кількість ≤ 0.
  Таблиця для людини, далі `###JSON###`, код виходу `0` (усе ok) / `1` (є flag чи reject) / `2` (вхід не прочитано).
- **Оркестратор** — скіл `.claude/skills/estimate-checker/SKILL.md`: запускає скрипт, пише `out/<період>/report.md`
  з таблиць скрипта, викликає перевіряльника, ставить стан `OK` / `Є ЗАУВАЖЕННЯ` / `НЕ ПЕРЕВІРЕНО`.
- **Перевіряльник** — субагент `.claude/agents/estimate-verifier.md` у чистому контексті: лише Read/Grep/Glob/Bash,
  отримує тільки шляхи, сам запускає `check` і `compare`, вибірково звіряє сирі файли й кожну цифру звіту.
- **Межі** — `.claude/settings.json` (вузький allow, deny на мережу, `.env*`, `tests/`, зміну даних і власних
  інструкцій) + `--permission-mode dontAsk` у `run.sh` / `run.ps1`.

```
AGENTS.md, CLAUDE.md                  роль, стани звіту, межі (CLAUDE.md = @AGENTS.md)
.claude/settings.json                 allow / deny
.claude/skills/estimate-checker/      оркестратор
.claude/agents/estimate-verifier.md   перевіряльник
references/rules.md, price-list.json  правила агенції й прайс (max ціна за одиницю)
scripts/check-estimates.mjs, lib.mjs  уся арифметика й правила
data/golden-1..3/                     синтетичні кошториси з відомим вердиктом
tests/                                node --test; очікуване — tests/golden/<набір>/expected.json
run.sh, run.ps1                       запуск без людини (claude -p)
docs/worker/                          звіт для курсу і журнал запуску (docs/worker/runs/)
```

## Перевірка без моделі

```bash
node --test "tests/*.test.mjs"                          # 9 тестів, golden data
node scripts/check-estimates.mjs check data/golden-1    # код 0: усі ok
node scripts/check-estimates.mjs check data/golden-2    # код 1: reject (арифметика), 2 × flag (ціна), ok
node scripts/check-estimates.mjs check data/golden-3    # код 1: 2 × дублікат, невідомий пункт, ін'єкція + ціна, reject
node scripts/check-estimates.mjs check ../              # код 2: тека поза data/ — відмова
```

## Запуск з моделлю

Потрібні Node 24 і Claude Code з входом у **вашу** підписку.

- Інтерактивно: `claude` у цій теці (підтвердьте довіру до теки) → «Перевір кошториси за golden-3» або
  `/estimate-checker data/golden-3`.
- Без людини: `./run.sh golden-3` (bash, Git Bash) або
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 -Period golden-3`. Журнал — `out/runs/`, звіт —
  `out/<період>/report.md` і `report.json`.
- Розклад (щопонеділка 09:00, тиждень — ISO): cron `0 9 * * 1 cd /шлях/до/репо && ./run.sh "$(date +\%G-W\%V)"`;
  Windows — `schtasks /Create /TN "Estimate checker" /SC WEEKLY /D MON /ST 09:00 /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\шлях\до\репо\run.ps1\" -Period 2026-W47"`.

## Звідки взято

Будову (скіл-оркестратор, субагент-перевіряльник, скрипт із `###JSON###` і кодами 0/1/2, `settings.json`, `run.sh`,
`run.ps1`, workflow) взято з шаблону курсу
<https://github.com/koldovsky/2026-quitcode-10-ai-features-hw/tree/main/materials/worker-claude-code> і повного
прикладу <https://github.com/koldovsky/2026-quitcode-10-ai-features-hw/tree/main/materials/virtual-accountant>;
роль, правила, скрипт, дані й тести — власні.

## Політика

Підписка Claude — лише для особистого використання: цей працівник працює на підписці автора для його власної роботи.
Працівник для інших людей (кожен менеджер агенції натискає кнопку) — це вже продукт і потребує API-ключа.
