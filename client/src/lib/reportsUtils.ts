/**
 * Phase 6 Reports & Analytics Utilities:
 * - Monthly category breakdown
 * - Month-over-month trend analysis
 * - Income vs Expenses vs Savings and Savings Rate
 * - Yearly view with variable pay isolated as its own line
 */

import { formatINR } from "./budgetUtils";
import { toLocalMonthKey } from "./periods.mjs";

export interface CategorySpendShare {
  categoryId: string;
  categoryName: string;
  categoryType: "fixed" | "flexible";
  amount: number; // in paise
  percentOfTotal: number; // 0-100
  monthlyLimit: number; // in paise
}

export interface MonthSummary {
  monthKey: string; // YYYY-MM
  monthLabel: string; // e.g. "Oct 2026"
  regularIncome: number; // in paise
  variableIncome: number; // in paise (tracked separately)
  totalIncome: number; // in paise
  fixedExpenses: number; // in paise
  flexibleExpenses: number; // in paise
  totalExpenses: number; // in paise
  savingsContributions: number; // in paise
  netCashFlow: number; // in paise
  baselineSavingsRate: number; // (savings / regularIncome) * 100
  totalSavingsRate: number; // (savings / totalIncome) * 100
}

export interface YearlySummary {
  year: number;
  totalRegularIncome: number; // in paise
  totalVariableIncome: number; // in paise (separate line item)
  combinedIncome: number; // in paise
  totalFixedExpenses: number; // in paise
  totalFlexibleExpenses: number; // in paise
  totalExpenses: number; // in paise
  totalSavings: number; // in paise
  netSurplus: number; // in paise
  baselineSavingsRate: number; // (totalSavings / totalRegularIncome) * 100
  monthlyAverages: {
    income: number;
    expenses: number;
    savings: number;
  };
}

/**
 * Computes category breakdown for a specific month (or all time if monthKey omitted).
 */
export function computeMonthlyCategoryBreakdown(
  transactions: Array<{ category_id: string | null; amount: number; type: string; date: string }>,
  categories: Array<{ id: string; name: string; type: string; monthly_limit: number }>,
  monthKey?: string // YYYY-MM
): {
  items: CategorySpendShare[];
  totalSpent: number;
} {
  const filteredTx = transactions.filter((t) => {
    if (t.type !== "expense") return false;
    if (monthKey && !t.date.startsWith(monthKey)) return false;
    return true;
  });

  const totalSpent = filteredTx.reduce((sum, t) => sum + Number(t.amount), 0);

  const items: CategorySpendShare[] = categories
    .map((cat) => {
      const amount = filteredTx
        .filter((t) => t.category_id === cat.id)
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const percentOfTotal = totalSpent > 0 ? (amount / totalSpent) * 100 : 0;

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryType: cat.type as "fixed" | "flexible",
        amount,
        percentOfTotal,
        monthlyLimit: Number(cat.monthly_limit),
      };
    })
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  return { items, totalSpent };
}

/**
 * Computes month-over-month trend for the last N months.
 */
