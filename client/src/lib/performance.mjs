// Financial performance indicators over MonthSummary rows from reportsUtils.computeMonthlyTrends.
// Amounts in paise. Months with no activity at all are ignored so empty history
// does not drag averages to zero.

/**
 * @typedef {{
 *   monthKey: string, monthLabel: string, regularIncome: number, variableIncome: number,
 *   fixedExpenses: number, flexibleExpenses: number, totalExpenses: number,
 *   savingsContributions: number, baselineSavingsRate: number
 * }} MonthRow
 */

/** Percent change from prev to cur, or null when there is no base to compare with. */
export function pctChange(/** @type {number} */ cur, /** @type {number} */ prev) {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

/** @param {MonthRow} m */
const hasActivity = (m) => m.regularIncome + m.variableIncome + m.totalExpenses + m.savingsContributions > 0;

/**
 * @param {MonthRow[]} months chronological
 * @returns {null | {
 *   monthsCounted: number, avgExpenses: number, avgSavings: number, avgSavingsRate: number | null,
 *   highestSpendMonth: MonthRow | null, bestSavingsMonth: MonthRow | null,
 *   flexibleChangePct: number | null, flexibleChangeFrom: MonthRow | null, flexibleChangeTo: MonthRow | null
 * }}
 */
export function computePerformance(months) {
  const active = months.filter(hasActivity);
  if (active.length === 0) return null;

  const n = active.length;
  const sum = (/** @type {(m: MonthRow) => number} */ f) => active.reduce((s, m) => s + f(m), 0);
  const withSalary = active.filter((m) => m.regularIncome > 0);

  const maxBy = (/** @type {(m: MonthRow) => number} */ f) =>
    active.reduce((/** @type {MonthRow | null} */ best, m) => (f(m) > 0 && (!best || f(m) > f(best)) ? m : best), null);

  const last = active.at(-1) ?? null;
  const prev = active.length >= 2 ? active.at(-2) ?? null : null;

  return {
    monthsCounted: n,
    avgExpenses: Math.round(sum((m) => m.totalExpenses) / n),
    avgSavings: Math.round(sum((m) => m.savingsContributions) / n),
    // Baseline rate (savings / regular income) so bonuses do not inflate it.
    avgSavingsRate: withSalary.length
      ? withSalary.reduce((s, m) => s + m.baselineSavingsRate, 0) / withSalary.length
      : null,
    highestSpendMonth: maxBy((m) => m.totalExpenses),
    bestSavingsMonth: maxBy((m) => m.savingsContributions),
    flexibleChangePct: last && prev ? pctChange(last.flexibleExpenses, prev.flexibleExpenses) : null,
    flexibleChangeFrom: prev,
    flexibleChangeTo: last,
  };
}

/**
 * Compare two equal-length periods (e.g. last 3 months vs the 3 before).
 * Returns null when the previous period has no activity to compare with.
 * @param {MonthRow[]} current
 * @param {MonthRow[]} previous
 */
export function comparePeriods(current, previous) {
  const cur = computePerformance(current);
  const prev = computePerformance(previous);
  if (!cur || !prev) return null;
  return {
    expensesChangePct: pctChange(cur.avgExpenses, prev.avgExpenses),
    savingsChangePct: pctChange(cur.avgSavings, prev.avgSavings),
    savingsRateChangePts:
      cur.avgSavingsRate !== null && prev.avgSavingsRate !== null ? cur.avgSavingsRate - prev.avgSavingsRate : null,
  };
}
