import assert from "node:assert/strict";
import test from "node:test";
import { getPeriodRange, toLocalDateString, toLocalMonthKey } from "./periods.mjs";

// These tests are timezone-sensitive by design. `npm run test:unit` runs this file
// under several TZ values (see scripts/run-unit-tests.mjs); the assertions must hold
// in every one of them.
const at = (y, m, d, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s);
const range = (ref, startDay = 1) => {
  const p = getPeriodRange(ref, startDay);
  return [p.startStr, p.endStr, p.totalDays, p.daysElapsed, p.daysRemaining];
};

test("toLocalDateString uses local calendar fields, not UTC", () => {
  assert.equal(toLocalDateString(at(2026, 11, 1, 0, 0, 0)), "2026-11-01");
  assert.equal(toLocalDateString(at(2026, 11, 1, 0, 30)), "2026-11-01");
  assert.equal(toLocalDateString(at(2026, 10, 31, 23, 59, 59)), "2026-10-31");
  assert.equal(toLocalMonthKey(at(2026, 11, 1, 0, 5)), "2026-11");
});

test("month boundary, start day 1: last day of one cycle vs first day of the next", () => {
  assert.deepEqual(range(at(2026, 10, 31, 23, 59, 59)), ["2026-10-01", "2026-10-31", 31, 31, 1]);
  assert.deepEqual(range(at(2026, 11, 1, 0, 0, 0)), ["2026-11-01", "2026-11-30", 30, 1, 30]);
  assert.deepEqual(range(at(2026, 11, 30, 23, 59, 59)), ["2026-11-01", "2026-11-30", 30, 30, 1]);
  assert.deepEqual(range(at(2026, 12, 1, 0, 0, 0)), ["2026-12-01", "2026-12-31", 31, 1, 31]);
});

test("a period start never leaks into the previous day (IST regression)", () => {
  // Before the fix, in UTC+5:30 the Nov cycle's start string was "2026-10-31".
  assert.equal(getPeriodRange(at(2026, 11, 15), 1).startStr, "2026-11-01");
  assert.equal(getPeriodRange(at(2026, 11, 15), 15).startStr, "2026-11-15");
  assert.equal(getPeriodRange(at(2026, 11, 15), 15).endStr, "2026-12-14");
});

test("mid-month start day: day before vs day of the start", () => {
  assert.deepEqual(range(at(2026, 11, 14, 23, 59), 15), ["2026-10-15", "2026-11-14", 31, 31, 1]);
  assert.deepEqual(range(at(2026, 11, 15, 0, 0), 15), ["2026-11-15", "2026-12-14", 30, 1, 30]);
});

test("cycle crossing a year boundary", () => {
  assert.deepEqual(range(at(2026, 12, 20), 15), ["2026-12-15", "2027-01-14", 31, 6, 26]);
  assert.deepEqual(range(at(2027, 1, 14, 23, 59), 15), ["2026-12-15", "2027-01-14", 31, 31, 1]);
  assert.deepEqual(range(at(2027, 1, 15, 0, 0), 15), ["2027-01-15", "2027-02-14", 31, 1, 31]);
});

test("February: leap and non-leap years, start day 1", () => {
  assert.deepEqual(range(at(2027, 2, 28, 23, 59)), ["2027-02-01", "2027-02-28", 28, 28, 1]);
  assert.deepEqual(range(at(2027, 3, 1, 0, 0)), ["2027-03-01", "2027-03-31", 31, 1, 31]);
  assert.deepEqual(range(at(2028, 2, 29, 23, 59)), ["2028-02-01", "2028-02-29", 29, 29, 1]);
  assert.deepEqual(range(at(2028, 3, 1, 0, 0)), ["2028-03-01", "2028-03-31", 31, 1, 31]);
});

test("start day 28 (the maximum) across February", () => {
  assert.deepEqual(range(at(2027, 2, 27), 28), ["2027-01-28", "2027-02-27", 31, 31, 1]);
  assert.deepEqual(range(at(2027, 2, 28), 28), ["2027-02-28", "2027-03-27", 28, 1, 28]);
  assert.deepEqual(range(at(2028, 2, 28), 28), ["2028-02-28", "2028-03-27", 29, 1, 29]);
});

test("start days above 28, below 1 or invalid are clamped into 1-28", () => {
  assert.equal(getPeriodRange(at(2026, 11, 29), 31).startStr, "2026-11-28");
  assert.equal(getPeriodRange(at(2026, 11, 10), 0).startStr, "2026-11-01");
  assert.equal(getPeriodRange(at(2026, 11, 10), -5).startStr, "2026-11-01");
  assert.equal(getPeriodRange(at(2026, 11, 10), NaN).startStr, "2026-11-01");
});

test("cycles tile the calendar: every day belongs to exactly one cycle, with no gaps or overlaps", () => {
  for (const startDay of [1, 5, 15, 28]) {
    let prevEnd = null;
    for (let d = at(2026, 10, 1); d < at(2028, 4, 1); d = at(d.getFullYear(), d.getMonth() + 1, d.getDate() + 1)) {
      const p = getPeriodRange(d, startDay);
      const today = toLocalDateString(d);
      assert.ok(p.startStr <= today && today <= p.endStr, `${today} outside its own cycle (start day ${startDay})`);
      assert.ok(p.daysElapsed >= 1 && p.daysElapsed <= p.totalDays, `daysElapsed out of range on ${today}`);
      assert.ok(p.daysRemaining >= 1 && p.daysRemaining <= p.totalDays, `daysRemaining out of range on ${today}`);
      if (prevEnd && p.endStr !== prevEnd) {
        // A new cycle has started: it must begin the day after the previous one ended.
        const nextDay = new Date(Number(prevEnd.slice(0, 4)), Number(prevEnd.slice(5, 7)) - 1, Number(prevEnd.slice(8, 10)) + 1);
        assert.equal(p.startStr, toLocalDateString(nextDay), `gap or overlap before ${today} (start day ${startDay})`);
      }
      prevEnd = p.endStr;
    }
  }
});

test("string bounds include both boundary days when filtering by date", () => {
  const p = getPeriodRange(at(2026, 11, 15), 1);
  const dates = ["2026-10-31", "2026-11-01", "2026-11-30", "2026-12-01"];
  assert.deepEqual(dates.filter((d) => d >= p.startStr && d <= p.endStr), ["2026-11-01", "2026-11-30"]);
});
