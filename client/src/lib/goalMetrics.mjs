/**
 * Calculate the monthly contribution needed to reach a savings goal.
 * targetDateStr is a calendar date (YYYY-MM-DD), not a UTC timestamp.
 */
export function calculateNeededPerMonth(
  targetAmount,
  currentAmount,
  targetDateStr,
  referenceDate = new Date()
) {
  const remaining = Math.max(0, targetAmount - currentAmount);
  if (remaining <= 0) {
    return { neededPerMonth: 0, monthsRemaining: 0, isPastDeadline: false, isCompleted: true };
  }

  if (!targetDateStr) {
    return { neededPerMonth: Math.round(remaining / 12), monthsRemaining: 12, isPastDeadline: false, isCompleted: false };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDateStr);
  if (!match) {
    throw new Error("Target date must be a valid YYYY-MM-DD date.");
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const targetDate = new Date(year, month - 1, day);
  if (
    targetDate.getFullYear() !== year ||
    targetDate.getMonth() !== month - 1 ||
    targetDate.getDate() !== day
  ) {
    throw new Error("Target date must be a valid YYYY-MM-DD date.");
  }

  const now = referenceDate;
  const deadlineIsPast =
    targetDate.getFullYear() < now.getFullYear() ||
    (targetDate.getFullYear() === now.getFullYear() && targetDate.getMonth() < now.getMonth()) ||
    (targetDate.getFullYear() === now.getFullYear() &&
      targetDate.getMonth() === now.getMonth() &&
      targetDate.getDate() < now.getDate());

  if (deadlineIsPast) {
    return { neededPerMonth: remaining, monthsRemaining: 0, isPastDeadline: true, isCompleted: false };
  }

  const monthDiff =
    (targetDate.getFullYear() - now.getFullYear()) * 12 +
    targetDate.getMonth() - now.getMonth();
  const totalMonths = Math.max(1, monthDiff + (targetDate.getDate() >= now.getDate() ? 1 : 0));

  return {
    neededPerMonth: Math.round(remaining / totalMonths),
    monthsRemaining: totalMonths,
    isPastDeadline: false,
    isCompleted: false,
  };
}
