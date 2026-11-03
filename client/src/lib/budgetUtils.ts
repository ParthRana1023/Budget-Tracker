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
}

/**
 * Compute the current billing cycle based on the user's month_start_day.
 * Handles edge cases like months with fewer days (clamps to month end).
 */
export function getPeriodRange(
  referenceDate: Date = new Date(),
  monthStartDay: number = 1
): PeriodRange {
  const clampedStart = Math.min(Math.max(1, monthStartDay), 28);
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();

  let startDate: Date;
  let endDate: Date;

  if (day >= clampedStart) {
    startDate = new Date(year, month, clampedStart);
    endDate = new Date(year, month + 1, clampedStart - 1, 23, 59, 59, 999);
  } else {
    startDate = new Date(year, month - 1, clampedStart);
    endDate = new Date(year, month, clampedStart - 1, 23, 59, 59, 999);
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / msPerDay) + 1);
  const daysElapsed = Math.max(0, Math.floor((referenceDate.getTime() - startDate.getTime()) / msPerDay)) + 1;
  const daysRemaining = Math.max(1, totalDays - daysElapsed + 1);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const periodLabel = `${fmt(startDate)} – ${fmt(endDate)} ${endDate.getFullYear()}`;

  return { startDate, endDate, totalDays, daysElapsed, daysRemaining, periodLabel };
}

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
  status: "safe" | "warning" | "danger" | "exceeded";
}

/**
 * Compute per-category budget status by matching transactions to category limits.
 */
export function computeCategoryBudgets(
  categories: Array<{ id: string; name: string; type: "fixed" | "flexible"; monthly_limit: number }>,
  transactions: Array<{ category_id: string | null; amount: number; type: string }>
): CategoryBudgetStatus[] {
  return categories.map((cat) => {
    const spent = transactions
      .filter((t) => t.type === "expense" && t.category_id === cat.id)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const monthlyLimit = Number(cat.monthly_limit);
    const remaining = monthlyLimit - spent;
    const percentUsed = monthlyLimit > 0 ? (spent / monthlyLimit) * 100 : (spent > 0 ? 100 : 0);

    let status: CategoryBudgetStatus["status"] = "safe";
    if (percentUsed >= 100) status = "exceeded";
    else if (percentUsed >= 90) status = "danger";
    else if (percentUsed >= 75) status = "warning";

    return {
      id: cat.id,
      name: cat.name,
      type: cat.type as "fixed" | "flexible",
      monthlyLimit,
      spent,
      remaining,
      percentUsed,
      status,
    };
  });
}

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

/**
 * Phase 5: Calculates "Needed per month to hit the target date" for a savings goal.
 */
export function calculateNeededPerMonth(
  targetAmount: number,
  currentAmount: number,
  targetDateStr: string | null | undefined,
  referenceDate: Date = new Date()
): {
  neededPerMonth: number;
  monthsRemaining: number;
  isPastDeadline: boolean;
  isCompleted: boolean;
} {
  const remaining = Math.max(0, targetAmount - currentAmount);
  if (remaining <= 0) {
    return { neededPerMonth: 0, monthsRemaining: 0, isPastDeadline: false, isCompleted: true };
  }

  if (!targetDateStr) {
    return { neededPerMonth: Math.round(remaining / 12), monthsRemaining: 12, isPastDeadline: false, isCompleted: false };
  }

  const targetDate = new Date(targetDateStr);
  const now = referenceDate;

  const yearDiff = targetDate.getFullYear() - now.getFullYear();
  const monthDiff = targetDate.getMonth() - now.getMonth();
  const totalMonths = yearDiff * 12 + monthDiff;

  if (totalMonths <= 0) {
    return { neededPerMonth: remaining, monthsRemaining: 0, isPastDeadline: true, isCompleted: false };
  }

  const neededPerMonth = Math.round(remaining / totalMonths);
  return { neededPerMonth, monthsRemaining: totalMonths, isPastDeadline: false, isCompleted: false };
}
