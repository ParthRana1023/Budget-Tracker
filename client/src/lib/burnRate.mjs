// Flexible-budget burn rate and linear projection. Amounts in paise.

/**
 * @param {number} flexibleBudget total flexible budget for the period
 * @param {number} flexibleSpent flexible spent so far
 * @param {{ totalDays: number, daysElapsed: number }} period
 * @returns {{
 *   totalBudget: number, totalSpent: number, expectedSpentByNow: number,
 *   actualDailyRate: number, expectedDailyRate: number, burnRatio: number,
 *   projectedEndOfMonth: number, isOnTrack: boolean
 * }}
 */
export function computeBurnRate(flexibleBudget, flexibleSpent, period) {
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
