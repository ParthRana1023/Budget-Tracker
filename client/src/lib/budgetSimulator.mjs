// What-if budget maths for the planner and simulator. Pure: never writes anything.
// Amounts in paise. Expected variable income is never counted here; the planner shows it apart.

import { calculateSafeToSpend } from "./safeToSpend.mjs";

/** Non-negative whole paise; anything invalid counts as 0. */
const paise = (/** @type {unknown} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * @typedef {{ id: string, name: string, type: "fixed" | "flexible", amount: number }} PlanCategory
 * @typedef {{ regularIncome: number, plannedSavings: number, categories: PlanCategory[], totalDays: number }} BudgetScenario
 */

/**
 * @param {BudgetScenario} scenario
 */
export function simulateBudget({ regularIncome, plannedSavings, categories, totalDays }) {
  const income = paise(regularIncome);
  const savings = paise(plannedSavings);
  const fixed = categories.filter((c) => c.type === "fixed").reduce((s, c) => s + paise(c.amount), 0);
  const flexible = categories.filter((c) => c.type === "flexible").reduce((s, c) => s + paise(c.amount), 0);
  const totalSpending = fixed + flexible;
  const days = Math.max(1, Math.trunc(totalDays) || 1);

  // Same Safe-to-Spend formula as the dashboard, evaluated at the first day of the cycle.
  const { dailyAllowance } = calculateSafeToSpend({
    confirmedIncome: income,
    targetSavings: savings,
    budgetedFixedBills: fixed,
    paidFixedBills: 0,
    flexibleSpent: 0,
    daysRemaining: days,
  });

  return {
    regularIncome: income,
    fixed,
    flexible,
    totalSpending,
    plannedSavings: savings,
    remainingAfterSpending: income - totalSpending,
    projectedSurplus: income - totalSpending - savings,
    savingsRate: income > 0 ? (savings / income) * 100 : null,
    dailyAllowance,
    plannedFlexiblePerDay: Math.floor(flexible / days),
  };
}

/**
 * Starting point for planning a cycle. A saved plan wins; otherwise current limits, with
 * income from active recurring salary (else the latest month's regular income) and savings
 * from the recent average. Expected variable income is returned apart and never added in.
 *
 * @param {{
 *   plan: null | { expected_regular_income: number, expected_variable_income: number, planned_savings: number, categories?: Array<{ category_id: string, planned_limit: number }> },
 *   categories: Array<{ id: string, name: string, type: string, monthly_limit: number }>,
 *   recurringItems: Array<{ amount: number, type: string, active?: boolean, income_type?: string }>,
 *   history: Array<{ regularIncome: number, savingsContributions: number }>,
 *   expectedVariableInCycle: number,
 *   totalDays: number
 * }} input history = completed months, oldest first
 * @returns {BudgetScenario & { expectedVariableIncome: number, source: "plan" | "current" }}
 */
export function buildPlanScenario({ plan, categories, recurringItems, history, expectedVariableInCycle, totalDays }) {
  const toCategories = (/** @type {(c: { id: string, monthly_limit: number }) => number} */ amountOf) =>
    categories.map((c) => ({ id: c.id, name: c.name, type: /** @type {"fixed" | "flexible"} */ (c.type === "fixed" ? "fixed" : "flexible"), amount: amountOf(c) }));

  if (plan) {
    const limits = new Map((plan.categories ?? []).map((c) => [c.category_id, Number(c.planned_limit)]));
    return {
      regularIncome: Number(plan.expected_regular_income),
      plannedSavings: Number(plan.planned_savings),
      expectedVariableIncome: Number(plan.expected_variable_income),
      categories: toCategories((c) => limits.get(c.id) ?? Number(c.monthly_limit)),
      totalDays,
      source: "plan",
    };
  }

  const recurringSalary = recurringItems
    .filter((r) => r.type === "income" && r.active !== false && r.income_type !== "variable")
    .reduce((s, r) => s + Number(r.amount), 0);
  const latestIncome = [...history].reverse().find((m) => m.regularIncome > 0)?.regularIncome ?? 0;
  const saved = history.map((m) => m.savingsContributions).filter((v) => v > 0);

  return {
    regularIncome: recurringSalary || latestIncome,
    plannedSavings: saved.length ? Math.round(saved.reduce((s, v) => s + v, 0) / saved.length) : 0,
    expectedVariableIncome: expectedVariableInCycle,
    categories: toCategories((c) => Number(c.monthly_limit)),
    totalDays,
    source: "current",
  };
}

/**
 * Original vs proposed scenario, with per-metric deltas and the categories that changed.
 * @param {BudgetScenario} base
 * @param {BudgetScenario} proposed
 */
export function compareBudgets(base, proposed) {
  const a = simulateBudget(base);
  const b = simulateBudget(proposed);
  /** @type {Record<string, number | null>} */
  const delta = {};
  for (const key of /** @type {(keyof typeof a)[]} */ (Object.keys(a))) {
    const x = a[key];
    const y = b[key];
    delta[key] = x === null || y === null ? null : y - x;
  }

  const before = new Map(base.categories.map((c) => [c.id, paise(c.amount)]));
  const changedCategories = proposed.categories
    .map((c) => ({ id: c.id, name: c.name, type: c.type, from: before.get(c.id) ?? 0, to: paise(c.amount) }))
    .filter((c) => c.from !== c.to)
    .map((c) => ({ ...c, diff: c.to - c.from }));

  return { base: a, proposed: b, delta, changedCategories };
}
