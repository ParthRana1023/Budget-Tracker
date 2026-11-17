// Budget plan rows (supabase/migrations/20261117000000_budget_plans.sql). Amounts in paise.

export interface BudgetPlanRow {
  id: string;
  cycle_start: string; // YYYY-MM-DD
  expected_regular_income: number;
  expected_variable_income: number;
  planned_savings: number;
  categories: Array<{ category_id: string; planned_limit: number }>;
}

/** Same select for the server page load and the client refresh. */
export const BUDGET_PLAN_SELECT =
  "id, cycle_start, expected_regular_income, expected_variable_income, planned_savings, categories:budget_plan_categories(category_id, planned_limit)";

/**
 * True when the budget_plans migration has not been run yet. The planner then shows
 * a setup notice instead of failing the whole dashboard.
 */
export function isMissingPlansTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
