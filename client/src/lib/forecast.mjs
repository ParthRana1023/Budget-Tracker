// Forward-looking forecast for the next N budget cycles. Amounts in paise.
//
// Every line is tagged with where it comes from:
//   planned   - something the user configured (budget plan, recurring schedule, category limit)
//   estimated - an average of recent completed months, used only when nothing is configured
// Expected (unreceived) variable income is never counted; it is reported separately.
// If there is no basis at all for income, the forecast is null rather than invented.

import { getPeriodRange } from "./periods.mjs";

const MIN_HISTORY_MONTHS = 2;

/**
 * @typedef {"planned" | "estimated"} LineKind
 * @typedef {{ amount: number, kind: LineKind, source: string }} Line
 * @typedef {{ regularIncome: number, fixedExpenses: number, flexibleExpenses: number, savingsContributions: number }} HistoryMonth
 * @typedef {{
 *   cycle_start: string, expected_regular_income: number, expected_variable_income: number,
 *   planned_savings: number, categories?: Array<{ category_id: string, planned_limit: number }>
 * }} BudgetPlan
 */

/**
 * Average of a field over history months where it is non-zero, if there are enough of them.
 * @param {HistoryMonth[]} history
 * @param {(m: HistoryMonth) => number} f
 */
function historyAverage(history, f) {
  const values = history.map(f).filter((v) => v > 0);
  return values.length >= MIN_HISTORY_MONTHS ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null;
}

/**
 * @param {{
 *   cycles: number,
 *   referenceDate?: Date,
 *   monthStartDay: number,
 *   categories: Array<{ id: string, type: string, monthly_limit: number }>,
 *   recurringItems: Array<{ amount: number, type: string, category_id: string | null, active?: boolean, income_type?: string }>,
 *   incomeSources: Array<{ type: string, status: string, amount: number, expected_date?: string | null }>,
 *   history: HistoryMonth[],
 *   plans?: BudgetPlan[]
 * }} input history = completed months only (exclude the current, partial month)
 */
export function computeForecast({ cycles, referenceDate = new Date(), monthStartDay, categories, recurringItems, incomeSources, history, plans = [] }) {
  const activeRecurring = recurringItems.filter((r) => r.active !== false);
  const recurringIncome = activeRecurring
    .filter((r) => r.type === "income" && r.income_type !== "variable")
    .reduce((s, r) => s + Number(r.amount), 0);

  const avgIncome = historyAverage(history, (m) => m.regularIncome);
  const avgFixed = historyAverage(history, (m) => m.fixedExpenses);
  const avgFlexible = historyAverage(history, (m) => m.flexibleExpenses);
  const avgSavings = historyAverage(history, (m) => m.savingsContributions);

  const results = [];
  let cursor = getPeriodRange(referenceDate, monthStartDay);
  for (let i = 0; i < cycles; i++) {
    const end = cursor.endDate;
    cursor = getPeriodRange(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 12), monthStartDay);
    const { startStr, endStr, periodLabel } = cursor;
    const plan = plans.find((p) => p.cycle_start === startStr) ?? null;

    /** @type {Line | null} */
    let income = null;
    if (plan && plan.expected_regular_income > 0) income = { amount: Number(plan.expected_regular_income), kind: "planned", source: "Budget plan" };
    else if (recurringIncome > 0) income = { amount: recurringIncome, kind: "planned", source: "Recurring income" };
    else if (avgIncome !== null) income = { amount: avgIncome, kind: "estimated", source: "Average of recent months" };
    if (!income) break; // stop at the last cycle we have a basis for; never invent income

    // Limits per category (plan overrides current limits). A recurring payment larger than
    // its category limit raises that category, so known bills are never under-counted.
    const planLimits = new Map((plan?.categories ?? []).map((c) => [c.category_id, Number(c.planned_limit)]));
    const totals = { fixed: 0, flexible: 0 };
    for (const c of categories) {
      const limit = planLimits.has(c.id) ? planLimits.get(c.id) ?? 0 : Number(c.monthly_limit);
      const recurring = activeRecurring
        .filter((r) => r.type === "expense" && r.category_id === c.id)
        .reduce((s, r) => s + Number(r.amount), 0);
      totals[c.type === "fixed" ? "fixed" : "flexible"] += Math.max(limit, recurring);
    }
    const knownIds = new Set(categories.map((c) => c.id));
    totals.fixed += activeRecurring
      .filter((r) => r.type === "expense" && (!r.category_id || !knownIds.has(r.category_id)))
      .reduce((s, r) => s + Number(r.amount), 0);

    const src = plan ? "Budget plan" : "Category limits & recurring";
    /** @type {Line} */
    const fixed = totals.fixed > 0 || avgFixed === null
      ? { amount: totals.fixed, kind: "planned", source: src }
      : { amount: avgFixed, kind: "estimated", source: "Average of recent months" };
    /** @type {Line} */
    const flexible = totals.flexible > 0 || avgFlexible === null
      ? { amount: totals.flexible, kind: "planned", source: src }
      : { amount: avgFlexible, kind: "estimated", source: "Average of recent months" };
    /** @type {Line} */
    const savings = plan
      ? { amount: Number(plan.planned_savings), kind: "planned", source: "Budget plan" }
      : avgSavings !== null
        ? { amount: avgSavings, kind: "estimated", source: "Average of recent months" }
        : { amount: 0, kind: "planned", source: "No savings planned" };

    const unconfirmedVariable =
      incomeSources
        .filter((s) => s.type === "variable" && s.status === "expected" && s.expected_date && s.expected_date >= startStr && s.expected_date <= endStr)
        .reduce((s, x) => s + Number(x.amount), 0) + (plan ? Number(plan.expected_variable_income) : 0);

    const surplus = income.amount - fixed.amount - flexible.amount - savings.amount;
    results.push({
      cycleStart: startStr,
      cycleEnd: endStr,
      label: periodLabel,
      income,
      fixed,
      flexible,
      savings,
      surplus: {
        amount: surplus,
        kind: /** @type {LineKind} */ ([income, fixed, flexible, savings].some((l) => l.kind === "estimated") ? "estimated" : "planned"),
        source: "Income − expenses − savings",
      },
      unconfirmedVariable,
    });
  }
  return results.length ? results : null;
}
