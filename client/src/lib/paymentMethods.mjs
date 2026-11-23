// How an expense was paid: a tag for tracking and reports. Safe-to-spend never reads it.
// Keys match the database check on transactions.payment_method and recurring_items.payment_method.

/** @typedef {"upi" | "debit_card" | "credit_card" | "cash" | "other"} PaymentMethod */

/** @type {ReadonlyArray<readonly [PaymentMethod, string]>} */
export const PAYMENT_METHODS = [
  ["upi", "UPI"],
  ["debit_card", "Debit card"],
  ["credit_card", "Credit card"],
  ["cash", "Cash"],
  ["other", "Other"],
];
const LABELS = new Map(PAYMENT_METHODS);
export const NOT_RECORDED = "Not recorded";

/** "Debit card" for "debit_card"; "" when there is none. @param {string | null | undefined} key */
export const methodLabel = (key) => (key && LABELS.get(/** @type {PaymentMethod} */ (key))) || "";

/**
 * A CSV cell as a method key: the label ("Credit card") or the key ("credit_card"), any case.
 * Blank -> null (not recorded); anything else -> undefined (unknown).
 * @param {string} text
 * @returns {PaymentMethod | null | undefined}
 */
export function parseMethod(text) {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = PAYMENT_METHODS.find(([k, label]) => k === t || label.toLowerCase() === t);
  return hit ? hit[0] : undefined;
}

/**
 * Expense totals per method, biggest first; entries without one are grouped as "Not recorded".
 * @template {{ type: string, amount: number | string, payment_method?: string | null }} T
 * @param {T[]} entries
 */
export function spendByMethod(entries) {
  /** @type {Map<string, { key: string | null, label: string, amount: number, count: number, entries: T[] }>} */
  const g = new Map();
  for (const t of entries) {
    if (t.type !== "expense") continue;
    const key = t.payment_method || null;
    const row = g.get(key ?? "") ?? { key, label: methodLabel(key) || NOT_RECORDED, amount: 0, count: 0, entries: [] };
    row.amount += Number(t.amount);
    row.count++;
    row.entries.push(t);
    g.set(key ?? "", row);
  }
  return [...g.values()].sort((a, b) => b.amount - a.amount);
}
