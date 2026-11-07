/**
 * Budget period, burn rate, and savings goal utilities for the client.
 * All monetary values are in paise (integer minor units).
 */

export interface PeriodRange {
  startDate: Date;
  endDate: Date;
  totalDays: number;
  daysElapsed: number;
  daysRemaining: number;
  periodLabel: string; // e.g. "3 Nov – 2 Dec 2026"
  startStr: string; // inclusive local YYYY-MM-DD, for comparing against `date` columns
  endStr: string; // inclusive local YYYY-MM-DD
}

// Implemented in periods.mjs so it can be unit-tested under several timezones.
export { getPeriodRange, toLocalDateString, toLocalMonthKey } from "./periods.mjs";

/**
 * Format paise as INR string.
 */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 100000) {
    return `₹${(rupees / 100000).toFixed(1)}L`;
  }
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

/**
 * Format paise as decimal INR string (for detailed views).
 */
export function formatINRDecimal(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export interface CategoryBudgetStatus {
  id: string;
  name: string;
  type: "fixed" | "flexible";
  monthlyLimit: number; // paise
  spent: number; // paise
  remaining: number; // paise
  percentUsed: number; // 0-100+
  hasLimit: boolean; // false when monthlyLimit is 0 ("no limit set"): never over budget
  status: "safe" | "warning" | "danger" | "exceeded";
}

// Implemented in categoryBudgets.mjs so it can be unit-tested.
export { computeCategoryBudgets } from "./categoryBudgets.mjs";

export interface BurnRateMetrics {
  totalBudget: number; // paise – total flexible budget for the period
  totalSpent: number; // paise – total flexible spent so far
  expectedSpentByNow: number; // paise – linear projection of where you should be
  actualDailyRate: number; // paise/day – actual burn rate
  expectedDailyRate: number; // paise/day – ideal daily burn for even pacing
  burnRatio: number; // actual / expected (< 1 = under-spending, > 1 = over-spending)
  projectedEndOfMonth: number; // paise – projected total spending if same rate continues
  isOnTrack: boolean;
}

/**
 * Compute daily burn rate and linear projections.
 */
export function computeBurnRate(
  flexibleBudget: number,
  flexibleSpent: number,
  period: PeriodRange
): BurnRateMetrics {
  const expectedDailyRate = flexibleBudget > 0 ? Math.round(flexibleBudget / period.totalDays) : 0;
  const actualDailyRate = period.daysElapsed > 0 ? Math.round(flexibleSpent / period.daysElapsed) : 0;
  const expectedSpentByNow = expectedDailyRate * period.daysElapsed;
  const burnRatio = expectedSpentByNow > 0 ? flexibleSpent / expectedSpentByNow : 0;
  const projectedEndOfMonth = actualDailyRate * period.totalDays;

  return {
    totalBudget: flexibleBudget,
    totalSpent: flexibleSpent,
    expectedSpentByNow,
    actualDailyRate,
    expectedDailyRate,
    burnRatio,
    projectedEndOfMonth,
    isOnTrack: burnRatio <= 1.1,
  };
}

// Implemented in a plain JS module so date-only behavior can be tested across timezones.
export { calculateNeededPerMonth } from "./goalMetrics.mjs";
