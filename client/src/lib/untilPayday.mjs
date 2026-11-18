// "Until payday" projection (design handoff, dashboard). Day 0 = start of the cycle's
// first day, day k = end of cycle day k, day N = end of the last day (payday is next).
// All amounts are integer paise.

import { addDaysStr, cycleDayOf, dueDateInCycle } from "./cycle.mjs";
import { recurringStatus } from "./recurringStatus.mjs";

const HISTORY_DAYS = 90;
const isRecurringEntry = (/** @type {{ external_id?: string | null }} */ t) => !!t.external_id?.startsWith("recurring:");
const weekdayOf = (/** @type {string} */ dateStr) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/**
 * @param {{
 *   model: ReturnType<typeof import("./cycleModel.mjs").buildCycleModel>,
 *   period: { startStr: string, totalDays: number, daysElapsed: number },
 *   today: string,
 *   transactions: Array<any>,
 *   recurringItems: Array<any>,
 *   dailySpend?: number | null,
 *   weekPattern?: boolean,
 * }} input  transactions: all of the user's (history drives the weekday pattern);
 *   dailySpend: slider value in paise a day, null = the user's own pace; weekPattern: "My week" (true) or "Even".
 */
export function projectUntilPayday({ model, period, today, transactions, recurringItems, dailySpend = null, weekPattern = true }) {
  const DAY = period.daysElapsed, N = period.totalDays;
  const amt = (t) => Number(t.amount);
  const isFlexible = (t) => model.byId.get(t.category_id)?.type !== "fixed"; // uncategorised counts as everyday spending
  const everyday = (t) => t.type === "expense" && !t.from_reserve && isFlexible(t) && !isRecurringEntry(t);

  // Pace: everyday spending so far this cycle. Recurring items are left out of the
  // average because they show up as their own drop on their due day.
  const spentSoFar = model.cycleTransactions.filter((t) => t.date <= today && everyday(t)).reduce((s, t) => s + amt(t), 0);
  const pace = spentSoFar / Math.max(1, DAY);
  const burn = dailySpend ?? pace;

  // Payments still to come, by cycle day. Overdue ones come off tomorrow.
  /** @type {Map<number, Array<{ name: string, amount: number, overdue: boolean, recurring: boolean }>>} */
  const bills = new Map();
  const put = (dueDate, item) => {
    const k = dueDate ? cycleDayOf(dueDate, period) : 0;
    const day = k > DAY ? k : DAY + 1;
    bills.set(day, [...(bills.get(day) ?? []), { ...item, overdue: !!dueDate && k <= DAY }]);
  };
  for (const c of model.fixed) {
    const owe = model.skippedCats.has(c.id) ? 0 : Math.max(0, Number(c.monthly_limit) - (model.spentByCat.get(c.id) ?? 0));
    if (owe) put(c.due_day ? dueDateInCycle(c.due_day, period) : null, { name: c.name, amount: owe, recurring: false });
  }
  const statusCtx = { cycleTransactions: model.cycleTransactions, period, today };
  for (const r of recurringItems) {
    if (r.type !== "expense" || !r.active || !r.day_of_month) continue;
    if (model.byId.get(r.category_id)?.type === "fixed") continue; // its fixed bill is already counted
    const st = recurringStatus(r, statusCtx);
    if (st.key === "due" || st.key === "upcoming") put(st.dueDate, { name: r.name, amount: Number(r.amount), recurring: true });
  }

  // What actually happened, day by day.
  /** @type {Map<number, number>} */
  const delta = new Map();
  /** @type {Map<number, { flex: number, items: Array<{ label: string, amount: number }> }>} */
  const past = new Map();
  for (const t of model.cycleTransactions) {
    if (t.date > today) continue;
    const day = cycleDayOf(t.date, period);
    let dv = 0;
    if (t.type === "expense" && !t.from_reserve) dv = -amt(t);
    else if (t.type === "income" && day > 1) dv = amt(t); // pay on day 1 is part of the opening amount
    else if ((t.type === "savings_transfer" && t.source === "windfall") || t.type === "reserve_transfer") dv = -amt(t);
    if (!dv) continue;
    delta.set(day, (delta.get(day) ?? 0) + dv);
    const p = past.get(day) ?? { flex: 0, items: [] };
    if (t.type === "expense" && isFlexible(t) && !isRecurringEntry(t)) p.flex += amt(t);
    else p.items.push({ label: t.note || model.byId.get(t.category_id)?.name || "Entry", amount: dv });
    past.set(day, p);
  }

  const todayValue = model.safe + model.unpaidBills;
  const openValue = todayValue - [...delta.values()].reduce((s, v) => s + v, 0);

  // Weekday pattern from the last 90 days of everyday spending (not just this cycle).
  const sum = Array(7).fill(0), cnt = Array(7).fill(0);
  const from = addDaysStr(today, -HISTORY_DAYS);
  for (let d = from; d < today; d = addDaysStr(d, 1)) cnt[weekdayOf(d)]++;
  for (const t of transactions) if (t.date >= from && t.date < today && everyday(t)) sum[weekdayOf(t.date)] += amt(t);
  const avg = sum.map((s, i) => (cnt[i] ? s / cnt[i] : 0));
  const mean = avg.reduce((a, b) => a + b, 0) / 7;
  const weight = avg.map((a) => (weekPattern && mean > 0 ? 0.35 + 0.65 * (a / mean) : 1));
  const dowOfDay = (k) => weekdayOf(addDaysStr(period.startStr, k - 1));
  const future = [];
  for (let k = DAY + 1; k <= N; k++) future.push(k);
  const wMean = future.length ? future.reduce((s, k) => s + weight[dowOfDay(k)], 0) / future.length : 1;
  /** Estimated everyday spending on a future day; the future days add up to burn × days left. */
  const spendOn = (k) => burn * (weight[dowOfDay(k)] / (wMean || 1));

  /** @type {Array<[number, number]>} */
  const pastPoints = [[0, openValue]];
  /** @type {Map<number, number>} end-of-day balance */
  const eod = new Map();
  let v = openValue;
  for (let k = 1; k <= DAY; k++) {
    v += delta.get(k) ?? 0;
    eod.set(k, v);
    pastPoints.push([k, v]);
  }
  /** @type {Array<[number, number]>} */
  const futurePoints = [[DAY, todayValue]];
  const dots = [];
  v = todayValue;
  for (const k of future) {
    v -= spendOn(k);
    for (const b of bills.get(k) ?? []) v -= b.amount;
    eod.set(k, v);
    futurePoints.push([k, v]);
    for (const b of bills.get(k) ?? []) dots.push({ day: k, value: v, bill: b });
  }

  const finalValue = eod.get(N) ?? todayValue;
  return {
    pace,
    burn,
    /** Slider range: 0 to twice the user's pace, at least ₹500, in ₹500 steps. */
    sliderMax: Math.max(50000, Math.ceil((pace * 2) / 50000) * 50000),
    openValue,
    todayValue,
    pastPoints,
    futurePoints,
    eod,
    bills,
    past,
    dots,
    spendOn,
    finalValue,
    /** First future day the balance goes below ₹0, or null. */
    shortDay: future.find((k) => (eod.get(k) ?? 0) < 0) ?? null,
  };
}

/**
 * Smooth SVG path through points (already in chart coordinates) using monotone cubic
 * interpolation (Fritsch–Carlson): no overshoot past neighbouring points, flat where
 * the data is flat, so a bill shows as a steeper slope, never a bump.
 * @param {Array<[number, number]>} pts
 */
export function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return "";
  const f = (x) => +x.toFixed(2);
  if (n === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}`;
  const slope = pts.slice(0, -1).map((p, i) => (pts[i + 1][1] - p[1]) / (pts[i + 1][0] - p[0] || 1));
  const tan = pts.map((_, i) =>
    i === 0 ? slope[0] : i === n - 1 ? slope[n - 2] : slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  );
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tan[i] = tan[i + 1] = 0;
      continue;
    }
    const a = tan[i] / slope[i], b = tan[i + 1] / slope[i], q = a * a + b * b;
    if (q > 9) {
      const t = 3 / Math.sqrt(q);
      tan[i] = t * a * slope[i];
      tan[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3;
    d += ` C${f(x0 + h)} ${f(y0 + tan[i] * h)} ${f(x1 - h)} ${f(y1 - tan[i + 1] * h)} ${f(x1)} ${f(y1)}`;
  }
  return d;
}
