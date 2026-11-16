// Golden data працівника: скрипт на кожному синтетичному наборі дає відомий вердикт. Без моделі й без залежностей:
//   node --test tests/
// Очікувані відповіді лежать тут, у tests/golden/, а не в data/: працівнику читати tests/ заборонено
// (.claude/settings.json → deny Read(/tests/**)), тож перевірка лишається незалежною від нього.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { diffReports, evaluatePeriod, isOverMax, roundDiv, toHundredths } from "../scripts/lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "check-estimates.mjs");

const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
const jsonOf = (stdout) => JSON.parse(stdout.slice(stdout.indexOf("###JSON###") + "###JSON###".length).trim());
const brief = (e) => ({
  estimate_id: e.estimate_id,
  verdict: e.verdict,
  reasons: [...new Set(e.reasons.map((r) => r.code))].sort(),
  notes: [...new Set(e.notes.map((n) => n.code))].sort(),
});

for (const set of ["golden-1", "golden-2", "golden-3"]) {
  test(`${set}: вердикти й код виходу збігаються з очікуваними`, () => {
    const expected = JSON.parse(readFileSync(path.join(ROOT, "tests", "golden", set, "expected.json"), "utf8"));
    const r = run("check", `data/${set}`);
    assert.equal(r.status, expected.exit_code, r.stderr);
    const result = jsonOf(r.stdout);
    const actual = Object.fromEntries(result.estimates.map((e) => [e.file, brief(e)]));
    assert.deepEqual(actual, expected.estimates);
  });
}

test("ін'єкція в описі рядка — лише примітка: вердикт за правилами (flag через ціну), а не «ok»", () => {
  const e = evaluatePeriod("data/golden-3").estimates.find((x) => x.estimate_id === "EST-1303");
  assert.equal(e.verdict, "flag");
  assert.deepEqual(e.notes.map((n) => n.code), ["instruction_like_text"]);
  assert.match(e.reasons[0].text, /\$3\.10 .* \$2\.50 на 24\.00%/);
});

test("допуск 10%: рівно +10% — не зауваження, +10.01% — зауваження", () => {
  assert.equal(isOverMax(9350, 8500), false); // $93.50 при максимумі $85.00 = +10.00%
  assert.equal(isOverMax(4950, 4500), false); // $49.50 при $45.00
  assert.equal(isOverMax(13201, 12000), true); // $132.01 при $120.00 = +10.01%
});

test("гроші й кількість — цілі числа: без похибок float і з округленням половини від нуля", () => {
  assert.equal(toHundredths(412.5), 41250);
  assert.equal(toHundredths("0.1"), 10);
  assert.equal(toHundredths(1.005), null); // > 2 знаків після коми — не приймаємо
  assert.equal(toHundredths("abc"), null);
  assert.equal(roundDiv(41250 * 240, 100), 99000); // 412.5 × $2.40 = $990.00
  assert.equal(roundDiv(-200 * 8000, 100), -16000);
  assert.equal(roundDiv(150, 100), 2);
  assert.equal(roundDiv(-150, 100), -2);
});

test("межа: тека поза data/ або вкладена глибше — код 2, нічого не перевіряється", () => {
  for (const dir of ["../", "references", "data/../scripts", "data", "data/golden-1/../../out", "data/no-such-week"]) {
    const r = run("check", dir);
    assert.equal(r.status, 2, `${dir}: ${r.stdout}`);
    assert.match(r.stderr, /ПОМИЛКА ВХОДУ/);
  }
  assert.equal(run("approve", "data/golden-1").status, 2);
  assert.equal(run("check").status, 2);
});

test("compare: підмінений вердикт чи сума в report.json — розбіжність", () => {
  const fresh = evaluatePeriod("data/golden-2");
  assert.deepEqual(diffReports(fresh, structuredClone(fresh)), []);
  const tampered = structuredClone(fresh);
  tampered.estimates.find((e) => e.estimate_id === "EST-1201").verdict = "ok";
  tampered.estimates.find((e) => e.estimate_id === "EST-1202").computed_total_cents = 0;
  const diffs = diffReports(fresh, tampered);
  assert.equal(diffs.length, 2);
  assert.ok(diffs.some((d) => d.startsWith("estimates.delta-hvac-EST-1201.json.verdict")));
});

test("report + compare на golden-1: записаний звіт збігається з розрахунком (код 0)", () => {
  assert.equal(run("report", "data/golden-1").status, 0);
  const r = run("compare", "data/golden-1");
  assert.equal(r.status, 0, r.stdout);
  assert.equal(jsonOf(r.stdout).ok, true);
});
