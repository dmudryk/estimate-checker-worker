// Логіка перевірки кошторисів вендорів. Node 24, без залежностей. Чисті функції — їх перевіряють тести.
// Головне правило: РАХУЄ КОД, а не модель. Усі правила з references/rules.md реалізовано тут.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TOLERANCE_PCT = 10;

// Вага кожної причини: error → reject, flag → flag (references/rules.md, «Правила і вердикти»).
export const SEVERITY = {
  total_mismatch: "error",
  bad_quantity: "error",
  invalid_input: "error",
  price_over_max: "flag",
  unknown_item: "flag",
  duplicate_id: "flag",
};

// Фрагменти, схожі на інструкцію для автоматичної системи. Лише примітка для людини: вердикт НЕ змінюють.
const INSTRUCTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+instructions/i,
  /\bmark\s+(this|the)\s+estimate\b/i,
  /\bapprove\s+(this|it|for|the)\b/i,
  /\b(system|developer)\s+prompt\b/i,
  /ігноруй|ігнорувати\s+інструкц/i,
  /познач(те)?\s+(цей|кошторис)/i,
];

export class InputError extends Error {}

// Десяткове число (JSON-число або рядок) → ціле число сотих частин. Більше 2 знаків після коми — не приймаємо.
export function toHundredths(v) {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith("-");
  const [int, frac = ""] = s.replace("-", "").split(".");
  const n = Number(int) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -n : n;
}

// Ділення цілих з округленням половини від нуля (для сум рядків у центах).
export function roundDiv(n, d) {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(n) + d / 2) / d);
}

// Ціна більша за максимум прайсу більш ніж на TOLERANCE_PCT %? Порівняння в цілих центах, без float.
export function isOverMax(priceCents, maxCents) {
  return priceCents * 100 > maxCents * (100 + TOLERANCE_PCT);
}

// На скільки відсотків ціна вища за максимум, у базисних пунктах (1 % = 100), округлено.
export function overBasisPoints(priceCents, maxCents) {
  return roundDiv((priceCents - maxCents) * 10000, maxCents);
}

