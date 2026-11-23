// Onboarding answers -> complete_onboarding() payload (design handoff, Onboarding).
// The form keeps rupee strings; the database takes paise. "Nothing blocks": anything
// that would make the save fail (blank or repeated names) is fixed up here instead.
import { toMinor } from "./money.mjs";

export const ONBOARDING_CATEGORIES = [
  "Groceries",
  "Dining out",
  "Fuel",
  "Shopping",
  "Entertainment",
  "Health",
  "Travel",
  "Personal care",
];
export const DEFAULT_BILLS = [
  { name: "Rent", amt: "", due: "3" },
  { name: "Electricity", amt: "", due: "" },
  { name: "Internet", amt: "", due: "5" },
];

/** Keep at most n digits. */
export const digits = (/** @type {string} */ v, /** @type {number} */ n) => String(v).replace(/\D/g, "").slice(0, n);

/** Day-of-month input: 1-28 while typing ("31" -> "28", "0" -> "1"), blank allowed. */
export function clampDay(/** @type {string} */ v) {
  const d = digits(v, 2);
  if (!d) return "";
  if (+d > 28) return "28";
  return +d === 0 ? "1" : String(+d);
}

/** Bills that will be saved: those with an amount, each with a name. */
export const keptBills = (/** @type {Array<{ name: string, amt: string, due: string }>} */ bills) =>
  bills.filter((b) => +b.amt > 0).map((b) => ({ ...b, name: b.name.trim() || "Bill" }));

/**
 * @param {{
 *   salary: string, payDay: string, pct: number,
 *   bills: Array<{ name: string, amt: string, due: string }>,
 *   cats: Array<{ name: string, limit: string, on: boolean }>
 * }} s
 * @returns {{ p_take_home_pay: number | null, p_pay_day: number, p_savings_pct: number,
 *   p_bills: Array<{ name: string, amount: number, due_day: number | null }>,
 *   p_categories: Array<{ name: string, limit: number | null }> }}
 */
export function onboardingPayload(s) {
  const used = new Set();
  // Names must be unique across bills and categories (case-insensitive): "Bill", "Bill 2", …
  const unique = (/** @type {string} */ name) => {
    let candidate = name,
      n = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${name} ${n++}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
  const categories = s.cats
    .filter((c) => c.on)
    .map((c) => ({ name: unique(c.name), limit: +c.limit > 0 ? toMinor(+c.limit) : null }));
  const bills = keptBills(s.bills).map((b) => ({
    name: unique(b.name),
    amount: toMinor(+b.amt),
    due_day: b.due ? +clampDay(b.due) : null,
  }));
  const salary = +s.salary || 0;
  return {
    p_take_home_pay: salary > 0 ? toMinor(salary) : null,
    // 31 = the last day of the month; otherwise 1-28.
    p_pay_day: s.payDay === "31" ? 31 : +clampDay(s.payDay) || 1,
    p_savings_pct: s.pct,
    p_bills: bills,
    p_categories: categories,
  };
}