export function computeMonthlyTrends(
  transactions: Array<{ amount: number; type: string; date: string; category?: { type: string } | null }>,
  incomeSources: Array<{ amount: number; type: string; status: string; received_date?: string | null; created_at?: string }>,
  contributions: Array<{ amount: number; date: string }>,
  numMonths: number = 6,
  referenceDate: Date = new Date()
): MonthSummary[] {
  const months: MonthSummary[] = [];

  for (let i = numMonths - 1; i >= 0; i--) {
    const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
    const monthKey = toLocalMonthKey(d); // YYYY-MM (local; toISOString would shift it a month in UTC+ zones)
    const monthLabel = d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });

    // 1. Income in this month
    const monthIncomeSources = incomeSources.filter((inc) => {
      if (inc.status !== "received") return false;
      const incDate = inc.received_date || inc.created_at || "";
      return incDate.startsWith(monthKey);
    });

    const regularIncome = monthIncomeSources
      .filter((inc) => inc.type !== "variable")
      .reduce((sum, inc) => sum + Number(inc.amount), 0);

    const variableIncome = monthIncomeSources
      .filter((inc) => inc.type === "variable")
      .reduce((sum, inc) => sum + Number(inc.amount), 0);

    const totalIncome = regularIncome + variableIncome;

    // 2. Expenses in this month
    const monthExpenses = transactions.filter(
      (t) => t.type === "expense" && t.date.startsWith(monthKey)
    );

    const fixedExpenses = monthExpenses
      .filter((t) => t.category?.type === "fixed")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const flexibleExpenses = monthExpenses
      .filter((t) => t.category?.type !== "fixed")
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const totalExpenses = fixedExpenses + flexibleExpenses;

    // 3. Savings contributions in this month
    const savingsContributions = contributions
      .filter((c) => c.date.startsWith(monthKey))
      .reduce((sum, c) => sum + Number(c.amount), 0);

    const netCashFlow = totalIncome - totalExpenses - savingsContributions;

    // Savings rates (baseline vs total)
    const baselineSavingsRate = regularIncome > 0
      ? Math.min(100, (savingsContributions / regularIncome) * 100)
      : 0;

    const totalSavingsRate = totalIncome > 0
      ? Math.min(100, (savingsContributions / totalIncome) * 100)
      : 0;

    months.push({
      monthKey,
      monthLabel,
      regularIncome,
      variableIncome,
      totalIncome,
      fixedExpenses,
      flexibleExpenses,
      totalExpenses,
      savingsContributions,
      netCashFlow,
      baselineSavingsRate,
      totalSavingsRate,
    });
  }

  return months;
}

/**
 * Computes yearly summary with variable pay cleanly isolated.
 */
export function computeYearlySummary(
  transactions: Array<{ amount: number; type: string; date: string; category?: { type: string } | null }>,
  incomeSources: Array<{ amount: number; type: string; status: string; received_date?: string | null; created_at?: string }>,
  contributions: Array<{ amount: number; date: string }>,
  year: number = new Date().getFullYear()
): YearlySummary {
  const yearPrefix = `${year}-`;

  // 1. Incomes for the year
  const yearIncomes = incomeSources.filter((inc) => {
    if (inc.status !== "received") return false;
    const incDate = inc.received_date || inc.created_at || "";
    return incDate.startsWith(yearPrefix);
  });

  const totalRegularIncome = yearIncomes
    .filter((inc) => inc.type !== "variable")
    .reduce((sum, inc) => sum + Number(inc.amount), 0);

  const totalVariableIncome = yearIncomes
    .filter((inc) => inc.type === "variable")
    .reduce((sum, inc) => sum + Number(inc.amount), 0);

  const combinedIncome = totalRegularIncome + totalVariableIncome;

  // 2. Expenses for the year
  const yearExpenses = transactions.filter(
    (t) => t.type === "expense" && t.date.startsWith(yearPrefix)
  );

  const totalFixedExpenses = yearExpenses
    .filter((t) => t.category?.type === "fixed")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalFlexibleExpenses = yearExpenses
    .filter((t) => t.category?.type !== "fixed")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalExpenses = totalFixedExpenses + totalFlexibleExpenses;

  // 3. Savings for the year
  const totalSavings = contributions
    .filter((c) => c.date.startsWith(yearPrefix))
    .reduce((sum, c) => sum + Number(c.amount), 0);

  const netSurplus = combinedIncome - totalExpenses - totalSavings;

  // Baseline savings rate (without variable pay distorting regular take-home rate)
  const baselineSavingsRate = totalRegularIncome > 0
    ? Math.min(100, (totalSavings / totalRegularIncome) * 100)
    : 0;

  return {
    year,
    totalRegularIncome,
    totalVariableIncome,
    combinedIncome,
    totalFixedExpenses,
    totalFlexibleExpenses,
    totalExpenses,
    totalSavings,
    netSurplus,
    baselineSavingsRate,
    monthlyAverages: {
      income: Math.round(combinedIncome / 12),
      expenses: Math.round(totalExpenses / 12),
      savings: Math.round(totalSavings / 12),
    },
  };
}