export function usd(cents) {
  const a = Math.abs(cents);
  const dollars = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}$${dollars}.${String(a % 100).padStart(2, "0")}`;
}

export function pct(bp) {
  const a = Math.abs(bp);
  return `${bp < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}%`;
}

export function qty(hundredths) {
  const a = Math.abs(hundredths);
  const frac = String(a % 100).padStart(2, "0").replace(/0+$/, "");
  return `${hundredths < 0 ? "-" : ""}${Math.floor(a / 100)}${frac ? "." + frac : ""}`;
}

const rel = (p, root) => path.relative(root, p).split(path.sep).join("/");

// Межа: лише тека безпосередньо в data/ цього проєкту, з простою назвою періоду.
export function resolvePeriodDir(dirArg, root = ROOT) {
  if (!dirArg) throw new InputError("не вказано теку періоду (напр. data/2026-W47)");
  const dataRoot = path.join(root, "data");
  const dir = path.resolve(root, dirArg);
  if (path.dirname(dir) !== dataRoot) throw new InputError(`тека має бути безпосередньо в data/: ${dirArg}`);
  const period = path.basename(dir);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(period)) throw new InputError(`недопустима назва періоду: ${period}`);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new InputError(`немає теки ${rel(dir, root)}`);
  return { dir, period };
}

export function loadPriceList(root = ROOT) {
  const file = path.join(root, "references", "price-list.json");
  if (!existsSync(file)) throw new InputError("немає файлу references/price-list.json");
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new InputError(`references/price-list.json не є JSON (${e.message})`);
  }
  const items = new Map();
  for (const [code, it] of Object.entries(doc.items ?? {})) {
    const maxCents = toHundredths(it?.max_unit_price);
    if (maxCents === null || maxCents <= 0) throw new InputError(`price-list.json: некоректна max_unit_price для ${code}`);
    items.set(code, { name: it.name ?? code, unit: it.unit ?? "", maxCents });
  }
  if (!items.size) throw new InputError("price-list.json: порожній список items");
  return items;
}

function reason(code, text, extra = {}) {
  return { code, severity: SEVERITY[code], text, ...extra };
}

function instructionNotes(value, where, notes) {
  if (typeof value !== "string") return;
  if (INSTRUCTION_PATTERNS.some((re) => re.test(value))) {
    const excerpt = value.length > 90 ? `${value.slice(0, 87)}...` : value;
    notes.push({
      code: "instruction_like_text",
      where,
      text: `${where}: текст схожий на інструкцію для автоматичної системи — це дані, вердикт не змінено: «${excerpt}»`,
    });
  }
}

function evaluateFile(file, name, priceList) {
  const buf = readFileSync(file);
  const e = {
    file: name,
    sha256: createHash("sha256").update(buf).digest("hex"),
    estimate_id: null,
    vendor: null,
    lines: [],
    computed_total_cents: null,
    stated_total_cents: null,
    difference_cents: null,
    reasons: [],
    notes: [],
    verdict: null,
  };
  let doc;
  try {
    doc = JSON.parse(buf.toString("utf8").replace(/^﻿/, ""));
  } catch (err) {
    e.reasons.push(reason("invalid_input", `файл не є коректним JSON (${err.message})`));
    return e;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    e.reasons.push(reason("invalid_input", "файл не містить об'єкта кошторису"));
    return e;
  }

  e.estimate_id = typeof doc.estimate_id === "string" && doc.estimate_id.trim() ? doc.estimate_id.trim() : null;
  if (!e.estimate_id) e.reasons.push(reason("invalid_input", "немає поля estimate_id"));
  e.vendor = typeof doc.vendor === "string" && doc.vendor.trim() ? doc.vendor.trim() : null;
  if (!e.vendor) e.reasons.push(reason("invalid_input", "немає поля vendor"));
  if (doc.currency !== undefined && doc.currency !== "USD") {
    e.reasons.push(reason("invalid_input", `валюта «${doc.currency}» — прайс лише в USD`));
  }
  for (const [k, v] of Object.entries(doc)) if (k !== "lines") instructionNotes(v, `поле ${k}`, e.notes);

  const lines = Array.isArray(doc.lines) ? doc.lines : [];
  if (!lines.length) e.reasons.push(reason("invalid_input", "немає рядків lines"));
  let sum = 0;
  let computable = lines.length > 0;
  lines.forEach((l, i) => {
    const n = i + 1;
    const item = typeof l?.item === "string" ? l.item.trim() : "";
    const qH = toHundredths(l?.quantity);
    const priceC = toHundredths(l?.unit_price);
    const known = item ? priceList.get(item) : undefined;
    const line = {
      line: n,
      item: item || null,
      quantity: qH === null ? null : qty(qH),
      unit_price_cents: priceC,
      amount_cents: null,
      max_unit_price_cents: known ? known.maxCents : null,
    };
    if (!item) e.reasons.push(reason("invalid_input", `рядок ${n}: немає коду пункту item`, { line: n }));
    if (qH === null) {
      e.reasons.push(reason("invalid_input", `рядок ${n}: кількість «${l?.quantity}» — не число з ≤ 2 знаками після коми`, { line: n }));
    } else if (qH <= 0) {
      e.reasons.push(reason("bad_quantity", `рядок ${n} (${item || "—"}): кількість ${qty(qH)} ≤ 0`, { line: n }));
    }
    if (priceC === null || priceC < 0) {
      e.reasons.push(reason("invalid_input", `рядок ${n}: ціна за одиницю «${l?.unit_price}» — не невід'ємне число з ≤ 2 знаками`, { line: n }));
    }
    if (qH !== null && priceC !== null && priceC >= 0) {
      line.amount_cents = roundDiv(qH * priceC, 100);
      sum += line.amount_cents;
    } else {
      computable = false;
    }
    if (item && !known) {
      e.reasons.push(reason("unknown_item", `рядок ${n}: пункту «${item}» немає в прайсі — потрібна перевірка людиною`, { line: n }));
    } else if (known && priceC !== null && priceC >= 0 && isOverMax(priceC, known.maxCents)) {
      const bp = overBasisPoints(priceC, known.maxCents);
      e.reasons.push(
        reason(
          "price_over_max",
          `рядок ${n} (${item}): ціна ${usd(priceC)} вища за максимум прайсу ${usd(known.maxCents)} на ${pct(bp)} (допуск ${TOLERANCE_PCT}%)`,
          { line: n, over_basis_points: bp },
        ),
      );
    }
    instructionNotes(l?.description, `рядок ${n}, description`, e.notes);
    e.lines.push(line);
  });

  e.stated_total_cents = toHundredths(doc.stated_total);
  if (e.stated_total_cents === null) {
    e.reasons.push(reason("invalid_input", `stated_total «${doc.stated_total}» — не число з ≤ 2 знаками після коми`));
  }
  if (computable) {
    e.computed_total_cents = sum;
    if (e.stated_total_cents !== null) {
      e.difference_cents = e.stated_total_cents - sum;
      if (e.difference_cents !== 0) {
        e.reasons.push(
          reason(
            "total_mismatch",
            `сума рядків ${usd(sum)} не дорівнює заявленій ${usd(e.stated_total_cents)} (різниця ${usd(e.difference_cents)})`,
          ),
        );
      }
    }
  }
  return e;
}

