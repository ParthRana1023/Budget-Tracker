// The dashboard's money model for one pay-day cycle (design handoff, "pay yourself first"):
// savings come off the top, fixed bills are reserved next, whatever is left is safe to spend.
// All amounts are integer paise. Dates are local 'YYYY-MM-DD'.

import { recurringStatus } from "./recurringStatus.mjs";

/**
 * @typedef {{ id: string, name: string, type: "fixed" | "flexible", monthly_limit: number, due_day?: number | null, is_active?: boolean }} Category
 * @typedef {{ id: string, type: string, amount: number, date: string, category_id?: string | null,
 *   from_reserve?: boolean, source?: string | null, external_id?: string | null }} Tx
 */

/**
 * @param {{
 *   settings: { take_home_pay?: number | null, savings_pct?: number | null } | null,
 *   categories: Category[], transactions: Tx[],
 *   recurringItems: Array<{ id: string, type: string, amount: number, category_id: string | null, day_of_month: number | null, active: boolean, skip_month?: string | null }>,
 *   period: { startStr: string, endStr: string, totalDays: number, daysElapsed: number, daysRemaining: number },
 *   today: string
 * }} input
 */
export function buildCycleModel({ settings, categories, transactions, recurringItems, period, today }) {
  const amt = (/** @type {Tx} */ t) => Number(t.amount);
  const active = categories.filter((c) => c.is_active !== false);
  const byId = new Map(active.map((c) => [c.id, c]));
  const flex = active.filter((c) => c.type === "flexible");
  const fixed = active.filter((c) => c.type === "fixed");

  const cycleTransactions = transactions.filter((t) => t.date >= period.startStr && t.date <= period.endStr);
  const spentByCat = new Map(active.map((c) => [c.id, 0]));
  let income = 0,
    regularSaved = 0,
    windfallSaved = 0,
    reservedThisCycle = 0,
    flexSpent = 0;
  for (const t of cycleTransactions) {
    if (t.type === "expense" && !t.from_reserve) {
      const c = t.category_id ? byId.get(t.category_id) : undefined;
      if (c) spentByCat.set(c.id, (spentByCat.get(c.id) ?? 0) + amt(t));
      // Uncategorised or switched-off categories still cost money: count them as everyday spending.
      if (!c || c.type === "flexible") flexSpent += amt(t);
    } else if (t.type === "income") income += amt(t);
    else if (t.type === "savings_transfer") {
      if (t.source === "windfall") windfallSaved += amt(t);
      else regularSaved += amt(t);
    } else if (t.type === "reserve_transfer") reservedThisCycle += amt(t);
  }

  // The reserve is a running balance across cycles.
  let reserveIn = 0,
    reserveOut = 0;
  for (const t of transactions) {
    if (t.type === "reserve_transfer") reserveIn += amt(t);
    else if (t.type === "expense" && t.from_reserve) reserveOut += amt(t);
  }

  // A fixed bill whose recurring item was skipped this month is not owed this cycle.
  const statusCtx = { cycleTransactions, period, today };
  const skippedCats = new Set(
    recurringItems
      .filter((r) => r.category_id && recurringStatus(r, statusCtx).key === "skipped")
      .map((r) => r.category_id),
  );

  let fixedCommitted = 0,
    unpaidBills = 0;
  for (const c of fixed) {
    const spent = spentByCat.get(c.id) ?? 0,
      limit = Number(c.monthly_limit);
    if (skippedCats.has(c.id)) fixedCommitted += spent;
    else {
      fixedCommitted += Math.max(limit, spent);
      unpaidBills += Math.max(0, limit - spent);
    }
  }

  const takeHome = Number(settings?.take_home_pay ?? 0),
    pct = Number(settings?.savings_pct ?? 0);
  const savingsTarget = Math.round((takeHome * pct) / 100);
  const savingsSetAside = Math.max(savingsTarget, regularSaved);
  const safe = income - savingsSetAside - windfallSaved - reservedThisCycle - fixedCommitted - flexSpent;

  const flexBudget = flex.reduce((s, c) => s + Number(c.monthly_limit), 0);
  const expectedByToday = Math.round((flexBudget * period.daysElapsed) / period.totalDays);

  return {
    cycleTransactions,
    byId,
    flex,
    fixed,
    spentByCat,
    skippedCats,
    income,
    savingsTarget,
    regularSaved,
    windfallSaved,
    /** Savings for the hero line: the monthly target (or more, if more was saved) plus windfall savings. */
    savedTotal: savingsSetAside + windfallSaved,
    reservedThisCycle,
    reserveIn,
    reserveOut,
    reserveLeft: reserveIn - reserveOut,
    fixedCommitted,
    unpaidBills,
    flexSpent,
    flexBudget,
    safe,
    perDay: Math.floor(Math.max(0, safe) / Math.max(1, period.daysRemaining)),
    /** Hero bar parts; the UI divides each by max(income, 1). */
    bar: {
      savings: savingsSetAside + windfallSaved + reservedThisCycle,
      bills: fixedCommitted,
      spent: flexSpent,
      safe,
    },
    /** Positive = under where an even spend of the flexible budget would be by today. */
    paceDiff: expectedByToday - flexSpent,
  };
}
