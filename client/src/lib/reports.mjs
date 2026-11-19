// Reports numbers (design handoff, Reports), built from real transactions, one entry per
// pay-day cycle (same as calendar months when salary lands on the 1st). Amounts in paise.

import { cycleFor } from "./periods.mjs";
import { addDaysStr, cycleDayOf } from "./cycle.mjs";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_L = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const amt = (t) => Number(t.amount);

/**
 * The last `count` cycles, oldest first; the last one is the current (partial) cycle.
 * @param {{ transactions: any[], categories: any[], schedule: import("./periods.mjs").PayDayEntry[], today: string, count: number }} input
 */
export function cycleHistory({ transactions, categories, schedule, today, count }) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  // Walk back one cycle at a time, so cycles keep their real dates across pay-day changes.
  const periods = [];
  for (let ref = today; periods.length < count;) {
    const [y, m, d] = ref.split("-").map(Number);
    const p = cycleFor(new Date(y, m - 1, d, 12), schedule);
    periods.unshift(p);
    ref = addDaysStr(p.startStr, -1);
  }
  const out = [];
  for (const [i, period] of periods.entries()) {
    const [sy, sm] = period.startStr.split("-").map(Number);
    const cy = {
      key: period.startStr,
      label: MON[sm - 1],
      labelLong: MON_L[sm - 1],
      year: sy,
      period,
      partial: i === periods.length - 1,
      income: 0,
      fixed: 0,
      flex: 0,
      saved: 0,
      extraSaved: 0,
      byCat: new Map(),
      daily: Array(period.totalDays).fill(0),
      entries: [],
      rate: /** @type {number | null} */ (null),
    };
    for (const t of transactions) {
      if (t.date < period.startStr || t.date > period.endStr) continue;
      cy.entries.push(t);
      if (t.type === "income") cy.income += amt(t);
      else if (t.type === "savings_transfer") {
        if (t.source === "windfall") cy.extraSaved += amt(t);
        else cy.saved += amt(t);
      } else if (t.type === "expense" && !t.from_reserve) {
        const c = byId.get(t.category_id);
        if (c?.type === "fixed") cy.fixed += amt(t);
        else {
          cy.flex += amt(t);
          cy.daily[cycleDayOf(t.date, period) - 1] += amt(t);
          const key = c?.id ?? "none";
          cy.byCat.set(key, (cy.byCat.get(key) ?? 0) + amt(t));
        }
      }
    }
    cy.rate = cy.income > 0 ? ((cy.saved + cy.extraSaved) / cy.income) * 100 : null;
    out.push(cy);
  }
  return out;
}

/** Flexible spend up to and including cycle day `day`. */
export const flexByDay = (cy, day) => cy.daily.slice(0, day).reduce((a, b) => a + b, 0);

/** Biggest payees in a cycle: the payee field, or a name guessed from the note. */
export function topPayees(current, previous, limit = 5) {
  const group = (cy) => {
    const g = new Map();
    for (const t of cy?.entries ?? []) {
      if (t.type !== "expense" || t.from_reserve) continue;
      const name = (t.payee || (t.note ?? "").split(/[,·]| - | at | from /i)[0] || "Other").trim().replace(/\s+/g, " ");
      const key = name.toLowerCase();
      const row = g.get(key) ?? { name, amount: 0, count: 0, entries: [] };
      row.amount += amt(t);
      row.count++;
      row.entries.push(t);
      g.set(key, row);
    }
    return g;
  };
  const now = group(current),
    before = group(previous);
  return [...now.entries()]
    .map(([key, r]) => ({ ...r, previous: before.get(key)?.amount ?? null }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Average flexible spend per weekday (Mon..Sun) over the given cycles, up to `today`. */
export function weekdayAverages(cycles, today) {
  const sum = Array(7).fill(0),
    cnt = Array(7).fill(0);
  for (const cy of cycles) {
    for (let k = 1; k <= cy.period.totalDays; k++) {
      const date = addDaysStr(cy.period.startStr, k - 1);
      if (date > today) break;
      const [y, m, d] = date.split("-").map(Number);
      const wd = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
      sum[wd] += cy.daily[k - 1];
      cnt[wd]++;
    }
  }
  return sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
}

/** Round up to the next ₹250, in paise. */
const roundLimit = (paise) => Math.ceil(paise / 25000) * 25000;

/**
 * Suggested limits from the last three full cycles (design handoff, Plan ahead).
 * @returns {Array<{ categoryId: string, name: string, from: number, to: number, tag: "Raise" | "Lower" | "Set a limit", average: number, overCount: number, high: number }>}
 */
export function suggestLimits(flexCategories, fullCycles) {
  const last3 = fullCycles.slice(-3);
  if (!last3.length) return [];
  const out = [];
  for (const c of flexCategories) {
    const v = last3.map((cy) => cy.byCat.get(c.id) ?? 0);
    const average = v.reduce((a, b) => a + b, 0) / v.length,
      lim = Number(c.monthly_limit);
    const base = {
      categoryId: c.id,
      name: c.name,
      from: lim,
      average,
      overCount: v.filter((x) => lim && x > lim).length,
      high: Math.max(...v),
    };
    if (lim && average > lim * 1.05) out.push({ ...base, to: roundLimit(average), tag: "Raise" });
    else if (lim && average < lim * 0.9 && roundLimit(average) < lim)
      out.push({ ...base, to: roundLimit(average), tag: "Lower" });
    else if (!lim && average > 0) out.push({ ...base, to: roundLimit(average * 1.2), tag: "Set a limit" });
  }
  return out;
}

/**
 * Next cycle's forecast: pay − savings − fixed bills − other recurring payments = flexible room.
 * @param {{ settings: any, fixed: any[], recurringItems: any[], flex: any[], fullCycles: any[], lastIncome: number }} input
 */
export function forecastNext({ settings, fixed, recurringItems, flex, fullCycles, lastIncome }) {
  const income = Number(settings?.take_home_pay ?? 0) || lastIncome;
  const savings = Math.round((income * Number(settings?.savings_pct ?? 0)) / 100);
  const fixedTotal = fixed.reduce((s, c) => s + Number(c.monthly_limit), 0);
  const fixedIds = new Set(fixed.map((c) => c.id));
  const subs = recurringItems.filter((r) => r.active && r.type === "expense" && !fixedIds.has(r.category_id));
  const subsTotal = subs.reduce((s, r) => s + Number(r.amount), 0);
  const left = income - savings - fixedTotal - subsTotal;
  const last3 = fullCycles.slice(-3);
  const typical = last3.length ? last3.reduce((s, cy) => s + cy.flex, 0) / last3.length : 0;
  const plan = flex.reduce((s, c) => s + Number(c.monthly_limit), 0);
  return { income, savings, fixedTotal, subs, subsTotal, left, typical, plan, gap: left - typical };
}
