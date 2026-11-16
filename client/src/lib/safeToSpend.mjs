// Savings-first Safe-to-Spend: the single client implementation.
// Mirrors server/src/services/budgetCalculator.ts (calculateSafeToSpend); keep them in step.
// All amounts are integer paise.

/**
 * Safe-to-Spend = Confirmed Income − Target Savings − Remaining Unpaid Fixed Bills − Flexible Spent.
 *
 * @param {{
 *   confirmedIncome: number, targetSavings: number, budgetedFixedBills: number,
 *   paidFixedBills: number, flexibleSpent: number, daysRemaining: number
 * }} input
 * @returns {{ remainingFixedBills: number, safeToSpend: number, dailyAllowance: number, isOverspent: boolean }}
 */
export function calculateSafeToSpend({ confirmedIncome, targetSavings, budgetedFixedBills, paidFixedBills, flexibleSpent, daysRemaining }) {
  const remainingFixedBills = Math.max(0, budgetedFixedBills - paidFixedBills);
  const safeToSpend = confirmedIncome - targetSavings - remainingFixedBills - flexibleSpent;
  const dailyAllowance = safeToSpend > 0 ? Math.floor(safeToSpend / Math.max(1, daysRemaining)) : 0;
  return { remainingFixedBills, safeToSpend, dailyAllowance, isOverspent: safeToSpend < 0 };
}

/**
 * Gather the Safe-to-Spend inputs for one budget cycle from raw rows.
 * `startStr`/`endStr` are the inclusive local YYYY-MM-DD cycle bounds from getPeriodRange.
 * `cycleTransactions` must already be limited to the cycle.
 *
 * @template {{ type: string, status: string, amount: number, received_date?: string | null, expected_date?: string | null }} I
 * @param {{
 *   incomeSources: I[],
 *   contributions: Array<{ amount: number, date?: string | null }>,
 *   categories: Array<{ type: string, monthly_limit: number }>,
 *   cycleTransactions: Array<{ type: string, amount: number, category?: { type: string } | null }>,
 *   startStr: string, endStr: string
 * }} rows
 */
export function computeCycleBudgetInputs({ incomeSources, contributions, categories, cycleTransactions, startStr, endStr }) {
  const inCycle = (/** @type {string | null | undefined} */ d) => !!d && d >= startStr && d <= endStr;
  const sum = (/** @type {Array<{amount: number}>} */ rows) => rows.reduce((s, r) => s + Number(r.amount), 0);

  const confirmedIncome = sum(incomeSources.filter((i) => i.status === "received" && inCycle(i.received_date)));
  // Expected variable pay is shown separately and never counted as spendable.
  const expectedVariableSources = incomeSources.filter(
    (i) => i.type === "variable" && i.status === "expected" && inCycle(i.expected_date)
  );
  const unreceivedVariable = sum(expectedVariableSources);
  const budgetedFixedBills = categories
    .filter((c) => c.type === "fixed")
    .reduce((s, c) => s + Number(c.monthly_limit), 0);
  const expenses = cycleTransactions.filter((t) => t.type === "expense");
  const paidFixedBills = sum(expenses.filter((t) => t.category?.type === "fixed"));
  const flexibleSpent = sum(expenses.filter((t) => t.category?.type === "flexible"));
  // No stored savings target exists yet: the target is what was actually contributed this cycle.
  const targetSavings = sum(contributions.filter((c) => inCycle(c.date)));

  return { confirmedIncome, expectedVariableSources, unreceivedVariable, budgetedFixedBills, paidFixedBills, flexibleSpent, targetSavings };
}
