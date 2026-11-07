/** Helpers for recurring income / expenses. The recording itself happens in the database. */

/** Posting key for one schedule in one month. Must match the SQL ('recurring:<id>:<YYYY-MM>'). */
export function recurringKey(itemId, dateStr) {
  return `recurring:${itemId}:${String(dateStr).slice(0, 7)}`;
}

/**
 * Parse the optional "auto-record on day" input.
 * Blank = no automatic day (suggestion only). Otherwise a whole number 1-28.
 * @returns {{ value: number | null } | { error: string }}
 */
export function parseOptionalDay(input) {
  const text = String(input ?? "").trim();
  if (text === "") return { value: null };
  if (!/^\d{1,2}$/.test(text)) return { error: "Day must be a whole number from 1 to 28, or left blank." };
  const day = Number(text);
  if (day < 1 || day > 28) return { error: "Day must be between 1 and 28, or left blank." };
  return { value: day };
}

/**
 * Recurring items of one type, for the suggestion list in the entry pop-ups.
 * `recorded` is true when that schedule already has a transaction for the month of
 * `entryDate`, so recording it again would be a duplicate. Not-yet-recorded first,
 * then by day of month (suggestion-only last), then by name.
 *
 * @template {{id: string, name: string, type: string, day_of_month: number | null, active?: boolean}} T
 * @param {T[]} items
 * @param {"expense" | "income"} type
 * @param {Array<{external_id?: string | null}>} transactions
 * @param {string} entryDate YYYY-MM-DD
 * @returns {Array<{item: T, recorded: boolean}>}
 */
export function suggestRecurring(items, type, transactions, entryDate) {
  const recorded = new Set(transactions.map((t) => t.external_id).filter(Boolean));
  return items
    .filter((item) => item.type === type && item.active !== false)
    .map((item) => ({ item, recorded: recorded.has(recurringKey(item.id, entryDate)) }))
    .sort(
      (a, b) =>
        Number(a.recorded) - Number(b.recorded) ||
        (a.item.day_of_month ?? 99) - (b.item.day_of_month ?? 99) ||
        a.item.name.localeCompare(b.item.name)
    );
}

/** Short description of when a schedule is recorded. */
export function scheduleLabel(item) {
  return item.day_of_month ? `auto-records after day ${item.day_of_month}` : "suggestion only";
}

/**
 * Rows returned by process_due_recurring() -> alert entries. The same occurrence can
 * be reported twice (dev double-mount, two tabs), so merge by transaction id.
 */
export function mergeAutoRecorded(existing, rows) {
  const seen = new Set(existing.map((e) => e.transactionId));
  const added = rows
    .filter((r) => !seen.has(r.transaction_id))
    .map((r) => ({
      transactionId: r.transaction_id,
      itemId: r.item_id,
      name: r.item_name,
      type: r.item_type,
      amount: Number(r.amount_paise),
      date: r.occurred_on,
    }));
  return added.length ? [...existing, ...added] : existing;
}

/** 'YYYY-MM-DD' -> '5 Nov', without going through UTC. */
export function formatShortDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
