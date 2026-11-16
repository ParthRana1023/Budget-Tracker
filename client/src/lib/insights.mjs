// Deterministic financial insights. Every insight comes from a calculation on the
// user's own data, says why it is shown, and is skipped when there is not enough data.
// No generated advice. Amounts in paise.

import { formatINR } from "./money.mjs";
import { pctChange } from "./performance.mjs";

/**
 * @typedef {"critical" | "warning" | "info" | "positive"} InsightSeverity
 * @typedef {{ id: string, severity: InsightSeverity, message: string, why: string, action: string | null }} Insight
 */

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, positive: 3 };
const MIN_DAYS_FOR_PACE = 3; // pace over 1-2 days is noise
const CHANGE_THRESHOLD_PCT = 10;
const SAVINGS_GUIDELINE_PCT = 20; // the common 50/30/20 guideline, stated in the insight
const pct = (/** @type {number} */ n) => `${Math.round(n)}%`;
const days = (/** @type {number} */ n) => `${n} day${n === 1 ? "" : "s"}`;
// A "keep under X a day" cap rounds DOWN to whole rupees; rounding up would overspend the limit.
const dailyCap = (/** @type {number} */ left, /** @type {number} */ d) => formatINR(Math.floor(Math.max(0, left) / Math.max(1, d) / 100) * 100);

/**
 * @param {{
 *   categoryBudgets: Array<{ id: string, name: string, type: string, monthlyLimit: number, spent: number, remaining: number, percentUsed: number, hasLimit: boolean, status: string }>,
 *   period: { daysElapsed: number, totalDays: number, daysRemaining: number },
 *   pace: { status: string, flexibleSpent: number, flexibleBudget: number, projectedEnd: number, projectedOverspend: number, burnRate: { actualDailyRate: number, expectedDailyRate: number } },
 *   completedMonths: Array<{ monthLabel: string, regularIncome: number, flexibleExpenses: number, savingsContributions: number, baselineSavingsRate: number }>
 * }} input completedMonths: chronological, excluding the current partial month
 * @returns {Insight[]}
 */
