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
  const clampedStart = Math.min(Math.max(1, Math.trunc(monthStartDay) || 1), 28);
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const day = referenceDate.getDate();

  let startDate;
  let endDate;
  if (day >= clampedStart) {
    startDate = new Date(year, month, clampedStart);
    endDate = new Date(year, month + 1, clampedStart - 1, 23, 59, 59, 999);
  } else {
    startDate = new Date(year, month - 1, clampedStart);
    endDate = new Date(year, month, clampedStart - 1, 23, 59, 59, 999);
  }

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
