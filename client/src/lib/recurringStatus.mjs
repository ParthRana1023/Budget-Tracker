// Where a recurring item stands this cycle (design handoff: items never record
// themselves; on/after their due day they are Due until the user records or skips them).

import { cycleMonthKey, dueDateInCycle } from "./cycle.mjs";

/**
 * @typedef {{ id: string, day_of_month: number | null, active: boolean, skip_month?: string | null }} Item
 * @typedef {{ id: string, date: string, external_id?: string | null }} Tx
 * @typedef {"recorded" | "paused" | "skipped" | "due" | "upcoming" | "suggested"} StatusKey
 */

/**
 * The transaction that recorded `item` in this cycle, if any. Entries recorded for a
 * recurring item carry external_id 'recurring:<item id>:<YYYY-MM>'.
 * @param {Item} item @param {Tx[]} cycleTransactions transactions already limited to the cycle
 */
export const recordedEntry = (item, cycleTransactions) =>
  cycleTransactions.find((t) => t.external_id?.startsWith(`recurring:${item.id}:`)) ?? null;

/**
 * @param {Item} item
 * @param {{ cycleTransactions: Tx[], period: { startStr: string }, today: string }} ctx
 * @returns {{ key: StatusKey, dueDate: string | null, entry: Tx | null }}
 */
export function recurringStatus(item, { cycleTransactions, period, today }) {
  const dueDate = item.day_of_month ? dueDateInCycle(item.day_of_month, period) : null;
  const entry = recordedEntry(item, cycleTransactions);
  /** @type {StatusKey} */
  let key;
  if (entry) key = "recorded";
  else if (!item.active) key = "paused";
  else if (item.skip_month && item.skip_month === cycleMonthKey(period)) key = "skipped";
  else if (dueDate && dueDate <= today) key = "due";
  else if (dueDate) key = "upcoming";
  else key = "suggested";
  return { key, dueDate, entry };
}