export function generateInsights({ categoryBudgets, period, pace, completedMonths }) {
  /** @type {Insight[]} */
  const out = [];
  const elapsedPct = (period.daysElapsed / period.totalDays) * 100;

  // 1-2. Category limits: over budget, or close to the limit faster than the cycle is passing.
  for (const c of categoryBudgets) {
    if (!c.hasLimit) continue;
    if (c.status === "exceeded") {
      out.push({
        id: `cat-over-${c.id}`,
        severity: "critical",
        message: `${c.name} is ${formatINR(c.spent - c.monthlyLimit)} over its budget.`,
        why: `${formatINR(c.spent)} spent against a limit of ${formatINR(c.monthlyLimit)} this cycle.`,
        action: `Cover the gap from another flexible category, or raise the ${c.name} limit in the Budget Planner if it was set too low.`,
      });
    } else if (c.percentUsed >= 75 && c.percentUsed > elapsedPct && period.daysRemaining > 1) {
      out.push({
        id: `cat-near-${c.id}`,
        severity: "warning",
        message: `You have used ${pct(c.percentUsed)} of your ${c.name} budget with ${days(period.daysRemaining)} remaining.`,
        why: `${formatINR(c.spent)} of ${formatINR(c.monthlyLimit)} spent, while only ${pct(elapsedPct)} of the cycle has passed.`,
        action: `Keep ${c.name} under ${dailyCap(c.remaining, period.daysRemaining)} a day to stay within the limit.`,
      });
    }
  }

  // 3. Overall flexible pace.
  if (pace.status === "exceeded") {
    out.push({
      id: "pace-exceeded",
      severity: "critical",
      message: `Flexible spending is ${formatINR(pace.flexibleSpent - pace.flexibleBudget)} over this cycle's budget.`,
      why: `${formatINR(pace.flexibleSpent)} spent against flexible limits totalling ${formatINR(pace.flexibleBudget)}.`,
      action: "Pause non-essential spending for the rest of the cycle; any further spending comes out of savings.",
    });
  } else if (pace.status === "at_risk" && period.daysElapsed >= MIN_DAYS_FOR_PACE) {
    out.push({
      id: "pace-overspend",
      severity: "warning",
      message: `Your current spending pace projects an overspend of ${formatINR(pace.projectedOverspend)}.`,
      why: `You are spending ${formatINR(pace.burnRate.actualDailyRate)} a day against a planned ${formatINR(pace.burnRate.expectedDailyRate)}; at this rate flexible spending reaches ${formatINR(pace.projectedEnd)} against a ${formatINR(pace.flexibleBudget)} budget.`,
      action: `Keep flexible spending under ${dailyCap(pace.flexibleBudget - pace.flexibleSpent, period.daysRemaining)} a day for the rest of the cycle.`,
    });
  }

  // 4. Flexible spending month over month (completed months only).
  const [prev, last] = completedMonths.slice(-2);
  if (prev && last) {
    const change = pctChange(last.flexibleExpenses, prev.flexibleExpenses);
    if (change !== null && Math.abs(change) >= CHANGE_THRESHOLD_PCT) {
      const up = change > 0;
      out.push({
        id: "flex-change",
        severity: up ? "warning" : "positive",
        message: `Your flexible spending ${up ? "increased" : "decreased"} by ${pct(Math.abs(change))} in ${last.monthLabel} compared with ${prev.monthLabel}.`,
        why: `Flexible spending went from ${formatINR(prev.flexibleExpenses)} to ${formatINR(last.flexibleExpenses)}.`,
        action: up ? "Check Expense distribution in Reports to see which categories grew." : null,
      });
    }
  }

  // 5. Savings-rate trend over the last three completed months (baseline: regular income).
  const last3 = completedMonths.slice(-3);
  if (last3.length === 3 && last3.every((m) => m.regularIncome > 0)) {
    const r = last3.map((m) => m.baselineSavingsRate);
    const trail = r.map(pct).join(" → ");
    if (r[0] < r[1] && r[1] < r[2] && r[2] - r[0] >= 1) {
      out.push({
        id: "rate-up",
        severity: "positive",
        message: "Your savings rate improved over the last three months.",
        why: `Savings as a share of regular income: ${trail}.`,
        action: null,
      });
    } else if (r[0] > r[1] && r[1] > r[2] && r[0] - r[2] >= 1) {
      out.push({
        id: "rate-down",
        severity: "warning",
        message: "Your savings rate has fallen for three months in a row.",
        why: `Savings as a share of regular income: ${trail}.`,
        action: "Set a planned savings amount for next cycle in the Budget Planner, and save it at the start of the cycle.",
      });
    }
  }

  // 6. Savings below the 20% guideline while flexible spending exists.
  const salaried = completedMonths.filter((m) => m.regularIncome > 0);
  if (salaried.length >= 2) {
    const avgRate = salaried.reduce((s, m) => s + m.baselineSavingsRate, 0) / salaried.length;
    const avgFlex = Math.round(salaried.reduce((s, m) => s + m.flexibleExpenses, 0) / salaried.length);
    if (avgRate < SAVINGS_GUIDELINE_PCT && avgFlex > 0) {
      out.push({
        id: "trim-flexible",
        severity: "info",
        message: `Reducing flexible spending by 10% could add about ${formatINR(Math.round(avgFlex / 10))} a month to your savings.`,
        why: `Over the last ${salaried.length} months you saved ${pct(avgRate)} of regular income on average (a common guideline is ${SAVINGS_GUIDELINE_PCT}%), while flexible spending averaged ${formatINR(avgFlex)} a month.`,
        action: "Try lowering one or two flexible limits in the What-if Simulator to see the effect before changing anything.",
      });
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
