// What the hourly email job sends, worked out from a user's settings and rows. No imports, so
// both the Edge Function (Deno) and node:test (logic.test.mjs) can load it. Amounts are paise.

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

/** Whole rupees in Indian format, for email text. @param {number} paise */
export const rupees = (paise) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
