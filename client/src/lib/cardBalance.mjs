// Credit card tracker: what is owed on the card, worked out from entries. Card spend already
// counted against safe to spend on the day it was logged; nothing here changes that. Paying the
// bill is a card_payment entry, a transfer that budgets, Reports and safe to spend ignore.
// No imports, so the push job can use a copy (scripts/sync-shared.mjs).

const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");

/** Day `day` of month `m` (1-12; 0 and 13 roll into the next year) of `y`, or the month's last day. */
function dayIn(/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ day) {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const yy = first.getUTCFullYear(),
    mm = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${pad(mm)}-${pad(Math.min(day, last))}`;
}

/** The last date on or before `date` that falls on day `day` of its month ('YYYY-MM-DD'). */
export function lastOn(/** @type {string} */ date, /** @type {number} */ day) {
  const [y, m] = date.split("-").map(Number);
  const same = dayIn(y, m, day);
  return same <= date ? same : dayIn(y, m - 1, day);
}

/** The first date after `date` that falls on day `day` of its month ('YYYY-MM-DD'). */
export function nextOn(/** @type {string} */ date, /** @type {number} */ day) {
  const [y, m] = date.split("-").map(Number);
  const same = dayIn(y, m, day);
  return same > date ? same : dayIn(y, m + 1, day);
}

/** An expense paid by credit card. @param {{ type: string, payment_method?: string | null }} t */
export const isCardSpend = (t) => t.type === "expense" && t.payment_method === "credit_card";

/**
 * The card balance on `today`, or null when the tracker is off (no statement day).
 * - statement: owed for statements up to the last statement date (including the opening balance
 *   and anything rolled over), less payments.
 * - next: spend since the last statement date, less any payment beyond the statement amount.
 * - total: everything owed; credit: how much was overpaid (one of the two is 0).
 * - dueDate: when the statement is due, or, once it's paid, when the next one will be.
 * Amounts are minor units of today's base (pass entries already converted, like the Dashboard's).
 * @param {{
 *   transactions: Array<{ type: string, amount: number | string, date: string, payment_method?: string | null }>,
 *   settings: { card_statement_day?: number | null, card_due_day?: number | null, card_tracking_since?: string | null, card_opening_balance?: number | string | null } | null,
 *   today: string,
 * }} input
 */
export function cardBalance({ transactions, settings, today }) {
  const sDay = settings?.card_statement_day,
    dDay = settings?.card_due_day,
    since = settings?.card_tracking_since;
  if (!sDay || !dDay || !since) return null;

  const statementDate = lastOn(today, sDay);
  let before = Number(settings.card_opening_balance ?? 0),
    after = 0,
    paid = 0;
  for (const t of transactions) {
    if (t.date < since) continue;
    if (t.type === "card_payment") paid += Number(t.amount);
    else if (isCardSpend(t)) {
      if (t.date <= statementDate) before += Number(t.amount);
      else after += Number(t.amount);
    }
  }
  const total = before + after - paid;
  const statement = Math.max(0, before - paid);
  const nextStatementDate = nextOn(statementDate, sDay);
  const dueDate = nextOn(statement > 0 ? statementDate : nextStatementDate, dDay);
  return {
    statement,
    next: Math.max(0, after - Math.max(0, paid - before)),
    total: Math.max(0, total),
    credit: Math.max(0, -total),
    statementDate,
    nextStatementDate,
    dueDate,
    overdue: statement > 0 && dueDate < today,
  };
}
