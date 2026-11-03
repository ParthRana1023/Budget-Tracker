/**
 * Phase 4 Alert Utilities:
 * - 80% warning threshold on category limits
 * - 100% exceeded threshold on category limits
 * - Savings target threat detection
 */

import { formatINR } from "./budgetUtils";

export type AlertSeverity = "warning" | "danger" | "critical";

export interface BudgetAlert {
  id: string;
  type: "category_80" | "category_100" | "savings_threat";
  severity: AlertSeverity;
  title: string;
  message: string;
  categoryId?: string;
  categoryName?: string;
  percentUsed?: number;
  overAmount?: number;
}

export interface SavingsThreatInput {
  confirmedIncome: number; // in paise
  targetSavings: number; // in paise
  budgetedFixedBills: number; // in paise
  paidFixedBills: number; // in paise
  flexibleSpent: number; // in paise
  projectedFlexibleTotal?: number; // in paise
}

/**
 * Checks all categories and returns active 80% and 100% alerts.
 */
export function getCategoryLimitAlerts(
  categories: Array<{ id: string; name: string; type: string; monthly_limit: number }>,
  transactions: Array<{ category_id: string | null; amount: number; type: string }>
): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];

  categories.forEach((cat) => {
    const limit = Number(cat.monthly_limit);
    if (limit <= 0) return; // Skip categories without limits

    const spent = transactions
      .filter((t) => t.type === "expense" && t.category_id === cat.id)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const percentUsed = (spent / limit) * 100;

    if (percentUsed >= 100) {
      const overAmount = spent - limit;
      alerts.push({
        id: `cat-100-${cat.id}`,
        type: "category_100",
        severity: "danger",
        title: `${cat.name} Limit Exceeded`,
        message: `${cat.name} has exceeded its monthly limit by ${formatINR(overAmount)} (${Math.round(percentUsed)}% used).`,
        categoryId: cat.id,
        categoryName: cat.name,
        percentUsed,
        overAmount,
      });
    } else if (percentUsed >= 80) {
      const remaining = limit - spent;
      alerts.push({
        id: `cat-80-${cat.id}`,
        type: "category_80",
        severity: "warning",
        title: `${cat.name} Approaching Limit`,
        message: `${cat.name} has reached ${Math.round(percentUsed)}% of its limit. Only ${formatINR(remaining)} remaining.`,
        categoryId: cat.id,
        categoryName: cat.name,
        percentUsed,
      });
    }
  });

  return alerts;
}

/**
 * Checks if total spending threatens the savings target.
 * Triggers when:
 * 1. Safe-to-Spend is already negative (actual deficit eating into savings).
 * 2. Projected spending pacing will wipe out remaining spendable pool and dip into savings target.
 */
export function getSavingsTargetAlert(input: SavingsThreatInput): BudgetAlert | null {
  const {
    confirmedIncome,
    targetSavings,
    budgetedFixedBills,
    paidFixedBills,
    flexibleSpent,
    projectedFlexibleTotal = 0,
  } = input;

  if (targetSavings <= 0) return null;

  const unpaidFixed = Math.max(0, budgetedFixedBills - paidFixedBills);
  const safeToSpend = confirmedIncome - targetSavings - unpaidFixed - flexibleSpent;

  // Actual deficit currently dipping into savings
  if (safeToSpend < 0) {
    const deficit = Math.abs(safeToSpend);
    return {
      id: "savings-threat-active",
      type: "savings_threat",
      severity: "critical",
      title: "🚨 Savings Target Compromised",
      message: `Your current spending has exceeded safe limits by ${formatINR(deficit)}, actively dipping into your ${formatINR(targetSavings)} savings target!`,
      overAmount: deficit,
    };
  }

  // Projected pacing threat: if projected flexible spend will wipe out safe-to-spend
  const projectedDeficit = projectedFlexibleTotal - (confirmedIncome - targetSavings - unpaidFixed);
  if (projectedDeficit > 0) {
    return {
      id: "savings-threat-projected",
      type: "savings_threat",
      severity: "warning",
      title: "⚠️ Savings Target At Risk",
      message: `At your current daily burn rate, projected spending will eat ${formatINR(projectedDeficit)} into your ${formatINR(targetSavings)} savings goal by month-end.`,
      overAmount: projectedDeficit,
    };
  }

  return null;
}

/**
 * Computes the immediate impact of adding a new expense.
 * Used inside FastExpenseModal to warn the user before or immediately after saving.
 */
export function checkExpenseImpact(
  amountPaise: number,
  category: { id: string; name: string; monthly_limit: number } | undefined,
  currentCategorySpent: number,
  currentSafeToSpend: number
): {
  triggers80: boolean;
  triggers100: boolean;
  threatensSavings: boolean;
  percentAfter: number;
  message?: string;
} {
  const limit = category ? Number(category.monthly_limit) : 0;
  const spentAfter = currentCategorySpent + amountPaise;
  const safeAfter = currentSafeToSpend - amountPaise;

  const percentBefore = limit > 0 ? (currentCategorySpent / limit) * 100 : 0;
  const percentAfter = limit > 0 ? (spentAfter / limit) * 100 : 0;

  const triggers100 = limit > 0 && percentAfter >= 100;
  const triggers80 = limit > 0 && percentAfter >= 80 && percentBefore < 80;
  const threatensSavings = safeAfter < 0;

  let message = "";
  if (triggers100) {
    const overAmount = spentAfter - limit;
    message = `⚠️ This expense will exceed ${category?.name}'s monthly limit by ${formatINR(overAmount)}!`;
  } else if (triggers80) {
    message = `ℹ️ This expense brings ${category?.name} to ${Math.round(percentAfter)}% of its limit.`;
  } else if (threatensSavings) {
    message = `🚨 Warning: This expense exceeds your safe-to-spend balance and dips into your savings target!`;
  }

  return {
    triggers80,
    triggers100,
    threatensSavings,
    percentAfter,
    message: message || undefined,
  };
}