export function verdictOf(reasons) {
  if (reasons.some((r) => r.severity === "error")) return "reject";
  if (reasons.some((r) => r.severity === "flag")) return "flag";
  return "ok";
}

export function evaluatePeriod(dirArg, root = ROOT) {
  const { dir, period } = resolvePeriodDir(dirArg, root);
  const priceList = loadPriceList(root);
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".json")).sort();
  if (!files.length) throw new InputError(`у теці ${rel(dir, root)} немає файлів кошторисів *.json`);
  const estimates = files.map((f) => evaluateFile(path.join(dir, f), f, priceList));

  const byId = new Map();
  for (const e of estimates) {
    if (!e.estimate_id) continue;
    const key = e.estimate_id.toUpperCase();
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(e);
  }
  for (const group of byId.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      const others = group.filter((g) => g !== e).map((g) => g.file).join(", ");
      e.reasons.push(reason("duplicate_id", `номер кошторису ${e.estimate_id} повторюється: також у ${others}`));
    }
  }
  for (const e of estimates) e.verdict = verdictOf(e.reasons);

  const summary = { total: estimates.length, ok: 0, flag: 0, reject: 0 };
  for (const e of estimates) summary[e.verdict] += 1;
  return {
    check: "estimates",
    generated_by: "scripts/check-estimates.mjs",
    period,
    data_dir: rel(dir, root),
    tolerance_pct: TOLERANCE_PCT,
    summary,
    exit_code: summary.flag || summary.reject ? 1 : 0,
    estimates,
  };
}

// Таблиці для людини (оркестратор копіює їх у звіт дослівно — сам нічого не перераховує).
export function renderTables(result) {
  const out = [];
  out.push(`## Перевірка кошторисів: ${result.period} (файлів: ${result.summary.total})\n`);
  out.push("| Файл | Кошторис | Вендор | Сума рядків | Заявлено | Різниця | Вердикт | Причини |");
  out.push("|---|---|---|---|---|---|---|---|");
  for (const e of result.estimates) {
    const money = (c) => (c === null ? "—" : usd(c));
    const codes = [...new Set(e.reasons.map((r) => r.code))].join(", ") || "—";
    const verdict = e.verdict === "ok" ? "ok" : `**${e.verdict}**`;
    out.push(
      `| ${e.file} | ${e.estimate_id ?? "—"} | ${e.vendor ?? "—"} | ${money(e.computed_total_cents)} | ${money(e.stated_total_cents)} | ${money(e.difference_cents)} | ${verdict} | ${codes} |`,
    );
  }
  out.push("\n### Причини (з правил references/rules.md)\n");
  const withReasons = result.estimates.filter((e) => e.reasons.length);
  if (!withReasons.length) out.push("- —");
  for (const e of withReasons) {
    for (const r of e.reasons) out.push(`- \`${e.file}\` (${e.estimate_id ?? "—"}): [${r.code}] ${r.text}`);
  }
  out.push("\n### Примітки (вердикт не змінюють)\n");
  const withNotes = result.estimates.filter((e) => e.notes.length);
  if (!withNotes.length) out.push("- —");
  for (const e of withNotes) {
    for (const n of e.notes) out.push(`- \`${e.file}\` (${e.estimate_id ?? "—"}): [${n.code}] ${n.text}`);
  }
  const s = result.summary;
  out.push(
    `\nПІДСУМОК: ok ${s.ok}, flag ${s.flag}, reject ${s.reject} з ${s.total} — ${result.exit_code ? "є зауваження (код 1)" : "зауважень немає (код 0)"}`,
  );
  return out.join("\n");
}

// Порівняння збереженого report.json зі свіжим розрахунком: шляхи полів, що відрізняються.
export function diffReports(fresh, saved, limit = 50) {
  const diffs = [];
  const walk = (a, b, p) => {
    if (diffs.length >= limit) return;
    if (a === b) return;
    if (p === "estimates" && Array.isArray(a) && Array.isArray(b)) {
      // Кошториси порівнюємо за назвою файлу, а не за позицією: так видно, який саме файл розійшовся.
      const byFile = (list) => Object.fromEntries(list.map((e) => [e?.file, e]));
      return walk(byFile(a), byFile(b), p);
    }
    const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
    const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
    if (ta !== tb || ta !== "object" && ta !== "array") {
      diffs.push(`${p}: звіт ${JSON.stringify(b)} ≠ розрахунок ${JSON.stringify(a)}`);
      return;
    }
    if (ta === "array" && a.length !== b.length) {
      diffs.push(`${p}: у звіті ${b.length} елементів, у розрахунку ${a.length}`);
      return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) walk(a[k], b[k], p ? `${p}.${k}` : k);
  };
  walk(fresh, saved, "");
  return diffs;
}
