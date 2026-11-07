import { toLocalMonthKey } from "./periods.mjs";

/** Posting key for one schedule in one calendar month; must match post_recurring_item() in SQL. */
export function recurringExternalId(itemId, date = new Date()) {
  return `recurring:${itemId}:${toLocalMonthKey(date)}`;
}

export function isRecurringItemDue(item, transactions, today = new Date()) {
  if (!item.active || today.getDate() < item.day_of_month) return false;
  const key = recurringExternalId(item.id, today);
  return !transactions.some((transaction) => transaction.external_id === key);
}

/**
 * Parse a rupee amount typed by the user into integer paise.
 * Returns null for anything that is not a positive amount with at most 2 decimals.
 * Works on the digits of the string, so there is no floating-point multiplication involved.
 */
export function rupeesToPaise(input) {
  const text = String(input ?? "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return paise > 0 && Number.isSafeInteger(paise) ? paise : null;
}

/**
 * Validate the recurring-schedule form. Returns { error } or { value } where
 * value is the row to write. Income schedules have no category; expense schedules require one.
 */
export function validateRecurringForm({ name, amount, day, type, categoryId }) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { error: "Enter a name." };
  const paise = rupeesToPaise(amount);
  if (paise === null) return { error: "Enter a valid amount greater than zero (up to 2 decimals)." };
  const dayNum = Number(day);
  if (!Number.isInteger(dayNum) || dayNum < 1 || dayNum > 28) return { error: "Day of month must be between 1 and 28." };
  if (type !== "expense" && type !== "income") return { error: "Choose expense or income." };
  if (type === "expense" && !categoryId) return { error: "Choose a category for an expense." };
  return {
    value: {
      name: trimmed,
      amount: paise,
      type,
      day_of_month: dayNum,
      category_id: type === "expense" ? categoryId : null,
    },
  };
}
