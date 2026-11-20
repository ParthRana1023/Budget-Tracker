// Date and budget-period helpers.
//
// Everything here works in the user's LOCAL calendar. Never derive a YYYY-MM-DD
// string with `date.toISOString()`: that converts to UTC first, so in any timezone
// ahead of UTC (e.g. IST, UTC+5:30) a local midnight becomes the *previous* day.

/** Format a Date as YYYY-MM-DD using its local calendar fields. */
export function toLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Format a Date as YYYY-MM using its local calendar fields. */
export function toLocalMonthKey(date = new Date()) {
  return toLocalDateString(date).slice(0, 7);
}

// Whole calendar days from a to b, ignoring time of day and DST shifts.
function calendarDaysBetween(a, b) {
  const utc = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/**
 * The billing cycle containing `referenceDate`, for a cycle that starts on
 * `monthStartDay` (clamped to 1-28 so it exists in every month).
 *
 * startStr / endStr are inclusive local YYYY-MM-DD bounds, safe to compare
 * against `date` columns with plain string comparison.
 *
 * @param {Date} [referenceDate]
 * @param {number} [monthStartDay]
 */
export function getPeriodRange(referenceDate = new Date(), monthStartDay = 1) {
  return cycleFor(referenceDate, [{ payDay: monthStartDay }]);
}

/** Pay day 31 means "the last day of the month"; anything else is clamped to 1-28. */
const normPayDay = (/** @type {number} */ d) => {
  const n = Math.trunc(d) || 1;
  return n >= 31 ? 31 : Math.min(Math.max(1, n), 28);
};
/** 'YYYY-MM-DD' -> local Date at midnight. */
const toDate = (/** @type {string} */ s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const plusDays = (/** @type {string} */ s, /** @type {number} */ n) => {
  const d = toDate(s);
  return toLocalDateString(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** The pay date in month m0 (0-based, may overflow) of year y. */
const payDateIn = (/** @type {number} */ y, /** @type {number} */ m0, /** @type {number} */ payDay) =>
  toLocalDateString(new Date(y, m0, payDay === 31 ? new Date(y, m0 + 1, 0).getDate() : payDay));
/** Latest pay date on or before s, and earliest pay date after s. */
function payDatesAround(/** @type {string} */ s, /** @type {number} */ payDay) {
  const d = toDate(s);
  const here = payDateIn(d.getFullYear(), d.getMonth(), payDay);
  return here <= s
    ? { prev: here, next: payDateIn(d.getFullYear(), d.getMonth() + 1, payDay) }
    : { prev: payDateIn(d.getFullYear(), d.getMonth() - 1, payDay), next: here };
}

/** A pay-day change only starts a normal cycle at a new pay date at least this many days later. */
const MIN_TRANSITION_DAYS = 15;

/**
 * @typedef {{ payDay: number, from?: string | null, applies?: "now" | "next", madeOn?: string }} PayDayEntry
 *   The pay day in force from `from` ('YYYY-MM-DD', a cycle start). The entry without `from`
 *   is the original pay day. `applies` 'now' = changed for the cycle it was made in, on
 *   `madeOn`; 'next' (default) = from the next cycle.
 */

/**
 * @typedef {{ field: "salary" | "payday" | "save_pct", from_value?: number | null, to_value: number,
 *   applies: "start" | "now" | "next", effective_from: string, superseded_at?: string | null, created_at?: string }} PlanChange
 */

/**
 * The pay-day schedule of a user from the plan history (user_settings.plan_changes): the
 * onboarding pay day plus every change still in force. Falls back to month_start_day.
 * @param {{ month_start_day?: number | null, plan_changes?: PlanChange[] | null } | null | undefined} settings
 * @returns {PayDayEntry[]}
 */
export function paySchedule(settings) {
  const rows = (settings?.plan_changes ?? []).filter((r) => r.field === "payday" && !r.superseded_at);
  const start = rows.find((r) => r.applies === "start");
  return [
    { payDay: Number(start?.to_value ?? settings?.month_start_day) || 1 },
    ...rows
      .filter((r) => r.applies !== "start")
      .map((r) => ({
        payDay: Number(r.to_value),
        from: r.effective_from,
        applies: /** @type {"now" | "next"} */ (r.applies),
        ...(r.created_at ? { madeOn: toLocalDateString(new Date(r.created_at)) } : {}),
      })),
  ];
}

/**
 * The pay-day cycle containing `referenceDate` under a pay-day schedule.
 *
 * A cycle runs from one pay date to the day before the next. Pay day 31 is the last day
 * of each month. When the pay day changes from F (a cycle start):
 *   - 'next' (F = the next pay date under the old pay day): the cycle starting at F runs to
 *     the first new pay date at least MIN_TRANSITION_DAYS after F, so no cycle is shorter
 *     than that (25th -> last day, F = 25 Dec: 25 Dec - 30 Jan, not 25 - 30 Dec).
 *   - 'now' (F = the start of the cycle it was made in): that cycle keeps its start and ends
 *     the day before the first new pay date after the day the change was made; no entry
 *     changes cycle (25th -> 1st on 28 Nov: 25 Nov - 30 Nov).
 *
 * startStr / endStr are inclusive local YYYY-MM-DD bounds, safe to compare against `date`
 * columns with plain string comparison.
 *
 * @param {Date} referenceDate
 * @param {PayDayEntry[]} schedule
 */
export function cycleFor(referenceDate, schedule) {
  const ref = toLocalDateString(referenceDate);
  const changes = schedule
    .filter((e) => e.from)
    .sort((a, b) => (/** @type {string} */ (a.from) < /** @type {string} */ (b.from) ? -1 : 1));
  const base = schedule.find((e) => !e.from) ?? { payDay: 1 };
  let seg = /** @type {PayDayEntry} */ (base);
  let nextChange = /** @type {string | null} */ (null);
  for (const c of changes) {
    if (/** @type {string} */ (c.from) <= ref) seg = c;
    else {
      nextChange = /** @type {string} */ (c.from);
      break;
    }
  }
  const payDay = normPayDay(seg.payDay);
  // New pay dates after `boundary` start cycles; up to it, the cycle that began at the change runs on.
  const boundary = !seg.from
    ? null
    : seg.applies === "now" && seg.madeOn
      ? seg.madeOn
      : plusDays(seg.from, MIN_TRANSITION_DAYS - 1);

  const around = payDatesAround(ref, payDay);
  const startStr = boundary && around.prev <= boundary ? /** @type {string} */ (seg.from) : around.prev;
  let next = around.next;
  while (boundary && next <= boundary) next = payDatesAround(next, payDay).next;
  if (nextChange && nextChange < next) next = nextChange;
  const endStr = plusDays(next, -1);

  const startDate = toDate(startStr);
  const endDate = toDate(endStr);
  endDate.setHours(23, 59, 59, 999);

  const totalDays = calendarDaysBetween(startDate, endDate) + 1;
  const daysElapsed = calendarDaysBetween(startDate, referenceDate) + 1;
  const daysRemaining = Math.max(1, totalDays - daysElapsed + 1);

  const fmt = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const periodLabel = `${fmt(startDate)} – ${fmt(endDate)} ${endDate.getFullYear()}`;

  return {
    startDate,
    endDate,
    startStr: toLocalDateString(startDate),
    endStr: toLocalDateString(endDate),
    totalDays,
    daysElapsed,
    daysRemaining,
    periodLabel,
  };
}

/**
 * Milliseconds from `now` until the next local midnight, i.e. the end of the
 * user's day. Built from local calendar fields, so it is right on 23h / 25h DST days.
 */
export function msUntilNextLocalMidnight(now = new Date()) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}
