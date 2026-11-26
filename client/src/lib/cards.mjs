// Credit card tracker (handoff v4 §1): what is owed on each card, worked out from entries. Card
// spend already counted against safe to spend on the day it was logged; nothing here changes
// that. Marking a bill paid is a card_payment entry, a transfer that budgets, Reports and safe to
// spend ignore. Only entries with the card's card_id count.
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

/** 'YYYY-MM-DD' plus n days. */
function addDay(/** @type {string} */ date, /** @type {number} */ n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'). */
const daysBetween = (/** @type {string} */ a, /** @type {string} */ b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Due soon: this many days or fewer before the due date (also the push reminder). */
export const DUE_SOON_DAYS = 3;

/**
 * @typedef {{ id: string, name: string, statement_day: number, due_day: number, opening_balance?: number | string | null,
 *   reminders?: boolean, archived_at?: string | null }} Card
 * @typedef {{ type: string, amount: number | string, date: string, payment_method?: string | null, card_id?: string | null }} Entry
 */

/** Spend on this card (an expense paid by credit card, tagged with the card). @param {Entry} t @param {string} cardId */
export const isCardSpend = (t, cardId) =>
  t.type === "expense" && t.payment_method === "credit_card" && t.card_id === cardId;

/** A payment towards this card's bill. @param {Entry} t @param {string} cardId */
export const isCardPayment = (t, cardId) => t.type === "card_payment" && t.card_id === cardId;

/**
 * One card on `today`. Amounts are minor units of today's base (pass entries already converted,
 * like the Dashboard's).
 * - owed: opening balance + card spend − payments. Below 0 the card is in credit.
 * - statement: what the last closed statement still asks for (spend up to the close, plus the
 *   opening balance, less every payment so far), never below 0.
 * - dueDate: that statement's due date while it's unpaid, else the next statement's.
 * - status: "credit" | "clear" (nothing owed) | "overdue" | "soon" (within DUE_SOON_DAYS) | "due".
 * @param {Card} card @param {Entry[]} entries @param {string} today
 */
export function cardStatus(card, entries, today) {
  const opening = Number(card.opening_balance ?? 0);
  const closed = lastOn(today, card.statement_day);
  let before = opening,
    spend = 0,
    spendCount = 0,
    paid = 0,
    payments = 0;
  for (const t of entries) {
    const a = Number(t.amount);
    if (isCardPayment(t, card.id)) {
      paid += a;
      payments++;
    } else if (isCardSpend(t, card.id)) {
      spend += a;
      spendCount++;
      if (t.date <= closed) before += a;
    }
  }
  const owed = opening + spend - paid;
  const statement = Math.max(0, before - paid);
  const dueDate = nextOn(statement > 0 ? closed : nextOn(closed, card.statement_day), card.due_day);
  const daysToDue = daysBetween(today, dueDate);
  const status =
    owed < 0
      ? "credit"
      : owed === 0
        ? "clear"
        : statement > 0 && daysToDue < 0
          ? "overdue"
          : daysToDue <= DUE_SOON_DAYS
            ? "soon"
            : "due";
  return { id: card.id, name: card.name, owed, statement, statementDate: closed, dueDate, daysToDue, status,
    opening, spend, spendCount, paid, payments };
}

/**
 * The card's last `count` bills, oldest first: each closed statement that asked for money and
 * whose due date has passed (or that's already paid). On time = a payment logged after the
 * statement closed and on or before its due date, or the bill already covered by then.
 * @param {Card} card @param {Entry[]} entries @param {string} today @param {number} [count]
 * @returns {Array<{ statementDate: string, dueDate: string, amount: number, onTime: boolean }>}
 */
export function cardHistory(card, entries, today, count = 6) {
  const own = entries.filter((t) => isCardSpend(t, card.id) || isCardPayment(t, card.id));
  const total = (/** @type {(t: Entry) => boolean} */ keep) => own.filter(keep).reduce((s, t) => s + Number(t.amount), 0);
  const spentBy = (/** @type {string} */ d) => Number(card.opening_balance ?? 0) + total((t) => t.type === "expense" && t.date <= d);
  const paidBy = (/** @type {string} */ d) => total((t) => t.type === "card_payment" && t.date <= d);
  const first = own.reduce((m, t) => (t.date < m ? t.date : m), today);

  const bills = [];
  for (let close = lastOn(today, card.statement_day); bills.length < count && close >= first; close = lastOn(addDay(close, -1), card.statement_day)) {
    const due = nextOn(close, card.due_day);
    const amount = spentBy(close) - paidBy(close);
    if (amount <= 0) continue;
    const covered = paidBy(due) >= spentBy(close);
    const paidInWindow = own.some((t) => t.type === "card_payment" && t.date > close && t.date <= due);
    if (due <= today || covered) bills.push({ statementDate: close, dueDate: due, amount, onTime: covered || paidInWindow });
  }
  return bills.reverse();
}

const RANK = { overdue: 0, soon: 1, due: 2, credit: 3, clear: 4 };

/**
 * Every card in use on `today`, most urgent first (overdue longest, then due soonest), and the
 * total owed across them (cards in credit don't lower it).
 * @param {Card[]} cards @param {Entry[]} entries @param {string} today
 */
export function cardsSummary(cards, entries, today) {
  const list = cards
    .filter((c) => !c.archived_at)
    .map((c) => cardStatus(c, entries, today))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.daysToDue - b.daysToDue || a.name.localeCompare(b.name));
  return { cards: list, total: list.reduce((s, c) => s + Math.max(0, c.owed), 0), urgent: list[0] ?? null };
}
