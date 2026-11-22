// Safe-to-Spend calculator behind /api/budget/calculate and /api/budget/period (moved from the
// old Express server). The dashboard itself uses cycleModel.mjs. Amounts are paise.
import { getPeriodRange } from "./periods.mjs";

/**
 * @typedef {object} BudgetSummaryInput
 * @property {number} confirmedIncome
 * @property {number} unreceivedVariableIncome tracked separately, excluded from safe-to-spend
 * @property {number} targetSavings
 * @property {number} budgetedFixedBills sum of monthly limits for fixed categories
 * @property {number} paidFixedBills spending in fixed categories so far this cycle
 * @property {number} flexibleSpent spending in flexible categories so far this cycle
 * @property {number} daysRemainingInPeriod
 */

/**
 * Safe-to-Spend = Confirmed Income − Target Savings − Remaining Unpaid Fixed Bills − Flexible Spent So Far
 * @param {BudgetSummaryInput} input
 */
export function calculateSafeToSpend(input) {
  const {
    confirmedIncome,
    unreceivedVariableIncome,
    targetSavings,
    budgetedFixedBills,
    paidFixedBills,
    flexibleSpent,
    daysRemainingInPeriod,
  } = input;

  // Remaining unpaid fixed bills cannot be negative
  const remainingUnpaidFixedBills = Math.max(0, budgetedFixedBills - paidFixedBills);
  const safeToSpend = confirmedIncome - targetSavings - remainingUnpaidFixedBills - flexibleSpent;
  // Days remaining should be at least 1 for daily allowance calculation
  const safeDays = Math.max(1, daysRemainingInPeriod);
  const dailyAllowance = safeToSpend > 0 ? Math.floor(safeToSpend / safeDays) : 0;

  return {
    confirmedIncome,
    unreceivedVariableIncome,
    targetSavings,
    remainingUnpaidFixedBills,
    flexibleSpent,
    safeToSpend,
    dailyAllowance,
    isOverspent: safeToSpend < 0,
  };
}

const BUDGET_DEFAULTS = {
  confirmedIncome: 0,
  unreceivedVariableIncome: 0,
  targetSavings: 0,
  budgetedFixedBills: 0,
  paidFixedBills: 0,
  flexibleSpent: 0,
  daysRemainingInPeriod: 30,
};

/**
 * Validates a /api/budget/calculate body. Missing fields take the defaults above.
 * @param {Record<string, unknown>} body
 * @returns {{ values: BudgetSummaryInput, error?: undefined } | { error: string }}
 */
export function parseBudgetInput(body) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const [key, fallback] of Object.entries(BUDGET_DEFAULTS)) {
    const raw = body[key] ?? fallback;
    const value = Number(raw);
    const bad =
      !Number.isFinite(value) ||
      (typeof raw === "string" && raw.trim() === "") ||
      (key === "daysRemainingInPeriod" ? !Number.isInteger(value) || value < 1 : value < 0);
    if (bad)
      return {
        error: "Budget values must be finite, non-negative numbers and daysRemainingInPeriod must be at least 1.",
      };
    values[key] = value;
  }
  return { values: /** @type {BudgetSummaryInput} */ (values) };
}

/**
 * Validates /api/budget/period query values and returns the cycle as JSON-ready fields.
 * A YYYY-MM-DD date is read as a local calendar date, not UTC midnight.
 * @param {string | null} monthStartDay
 * @param {string | null} date
 * @param {Date} [now]
 * @returns {{ startDate: string, endDate: string, daysRemaining: number, error?: undefined } | { error: string }}
 */
export function periodFromQuery(monthStartDay, date, now = new Date()) {
  const startDay = monthStartDay === null ? 1 : Number(monthStartDay);
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 28)
    return { error: "monthStartDay must be an integer from 1 to 28." };
  const refDate = date
    ? /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
      : new Date(date)
    : now;
  if (Number.isNaN(refDate.getTime())) return { error: "date must be a valid date." };

  const range = getPeriodRange(refDate, startDay);
  return {
    startDate: range.startDate.toISOString(),
    endDate: range.endDate.toISOString(),
    daysRemaining: range.daysRemaining,
  };
}
