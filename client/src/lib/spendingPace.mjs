// Cumulative flexible-spending pace for the active budget cycle. Amounts in paise.
// Builds on computeBurnRate so the chart and the existing Pacing card always agree.

import { computeBurnRate } from "./burnRate.mjs";
import { toLocalDateString } from "./periods.mjs";

/**
 * @typedef {"on_track" | "faster" | "at_risk" | "exceeded" | "no_budget"} PaceStatus
 * on_track:  spending at or under the planned pace
 * faster:    up to 10% ahead of the planned pace (the Pacing card's tolerance still calls this on track)
 * at_risk:   more than 10% ahead of pace, so the projection overshoots the budget by over 10%
 * exceeded:  already spent more than the budget
 * With a linear projection "ahead of pace" and "projected over budget" are the same thing,
 * so the burn ratio alone separates faster from at_risk.
 * no_budget: no flexible limits are set, so there is no plan to compare against
 */

/**
 * @param {{
 *   flexibleBudget: number,
 *   cycleTransactions: Array<{ type: string, amount: number, date: string, category?: { type: string } | null }>,
 *   period: { startDate: Date, totalDays: number, daysElapsed: number }
 * }} input
 */
export function computeSpendingPace({ flexibleBudget, cycleTransactions, period }) {
  /** @type {Map<string, number>} */
  const spentByDay = new Map();
  let flexibleSpent = 0;
  for (const t of cycleTransactions) {
    if (t.type !== "expense" || t.category?.type !== "flexible") continue;
    const amount = Number(t.amount);
    spentByDay.set(t.date, (spentByDay.get(t.date) ?? 0) + amount);
    flexibleSpent += amount;
  }

  const burnRate = computeBurnRate(flexibleBudget, flexibleSpent, period);
  const { totalDays, daysElapsed } = period;
  const projectedEnd = burnRate.projectedEndOfMonth;

  const points = [];
  let cumulative = 0;
  for (let day = 1; day <= totalDays; day++) {
    const date = toLocalDateString(
      new Date(period.startDate.getFullYear(), period.startDate.getMonth(), period.startDate.getDate() + day - 1)
    );
    if (day <= daysElapsed) cumulative += spentByDay.get(date) ?? 0;

    // Projection runs from today's actual to the burn-rate projection at cycle end.
    let projected = null;
    if (day >= daysElapsed && daysElapsed > 0) {
      const span = totalDays - daysElapsed;
      projected = span > 0
        ? Math.round(cumulative + ((projectedEnd - cumulative) * (day - daysElapsed)) / span)
        : cumulative;
    }

    points.push({
      day,
      date,
      actual: day <= daysElapsed ? cumulative : null,
      expected: burnRate.expectedDailyRate * day,
      projected,
      budget: flexibleBudget,
    });
  }

  /** @type {PaceStatus} */
  let status = "on_track";
  if (flexibleBudget <= 0) status = "no_budget";
  else if (flexibleSpent > flexibleBudget) status = "exceeded";
  else if (!burnRate.isOnTrack) status = "at_risk";
  else if (burnRate.burnRatio > 1) status = "faster";

  return {
    points,
    status,
    flexibleSpent,
    flexibleBudget,
    projectedEnd,
    projectedOverspend: Math.max(0, projectedEnd - flexibleBudget),
    burnRate,
  };
}
