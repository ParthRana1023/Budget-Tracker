// Savings goal progress analytics. Amounts in paise; dates are local YYYY-MM-DD.
// Read-only: simulation never touches stored contributions.

import { calculateNeededPerMonth } from "./goalMetrics.mjs";
import { parseLocalDate, toLocalDateString, toLocalMonthKey } from "./periods.mjs";

const DAYS_PER_MONTH = 365.25 / 12;
const PACE_WINDOW_DAYS = 90;

/**
 * When a goal completes at a given monthly contribution.
 * @param {number} remaining paise still needed
 * @param {number} monthlyContribution paise per month
 * @param {Date} [referenceDate]
 * @returns {{ monthsToGo: number, completionMonthKey: string, completionLabel: string } | null} null if it never completes
 */
export function simulateGoalCompletion(remaining, monthlyContribution, referenceDate = new Date()) {
  if (remaining <= 0) {
    return { monthsToGo: 0, completionMonthKey: toLocalMonthKey(referenceDate), completionLabel: "Completed" };
  }
  if (!(monthlyContribution > 0)) return null;
  const monthsToGo = Math.ceil(remaining / monthlyContribution);
  const done = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthsToGo, 1);
  return {
    monthsToGo,
    completionMonthKey: toLocalMonthKey(done),
    completionLabel: done.toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
  };
}

/**
 * @param {{
 *   targetAmount: number, targetDate: string | null,
 *   contributions: Array<{ amount: number, date?: string | null }>,
 *   startingAmount?: number,
 *   referenceDate?: Date
 * }} input contributions must already be filtered to this goal; startingAmount = saved before tracking (not part of the pace)
 */
export function analyzeGoal({
  targetAmount,
  targetDate,
  contributions,
  startingAmount = 0,
  referenceDate = new Date(),
}) {
  const today = toLocalDateString(referenceDate);
  const current = Number(startingAmount) + contributions.reduce((s, c) => s + Number(c.amount), 0);
  const remaining = Math.max(0, targetAmount - current);
  const percent = targetAmount > 0 ? Math.min(100, (current / targetAmount) * 100) : 0;
  const needed = calculateNeededPerMonth(targetAmount, current, targetDate, referenceDate);

  // Current pace: contributions over the last 90 days (or since the first contribution
  // if more recent, but at least a month), scaled to a month.
  const dated = contributions.filter((c) => c.date && c.date <= today);
  const firstDate = dated.reduce((/** @type {string | null} */ min, c) => (!min || c.date < min ? c.date : min), null);
  let monthlyPace = 0;
  if (firstDate) {
    const utcDay = (/** @type {Date} */ d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const daysSinceFirst = Math.round((utcDay(referenceDate) - utcDay(parseLocalDate(firstDate))) / 86400000) + 1;
    const windowDays = Math.max(30, Math.min(PACE_WINDOW_DAYS, daysSinceFirst));
    const windowStart = toLocalDateString(
      new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate() - windowDays + 1),
    );
    const inWindow = dated.filter((c) => c.date >= windowStart).reduce((s, c) => s + Number(c.amount), 0);
    monthlyPace = Math.round((inWindow / windowDays) * DAYS_PER_MONTH);
  }

  /** @type {"completed" | "on_track" | "behind"} */
  let status;
  if (needed.isCompleted) status = "completed";
  else if (needed.isPastDeadline) status = "behind";
  else status = monthlyPace >= needed.neededPerMonth ? "on_track" : "behind";

  return {
    targetAmount,
    current,
    remaining,
    percent,
    targetDate,
    hasTargetDate: !!targetDate,
    requiredMonthly: needed.neededPerMonth,
    monthsRemaining: needed.monthsRemaining,
    isPastDeadline: needed.isPastDeadline,
    monthlyPace,
    estimatedCompletion: simulateGoalCompletion(remaining, monthlyPace, referenceDate),
    status,
  };
}

/**
 * The dashboard's on-track bar for an unfinished goal with a future target date
 * (design handoff): solid = saved, striped = where the current monthly pace gets to
 * by the target month, plus a tag. Null when there is no bar to show.
 * @param {ReturnType<typeof analyzeGoal>} goal
 * @returns {{ projected: number, tag: "on_track" | "nothing_yet" | "late", monthsLate: number } | null}
 */
export function goalTrack(goal) {
  if (goal.status === "completed" || !goal.hasTargetDate || goal.isPastDeadline || !(goal.targetAmount > 0))
    return null;
  const months = goal.monthsRemaining,
    pace = goal.monthlyPace;
  const projected = Math.min(goal.targetAmount, goal.current + pace * months);
  if (pace >= goal.requiredMonthly) return { projected, tag: "on_track", monthsLate: 0 };
  if (!(pace > 0)) return { projected, tag: "nothing_yet", monthsLate: 0 };
  return { projected, tag: "late", monthsLate: Math.max(1, Math.ceil(goal.remaining / pace) - months) };
}
