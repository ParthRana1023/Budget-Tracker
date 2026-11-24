// Base currency switch (design handoff v3, Currency). A cycle always has one base, so safe to
// spend never mixes currencies. Sums across cycles (Reports, the reserve, goal savings) convert
// entries made in an older base into today's base at the current cycle's rate, as the user chose.
// Stored amounts never change: converted copies carry `recorded_amount` / `recorded_currency`.
import { convert } from "./fx.mjs";
import { baseCurrency } from "./money.mjs";

/** @typedef {import("./periods.mjs").PlanChange} PlanChange */
/** @typedef {{ currency?: string, currency_next?: string | null, currency_from?: string | null, plan_changes?: PlanChange[] | null }} BaseSettings */

/** Currency rows still in force, oldest first. @param {BaseSettings | null | undefined} settings */
const switches = (settings) =>
  (settings?.plan_changes ?? [])
    .filter((r) => r.field === "currency" && !r.superseded_at && r.to_text)
    .sort((a, b) => (a.effective_from < b.effective_from ? -1 : a.effective_from > b.effective_from ? 1 : 0));

/**
 * The base in effect on `date` (like the database's stamp_base_currency).
 * @param {BaseSettings | null | undefined} settings @param {string} date
 */
export function baseOn(settings, date) {
  const rows = switches(settings);
  let base = rows[0]?.from_text ?? settings?.currency ?? baseCurrency();
  for (const r of rows) if (r.effective_from <= date) base = /** @type {string} */ (r.to_text);
  return base;
}

/**
 * The latest switch that has happened: from which base, to which, starting when.
 * @param {BaseSettings | null | undefined} settings @param {string} today
 * @returns {{ from: string, to: string, on: string } | null}
 */
export function lastSwitch(settings, today) {
  const done = switches(settings).filter((r) => r.effective_from <= today && r.to_text === settings?.currency);
  const r = done[done.length - 1];
  return r
    ? { from: /** @type {string} */ (r.from_text), to: /** @type {string} */ (r.to_text), on: r.effective_from }
    : null;
}

/**
 * Today's rate (base units per 1 unit) for each currency, from rows priced in it: bills, limits
 * and goals set in the old base become such rows at the switch and are re-priced every cycle.
 * @param {Array<{ original_currency?: string | null, fx_rate?: number | null, fx_date?: string | null }>} rows
 * @returns {Map<string, number>}
 */
export function ratesFromRows(rows) {
  /** @type {Map<string, { rate: number, date: string }>} */
  const best = new Map();
  for (const r of rows) {
    const c = r.original_currency,
      rate = Number(r.fx_rate),
      date = r.fx_date ?? "";
    if (!c || !(rate > 0)) continue;
    const was = best.get(c);
    if (!was || date > was.date) best.set(c, { rate, date });
  }
  return new Map([...best].map(([c, v]) => [c, v.rate]));
}

/**
 * Bases other than today's among `list`.
 * @template T @param {T[]} list @param {(row: T) => string | null | undefined} baseOf @param {string} [base]
 * @returns {string[]}
 */
export const otherBases = (list, baseOf, base = baseCurrency()) => [
  .../** @type {Set<string>} */ (new Set(list.map(baseOf).filter((c) => !!c && c !== base))),
];

/**
 * Rows made in another base, converted into today's base at `rates`. Rows without a rate yet
 * are left as they are until it loads.
 * @template {{ amount: number }} T
 * @param {T[]} list @param {(row: T) => string | null | undefined} baseOf @param {Map<string, number>} rates
 * @param {string} [base]
 * @returns {Array<T & { recorded_amount?: number, recorded_currency?: string }>}
 */
export function inTodaysBase(list, baseOf, rates, base = baseCurrency()) {
  return list.map((row) => {
    const c = baseOf(row),
      rate = c ? rates.get(c) : undefined;
    if (!c || c === base || !(Number(rate) > 0)) return row;
    return {
      ...row,
      amount: convert(Number(row.amount), c, /** @type {number} */ (rate), base),
      recorded_amount: Number(row.amount),
      recorded_currency: c,
    };
  });
}
