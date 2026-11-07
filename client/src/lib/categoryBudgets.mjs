/**
 * Per-category budget status for the current cycle.
 *
 * A category with a monthly limit of 0 has *no limit set* (this is what every
 * starter category begins as). It must never be reported as over budget, and it
 * never raises an alert; it just reports what was spent.
 *
 * @param {Array<{id: string, name: string, type: "fixed" | "flexible", monthly_limit: number}>} categories
 * @param {Array<{category_id: string | null, amount: number, type: string}>} transactions
 * @returns {Array<{
 *   id: string, name: string, type: "fixed" | "flexible",
 *   monthlyLimit: number, spent: number, remaining: number, percentUsed: number,
 *   hasLimit: boolean, status: "safe" | "warning" | "danger" | "exceeded"
 * }>}
 */
export function computeCategoryBudgets(categories, transactions) {
  return categories.map((cat) => {
    const spent = transactions
      .filter((t) => t.type === "expense" && t.category_id === cat.id)
      .reduce((sum, t) => sum + Number(t.amount), 0);

    const monthlyLimit = Number(cat.monthly_limit);
    const hasLimit = monthlyLimit > 0;
    const remaining = hasLimit ? monthlyLimit - spent : 0;
    const percentUsed = hasLimit ? (spent / monthlyLimit) * 100 : 0;

    let status = "safe";
    if (hasLimit) {
      if (percentUsed >= 100) status = "exceeded";
      else if (percentUsed >= 90) status = "danger";
      else if (percentUsed >= 75) status = "warning";
    }

    return { id: cat.id, name: cat.name, type: cat.type, monthlyLimit, spent, remaining, percentUsed, hasLimit, status };
  });
}
