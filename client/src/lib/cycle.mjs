// Date helpers for a pay-day cycle (see getPeriodRange in periods.mjs).
// Dates are local 'YYYY-MM-DD' strings; cycle days are 1-based (day 1 = cycle start).

import { getPeriodRange, toLocalDateString } from "./periods.mjs";

/** @param {string} s YYYY-MM-DD */
const parts = (s) => s.split("-").map(Number);

/** 'YYYY-MM-DD' + n days, in local calendar days (no DST drift). */
export function addDaysStr(dateStr, n) {
  const [y, m, d] = parts(dateStr);
  return toLocalDateString(new Date(y, m - 1, d + n));
}

/** 1-based day of the cycle for a date (can be <1 or >totalDays for dates outside it). */
export function cycleDayOf(dateStr, period) {
  const [y1, m1, d1] = parts(period.startStr);
  const [y2, m2, d2] = parts(dateStr);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

/**
 * The date a monthly due day (1-28) falls on inside the cycle. A cycle runs from its
 * start day to the day before it next month, so day >= start day is in the first
 * month and day < start day is in the next one.
 */
export function dueDateInCycle(dayOfMonth, period) {
  const [y, m, startDay] = parts(period.startStr);
  return toLocalDateString(new Date(y, m - 1 + (dayOfMonth >= startDay ? 0 : 1), dayOfMonth));
}

/** 'YYYY-MM' of the cycle start: the month key used for "Skip this month". */
export const cycleMonthKey = (period) => period.startStr.slice(0, 7);

/**
 * 'YYYY-MM' of the start of the cycle a date falls in, for a recurring entry's unique key
 * (record_entry_with_recurring's p_cycle_key). The date may be outside the current cycle
 * when an entry is back-dated. Uses the current cycle's start day as the pay day.
 * @param {string} dateStr @param {{ startStr: string, endStr: string }} period
 */
export function cycleKeyFor(dateStr, period) {
  if (dateStr >= period.startStr && dateStr <= period.endStr) return cycleMonthKey(period);
  const [y, m, d] = parts(dateStr);
  return getPeriodRange(new Date(y, m - 1, d), parts(period.startStr)[2]).startStr.slice(0, 7);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2026-11-20' -> '20 Nov'. */
export function shortDate(dateStr) {
  const [, m, d] = parts(dateStr);
  return `${d} ${MON[m - 1]}`;
}

/** 'Today', 'Yesterday' or '14 Nov' (ledger day headings, notices). */
export function dayLabel(dateStr, today) {
  if (dateStr === today) return "Today";
  if (dateStr === addDaysStr(today, -1)) return "Yesterday";
  return shortDate(dateStr);
}

/** '2027-06-01' -> 'Jun 2027'. */
export function monthLabel(dateStr) {
  const [y, m] = parts(dateStr);
  return `${MON[m - 1]} ${y}`;
}

/** Header line: 'Cycle 1–30 Nov · Day 16 of 30', or 'Cycle 25 Nov–24 Dec · Day 4 of 30'. */
export function cycleLabel(period) {
  const [, m1, d1] = parts(period.startStr);
  const [, m2, d2] = parts(period.endStr);
  const range = m1 === m2 ? `${d1}–${d2} ${MON[m2 - 1]}` : `${d1} ${MON[m1 - 1]}–${d2} ${MON[m2 - 1]}`;
  return `Cycle ${range} · Day ${period.daysElapsed} of ${period.totalDays}`;
}
