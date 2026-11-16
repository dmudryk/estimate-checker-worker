#!/usr/bin/env node
// Скрипт-перевірка віртуального працівника «перевіряльник кошторисів вендорів». Node 24, без залежностей.
// РАХУЄ СКРИПТ, а не модель: агент лише запускає його, копіює таблиці у звіт і пояснює результат.
//   1) таблиця для людини + маркер ###JSON### і машиночитний JSON для агента;
//   2) код виходу: 0 — усі кошториси ok, 1 — є flag чи reject (або звіт розійшовся з розрахунком), 2 — вхід не прочитано;
//   3) вердикт — рекомендація за правилами references/rules.md; затверджує й оплачує лише людина.
//
//   node scripts/check-estimates.mjs check   data/<період>   перевірка; нічого не записує
//   node scripts/check-estimates.mjs report  data/<період>   перевірка + out/<період>/report.json
//   node scripts/check-estimates.mjs compare data/<період>   свіжий розрахунок проти out/<період>/report.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { InputError, ROOT, diffReports, evaluatePeriod, renderTables } from "./lib.mjs";

const USAGE = "використання: node scripts/check-estimates.mjs <check|report|compare> data/<період>";
const [cmd, dirArg, ...extra] = process.argv.slice(2);

try {
  if (!["check", "report", "compare"].includes(cmd) || !dirArg || extra.length) throw new InputError(USAGE);
  const result = evaluatePeriod(dirArg);
  // Шлях запису обчислює код з перевіреної назви періоду: лише out/<період>/report.json.
  const reportFile = path.join(ROOT, "out", result.period, "report.json");
  const reportRel = `out/${result.period}/report.json`;

  if (cmd === "check" || cmd === "report") {
    console.log(renderTables(result));
    if (cmd === "report") {
      mkdirSync(path.dirname(reportFile), { recursive: true });
      writeFileSync(reportFile, JSON.stringify(result, null, 2) + "\n", "utf8");
      console.log(`\nЗаписано: ${reportRel}`);
    }
    console.log("###JSON###");
    console.log(JSON.stringify(result));
    process.exit(result.exit_code);
  }

  // compare: чи збережений звіт збігається з розрахунком за першоджерелами просто зараз
  if (!existsSync(reportFile)) throw new InputError(`немає ${reportRel} — спершу «report»`);
  let saved;
  try {
    saved = JSON.parse(readFileSync(reportFile, "utf8"));
  } catch (e) {
    throw new InputError(`${reportRel} не є JSON (${e.message})`);
  }
  const diffs = diffReports(result, saved);
  console.log(`## Звірка ${reportRel} зі свіжим розрахунком за data/${result.period}\n`);
  if (diffs.length) {
    console.log("| # | Розбіжність |\n|---|---|");
    diffs.forEach((d, i) => console.log(`| ${i + 1} | ${d.replace(/\|/g, "\\|")} |`));
    console.log(`\nЗВІРКА ЗВІТУ: РОЗБІЖНОСТІ (${diffs.length})`);
  } else {
    console.log("ЗВІРКА ЗВІТУ: report.json збігається з розрахунком (вердикти, причини, суми, хеші файлів)");
  }
  console.log("###JSON###");
  console.log(JSON.stringify({ check: "compare", period: result.period, ok: diffs.length === 0, differences: diffs }));
  process.exit(diffs.length ? 1 : 0);
} catch (e) {
  console.error(`ПОМИЛКА ВХОДУ: ${e instanceof InputError ? e.message : e?.stack ?? e}`);
  process.exit(2);
}
