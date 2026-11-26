// What the hourly email and push job sends, worked out from a user's settings and rows. Only plain
// relative imports (the Dashboard's own budget maths, copied into ../_shared/budget), so both the
// Edge Function (Deno) and node:test (logic.test.mjs) can load it. Amounts are minor units of the
// user's base currency.

import { buildCycleModel } from "../_shared/budget/cycleModel.mjs";
import { cardStatus, DUE_SOON_DAYS } from "../_shared/budget/cards.mjs";
import { cycleFor, paySchedule } from "../_shared/budget/periods.mjs";

/**
 * The user's local date ('YYYY-MM-DD'), hour (0-23) and weekday (0 Sunday) at `now`.
 * @param {Date} now @param {string} timeZone
 */
export function localParts(now, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/**
 * Inside quiet hours? `from`-`to` may wrap past midnight (22 -> 8). from = to means all day.
 * @param {number} hour @param {{ quiet_hours_on: boolean, quiet_from: number, quiet_to: number }} s
 */
export function isQuiet(hour, s) {
  if (!s.quiet_hours_on) return false;
  const { quiet_from: from, quiet_to: to } = s;
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** 'YYYY-MM-DD' plus n days (calendar dates, no time zone). @param {string} date @param {number} n */
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Bills due on `due` ('YYYY-MM-DD'): active recurring expenses with that day of month (not
 * skipped that month), and fixed bills with that due day that have no recurring item of their own.
 * Each has a `ref` that stays the same for that bill and date, so it is only emailed once.
 * @param {{ id: string, name: string, amount: number, type: string, category_id: string | null, day_of_month: number | null, active: boolean, skip_month?: string | null }[]} items
 * @param {{ id: string, name: string, type: string, monthly_limit: number, due_day: number | null, is_active?: boolean }[]} categories
 * @param {string} due
 */
export function billsDueOn(items, categories, due) {
  const day = Number(due.slice(8)),
    month = due.slice(0, 7);
  const recurring = items.filter(
    (r) => r.active && r.type === "expense" && r.day_of_month === day && r.skip_month !== month,
  );
  const covered = new Set(items.filter((r) => r.active).map((r) => r.category_id));
  const fixed = categories.filter(
    (c) => c.type === "fixed" && c.is_active !== false && c.due_day === day && !covered.has(c.id),
  );
  return [
    ...recurring.map((r) => ({ ref: `item:${r.id}:${due}`, name: r.name, amount: Number(r.amount) })),
    ...fixed.map((c) => ({ ref: `bill:${c.id}:${due}`, name: c.name, amount: Number(c.monthly_limit) })),
  ];
}

/**
 * An amount in the user's base currency with its own decimals, for message text (design handoff
 * v3: "₹12,000.00", "$1,500.50", "¥3,200").
 * @param {number} minor amount in minor units (paise, cents; whole yen) @param {string} [currency]
 */
export function money(minor, currency = "INR") {
  const f = new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "narrowSymbol" });
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2;
  return f.format(minor / 10 ** digits);
}

const digitsOf = (/** @type {string} */ currency) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;

/**
 * Entries in today's base (like the Dashboard, lib/baseSwitch.mjs). A week or the reserve can
 * straddle a base switch: entries from an older base convert at today's rate, which bills, limits
 * and goals set in that base carry (re-priced each cycle). Entries in a base with no known rate
 * are left out rather than mixed in.
 * @template {{ amount: number, base_currency?: string | null }} T
 * @param {T[]} entries @param {string} base
 * @param {Array<{ original_currency?: string | null, fx_rate?: number | null, fx_date?: string | null }>} rateRows
 * @returns {T[]}
 */
export function inTodaysBase(entries, base, rateRows) {
  /** @type {Map<string, { rate: number, date: string }>} */
  const rates = new Map();
  for (const r of rateRows) {
    const c = r.original_currency,
      rate = Number(r.fx_rate);
    if (c && rate > 0 && (!rates.has(c) || (r.fx_date ?? "") > /** @type {any} */ (rates.get(c)).date))
      rates.set(c, { rate, date: r.fx_date ?? "" });
  }
  return entries.flatMap((t) => {
    const c = t.base_currency ?? base;
    if (c === base) return [t];
    const r = rates.get(c);
    return r
      ? [{ ...t, amount: Math.round((Number(t.amount) / 10 ** digitsOf(c)) * r.rate * 10 ** digitsOf(base)) }]
      : [];
  });
}

/** The weekly summary goes out on Monday from this local hour. */
export const WEEKLY_HOUR = 9;

/**
 * Which channels each kind goes out on this run. Email needs the user's switch and a configured
 * sender; push needs the user's per-kind switch and at least one subscribed device.
 * Card bills are push only (handoff v4).
 * @param {{ email_notifications?: boolean, weekly_summary?: boolean, notify_due?: boolean, push_bills?: boolean, push_weekly?: boolean, push_cards?: boolean }} s
 * @param {{ emailReady: boolean, pushReady: boolean, devices: number }} ctx
 */
