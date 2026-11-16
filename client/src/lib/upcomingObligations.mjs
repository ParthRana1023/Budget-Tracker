// Recurring payments for the active budget cycle: what is expected, when, and what has
// actually been recorded. Amounts in paise; dates are local YYYY-MM-DD.

import { recurringKey } from "./recurrence.mjs";
import { toLocalDateString } from "./periods.mjs";

/**
 * @typedef {"recorded" | "due" | "upcoming" | "unscheduled"} ObligationStatus
 * recorded:    a transaction for this schedule exists in the cycle (actual)
 * due:         the scheduled day has arrived but nothing is recorded yet
 * upcoming:    scheduled later in the cycle (expected)
 * unscheduled: suggestion-only schedule with no fixed day (expected, date unknown)
 */

/**
 * @param {{
 *   recurringItems: Array<{ id: string, name: string, amount: number, type: string, category_id: string | null, day_of_month: number | null, active: boolean }>,
 *   categories: Array<{ id: string, name: string, type: string }>,
 *   transactions: Array<{ id: string, amount: number, date: string, external_id?: string | null }>,
 *   period: { startDate: Date, startStr: string, endStr: string },
 *   today: string
 * }} input
 */
export function computeUpcomingObligations({ recurringItems, categories, transactions, period, today }) {
  const { startDate, startStr, endStr } = period;
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const items = recurringItems
    .filter((r) => r.type === "expense" && r.active !== false)
    .map((r) => {
      const category = r.category_id ? categoryById.get(r.category_id) ?? null : null;

      // The cycle is at most one month long and day_of_month is 1-28, so exactly one
      // of the two candidate months holds the scheduled day.
      let dueDate = null;
      if (r.day_of_month) {
        dueDate = [0, 1]
          .map((k) => toLocalDateString(new Date(startDate.getFullYear(), startDate.getMonth() + k, r.day_of_month ?? 1)))
          .find((d) => d >= startStr && d <= endStr) ?? null;
      }

      // Posting keys are 'recurring:<id>:<YYYY-MM>'; match any posting dated inside the cycle.
      const prefix = recurringKey(r.id, "");
      const posted = transactions.find((t) => t.external_id?.startsWith(prefix) && t.date >= startStr && t.date <= endStr);

      /** @type {ObligationStatus} */
      let status;
      if (posted) status = "recorded";
      else if (!dueDate) status = "unscheduled";
      else status = dueDate <= today ? "due" : "upcoming";

      return {
        id: r.id,
        name: r.name,
        expectedAmount: Number(r.amount),
        recordedAmount: posted ? Number(posted.amount) : null,
        recordedDate: posted?.date ?? null,
        dueDate,
        status,
        categoryName: category?.name ?? null,
        categoryType: /** @type {"fixed" | "flexible" | null} */ (category?.type ?? null),
      };
    })
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.name.localeCompare(b.name));

  const sum = (/** @type {typeof items} */ list) => list.reduce((s, i) => s + i.expectedAmount, 0);
  return {
    items,
    totals: {
      monthlyCommitment: sum(items),
      fixed: sum(items.filter((i) => i.categoryType === "fixed")),
      flexible: sum(items.filter((i) => i.categoryType === "flexible")),
      uncategorized: sum(items.filter((i) => !i.categoryType)),
      recorded: items.reduce((s, i) => s + (i.recordedAmount ?? 0), 0),
      stillExpected: sum(items.filter((i) => i.status !== "recorded")),
    },
  };
}
