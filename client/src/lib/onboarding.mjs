// Onboarding answers -> complete_onboarding() payload (design handoff, Onboarding).
// The form keeps rupee strings; the database takes paise. "Nothing blocks": anything
// that would make the save fail (blank or repeated names) is fixed up here instead.
import { inr, toMinor } from "./money.mjs";

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
 *   cats: Array<{ name: string, limit: string, on: boolean }>,
 *   goal?: { name: string, target: string, by: string }
 * }} s
 * @returns {{ p_take_home_pay: number | null, p_pay_day: number, p_savings_pct: number,
 *   p_bills: Array<{ name: string, amount: number, due_day: number | null }>,
 *   p_categories: Array<{ name: string, limit: number | null }>,
 *   p_goal?: { name: string, target: number, target_date: string | null } }}
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
  // The optional first goal (step 3): only with a name and a target; "by" is a month, YYYY-MM.
  const goalName = s.goal?.name.trim() ?? "";
  const goalTarget = +(s.goal?.target ?? 0);
  const goal =
    goalName && goalTarget > 0
      ? { name: goalName, target: toMinor(goalTarget), target_date: s.goal?.by ? `${s.goal.by}-01` : null }
      : null;
  return {
    p_take_home_pay: salary > 0 ? toMinor(salary) : null,
    // 31 = the last day of the month; otherwise 1-28.
    p_pay_day: s.payDay === "31" ? 31 : +clampDay(s.payDay) || 1,
    p_savings_pct: s.pct,
    p_bills: bills,
    p_categories: categories,
    ...(goal && { p_goal: goal }),
  };
}

/**
 * About how many cycles the first goal takes at the chosen save %: the "about 4 months" line.
 * Whole units of one currency throughout. Null when nothing would be saved or there's no target.
 * @param {number} target @param {number} salary @param {number} pct
 */
export function monthsToGoal(target, salary, pct) {
  const perCycle = (salary * pct) / 100;
  return target > 0 && perCycle > 0 ? Math.ceil(target / perCycle) : null;
}

/**
 * The goal step's pace line (handoff v4 §3). Whole units of one currency; `by` is YYYY-MM or "" (no
 * end date), `today` YYYY-MM-DD. Null when there's no target yet. `warn` when the pace is more than
 * the savings set in step 2.
 * @param {number} target @param {number} save @param {string} by @param {string} today
 * @returns {{ text: string, warn: boolean } | null}
 */
export function goalPace(target, save, by, today) {
  if (!(target > 0)) return null;
  const $ = (/** @type {number} */ whole) => inr(toMinor(whole));
  if (!by) {
    return {
      text: save
        ? `No deadline. At your full savings of ${$(save)} a month, you’d get there in about ${Math.ceil(target / save)} months.`
        : "No deadline. Add money whenever you like.",
      warn: false,
    };
  }
  const months = (+by.slice(0, 4) - +today.slice(0, 4)) * 12 + (+by.slice(5, 7) - +today.slice(5, 7));
  if (months < 1) return null;
  const per = Math.ceil(target / months);
  if (!save) return { text: `That’s ${$(per)} a month for ${months} months.`, warn: false };
  if (per > save)
    return {
      text: `That’s ${$(per)} a month, ${$(per - save)} more than you’re saving. Push the date out, lower the target, or raise your savings.`,
      warn: true,
    };
  return {
    text: `That’s ${$(per)} a month for ${months} months, ${Math.round((per / save) * 100)}% of what you save.`,
    warn: false,
  };
}
