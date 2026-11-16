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

// Implemented in money.mjs so plain-JS modules and tests can format INR too.
export { formatINR, formatINRDecimal } from "./money.mjs";

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

// Implemented in burnRate.mjs so the spending-pace chart logic can build on it under unit tests.
export { computeBurnRate } from "./burnRate.mjs";

// Implemented in a plain JS module so date-only behavior can be tested across timezones.
export { calculateNeededPerMonth } from "./goalMetrics.mjs";
