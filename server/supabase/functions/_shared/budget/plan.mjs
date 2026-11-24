// The budget plan (salary, save-first %) in force for a cycle, from the plan history
// (user_settings.plan_changes). Pay day is handled by paySchedule/cycleFor in periods.mjs.
// Amounts are paise.

/** @typedef {import("./periods.mjs").PlanChange} PlanChange */

/**
 * The value of `field` in force at a cycle start: the latest change that applies at or
 * before it (newest decision first on the same day), else the "Start" row, else `fallback`.
 * @param {PlanChange[]} rows @param {"salary" | "save_pct"} field @param {string} cycleStart @param {number | null | undefined} fallback
 */
function valueAt(rows, field, cycleStart, fallback) {
  let best = /** @type {PlanChange | null} */ (null);
  for (const r of rows) {
    if (r.field !== field || r.superseded_at) continue;
    const at = r.applies === "start" ? "" : r.effective_from;
    if (at > cycleStart) continue;
    const bestAt = !best ? null : best.applies === "start" ? "" : best.effective_from;
    if (bestAt === null || at > bestAt || (at === bestAt && String(r.created_at) > String(best?.created_at))) best = r;
  }
  return best ? Number(best.to_value) : (fallback ?? null);
}

/**
 * Salary and save-first % in force for the cycle starting `cycleStart`, in the same shape as
 * user_settings so callers can use it in place of the settings row.
 * @param {{ take_home_pay?: number | null, savings_pct?: number | null, plan_changes?: PlanChange[] | null } | null | undefined} settings
 * @param {string} cycleStart 'YYYY-MM-DD'
 * @returns {{ take_home_pay: number | null, savings_pct: number | null }}
 */
export function planFor(settings, cycleStart) {
  const rows = settings?.plan_changes ?? [];
  return {
    take_home_pay: valueAt(rows, "salary", cycleStart, settings?.take_home_pay),
    savings_pct: valueAt(rows, "save_pct", cycleStart, settings?.savings_pct),
  };
}