export function channels(s, { emailReady, pushReady, devices }) {
  const push = pushReady && devices > 0;
  return {
    bills: { email: emailReady && !!s.email_notifications && !!s.notify_due, push: push && s.push_bills !== false },
    weekly: { email: emailReady && !!s.weekly_summary, push: push && s.push_weekly !== false },
    cards: { push: push && s.push_cards !== false },
  };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Lock-screen text for a bill reminder (design handoff v3, Push). Tapping opens Log expense filled
 * in for that bill; Android also shows a "Record it" action. The tag makes a newer reminder for the
 * same bill and month replace the older one.
 * @param {{ ref: string, name: string, amount: number }} bill from billsDueOn
 * @param {number} days how far ahead @param {string} due YYYY-MM-DD @param {string} [currency]
 */
export function billPush(bill, days, due, currency = "INR") {
  const [kind, id] = bill.ref.split(":");
  const when =
    days === 1
      ? "tomorrow"
      : days === 3
        ? "in 3 days"
        : `on ${Number(due.slice(8))} ${MON[Number(due.slice(5, 7)) - 1]}`;
  return {
    title: `${bill.name} is due ${when}`,
    body: `${money(bill.amount, currency)} · Tap to record it once it’s paid.`,
    url: kind === "item" ? `/dashboard?record=${id}` : `/dashboard?pay=${id}`,
    tag: `bill-${id}-${due.slice(0, 7)}`,
    actions: [{ action: "record", title: "Record it" }],
  };
}

/**
 * Card bill reminders due today (handoff v4, Push States): one per card in use with reminders on,
 * DUE_SOON_DAYS (3) days before the due date and on the day itself, while its statement still
 * asks for money. `ref` makes each one go out once (notification_log, kind "bill").
 * @param {import("../_shared/budget/cards.mjs").Card[]} cards
 * @param {import("../_shared/budget/cards.mjs").Entry[]} entries card spend and payments, in today's base
 * @param {string} today 'YYYY-MM-DD' (user's local date)
 * @returns {Array<{ ref: string, cardId: string, name: string, amount: number, due: string, days: number }>}
 */
export function cardReminders(cards, entries, today) {
  return cards
    .filter((c) => !c.archived_at && c.reminders !== false)
    .map((c) => cardStatus(c, entries, today))
    .filter((s) => s.statement > 0 && (s.daysToDue === DUE_SOON_DAYS || s.daysToDue === 0))
    .map((s) => ({
      ref: `card:${s.id}:${s.dueDate}:${s.daysToDue}`,
      cardId: s.id,
      name: s.name,
      amount: s.statement,
      due: s.dueDate,
      days: s.daysToDue,
    }));
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Lock-screen text for a card bill reminder (handoff v4, Push States). Tapping opens the "Card
 * bill paid" sheet filled in for that card; Android also shows "Mark paid", which does the same.
 * The tag makes the on-the-day reminder replace the 3-day one.
 * @param {{ cardId: string, name: string, amount: number, due: string, days: number }} r from cardReminders
 * @param {string} [currency]
 */
export const cardPush = (r, currency = "INR") => ({
  title: `Card bill due ${r.days === 0 ? "today" : `in ${r.days} days`}`,
  body: `${money(r.amount, currency)} on ${r.name} is due ${
    r.days === 0 ? "today" : `${WEEKDAY[new Date(`${r.due}T00:00:00Z`).getUTCDay()]}, ${dayMonth(r.due)}`
  }. Mark it paid once it’s done.`,
  url: `/dashboard?modal=payCard&card=${r.cardId}`,
  tag: `card-${r.cardId}-${r.due}`,
  actions: [{ action: "paid", title: "Mark paid" }],
});

/**
 * This cycle's safe to spend for the weekly summary, the same way the Dashboard works it out.
 * @param {{ settings: any, categories: any[], transactions: any[], recurringItems: any[], today: string }} input
 * @returns {{ safe: number, cycleEnd: string, cycleStart: string }}
 */
export function safeNow({ settings, categories, transactions, recurringItems, today }) {
  const [y, m, d] = today.split("-").map(Number);
  const period = cycleFor(new Date(y, m - 1, d, 12), paySchedule(settings));
  const model = buildCycleModel({ settings, categories, transactions, recurringItems, period, today });
  return { safe: model.safe, cycleEnd: period.endStr, cycleStart: period.startStr };
}

/** "30 Nov" from 'YYYY-MM-DD'. @param {string} date */
const dayMonth = (date) => `${Number(date.slice(8))} ${MON[Number(date.slice(5, 7)) - 1]}`;

/**
 * Lock-screen text for the weekly summary (design handoff v3, Push).
 * @param {number} spent last week's spending @param {number} safe safe to spend now
 * @param {string} cycleEnd 'YYYY-MM-DD' @param {string} [currency]
 */
export const weeklyPush = (spent, safe, cycleEnd, currency = "INR") => ({
  title: `Your week: ${money(spent, currency)} spent`,
  body: `${safe > 0 ? `${money(safe, currency)} is safe to spend` : "Nothing is left to spend"} until ${dayMonth(cycleEnd)}. Savings are already set aside.`,
  url: "/dashboard?view=reports",
  tag: "weekly",
});
