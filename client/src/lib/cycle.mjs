// Date helpers for a pay-day cycle (see getPeriodRange in periods.mjs).
// Dates are local 'YYYY-MM-DD' strings; cycle days are 1-based (day 1 = cycle start).

import { toLocalDateString } from "./periods.mjs";

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
