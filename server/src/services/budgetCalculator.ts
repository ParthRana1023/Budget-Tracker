export interface BudgetSummaryInput {
  confirmedIncome: number; // in paise
  unreceivedVariableIncome: number; // in paise (tracked separately, excluded from safe-to-spend)
  targetSavings: number; // in paise
  budgetedFixedBills: number; // in paise (sum of monthly limits for fixed categories)
  paidFixedBills: number; // in paise (actual spending in fixed categories so far this cycle)
  flexibleSpent: number; // in paise (actual spending in flexible categories so far this cycle)
  daysRemainingInPeriod: number;
}

export interface BudgetSummaryResult {
  confirmedIncome: number;
  unreceivedVariableIncome: number;
  targetSavings: number;
  remainingUnpaidFixedBills: number;
  flexibleSpent: number;
  safeToSpend: number;
  dailyAllowance: number;
  isOverspent: boolean;
}

/**
 * Calculates the Safe-to-Spend amount based on savings-first budgeting:
 * Safe-to-Spend = Confirmed Income − Target Savings − Remaining Unpaid Fixed Bills − Flexible Spent So Far
 */
export function calculateSafeToSpend(input: BudgetSummaryInput): BudgetSummaryResult {
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

  // Safe to spend = Confirmed Income - Target Savings - Remaining Unpaid Fixed - Flexible Spent
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

/**
 * Calculates period start and end dates based on user's month_start_day setting
 */
export function getPeriodRange(referenceDate: Date, monthStartDay: number = 1): { startDate: Date; endDate: Date; daysRemaining: number } {
  const clampedStart = Math.min(Math.max(1, Math.trunc(monthStartDay) || 1), 28);
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

  const utcDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const totalDays = Math.round((utcDay(endDate) - utcDay(startDate)) / 86400000) + 1;
  const daysElapsed = Math.round((utcDay(referenceDate) - utcDay(startDate)) / 86400000) + 1;
  const daysRemaining = Math.max(1, totalDays - daysElapsed + 1);

  return { startDate, endDate, daysRemaining };
}
