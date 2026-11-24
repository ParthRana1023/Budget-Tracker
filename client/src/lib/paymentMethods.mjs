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
/** Short names for the picker and ledger chips (design handoff v3, Payment). */
const SHORT = new Map([
  ["upi", "UPI"],
  ["debit_card", "Debit"],
  ["credit_card", "Credit"],
  ["cash", "Cash"],
  ["other", "Other"],
]);
/** An expense with no method (older entries, or cleared). */
export const NOT_SET = "Not set";

/** "Debit" for "debit_card"; "" when there is none. @param {string | null | undefined} key */
export const methodShort = (key) => (key && SHORT.get(key)) || "";

/**
 * A ledger filter from the URL (?method=cash,none): known keys and "none", in picker order.
 * @param {string | null | undefined} param @returns {string[]}
 */
export const parseMethodFilter = (param) => {
  const want = new Set((param ?? "").split(",").map((s) => s.trim()));
  return [...PAYMENT_METHODS.map(([k]) => k), "none"].filter((k) => want.has(k));
};

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
 * Expense totals per method, biggest first; entries without one are grouped as "Not set", always last.
 * @template {{ type: string, amount: number | string, payment_method?: string | null }} T
 * @param {T[]} entries
 */
export function spendByMethod(entries) {
  /** @type {Map<string, { key: string | null, label: string, amount: number, count: number, entries: T[] }>} */
  const g = new Map();
  for (const t of entries) {
    if (t.type !== "expense") continue;
    const key = t.payment_method || null;
    const row = g.get(key ?? "") ?? { key, label: methodLabel(key) || NOT_SET, amount: 0, count: 0, entries: [] };
    row.amount += Number(t.amount);
    row.count++;
    row.entries.push(t);
    g.set(key ?? "", row);
  }
  return [...g.values()].sort((a, b) => Number(!a.key) - Number(!b.key) || b.amount - a.amount);
}
