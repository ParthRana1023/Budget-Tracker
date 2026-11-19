import assert from "node:assert/strict";
import test from "node:test";
import {
  cycleFor,
  getPeriodRange,
  msUntilNextLocalMidnight,
  paySchedule,
  toLocalDateString,
  toLocalMonthKey,
} from "./periods.mjs";

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

test("start days 29-30, below 1 or invalid are clamped into 1-28; 31 is the last day", () => {
  assert.equal(getPeriodRange(at(2026, 11, 29), 30).startStr, "2026-11-28");
  assert.equal(getPeriodRange(at(2026, 11, 29), 31).startStr, "2026-10-31", "pay day 31 = last day of the month");
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
        const nextDay = new Date(
          Number(prevEnd.slice(0, 4)),
          Number(prevEnd.slice(5, 7)) - 1,
          Number(prevEnd.slice(8, 10)) + 1,
        );
        assert.equal(p.startStr, toLocalDateString(nextDay), `gap or overlap before ${today} (start day ${startDay})`);
      }
      prevEnd = p.endStr;
    }
  }
});

test("string bounds include both boundary days when filtering by date", () => {
  const p = getPeriodRange(at(2026, 11, 15), 1);
  const dates = ["2026-10-31", "2026-11-01", "2026-11-30", "2026-12-01"];
  assert.deepEqual(
    dates.filter((d) => d >= p.startStr && d <= p.endStr),
    ["2026-11-01", "2026-11-30"],
  );
});

test("msUntilNextLocalMidnight counts to the end of the LOCAL day", () => {
  assert.equal(msUntilNextLocalMidnight(at(2026, 11, 7, 23, 59, 30)), 30_000);
  assert.equal(msUntilNextLocalMidnight(at(2026, 11, 7, 12, 0, 0)), 12 * 3_600_000);
  // A full day when it is exactly midnight; 23h/25h on DST-change days in zones that have them.
  const day = new Date(2026, 10, 2).getTime() - new Date(2026, 10, 1).getTime();
  assert.equal(msUntilNextLocalMidnight(at(2026, 11, 1, 0, 0, 0)), day);
  assert.ok(day >= 23 * 3_600_000 && day <= 25 * 3_600_000);
  // Month and year roll-over.
  assert.equal(msUntilNextLocalMidnight(at(2026, 12, 31, 23, 0, 0)), 3_600_000);
  assert.equal(
    toLocalDateString(
      new Date(at(2026, 12, 31, 23, 0, 0).getTime() + msUntilNextLocalMidnight(at(2026, 12, 31, 23, 0, 0))),
    ),
    "2027-01-01",
  );
});

// ---------------------------------------------------------------- pay-day schedules
const span = (sched, y, m, d) => {
  const p = cycleFor(at(y, m, d), sched);
  return `${p.startStr}..${p.endStr}`;
};

test("pay day 31 is the last day of every month, leap years included", () => {
  const last = [{ payDay: 31 }];
  assert.equal(span(last, 2026, 11, 30), "2026-11-30..2026-12-30");
  assert.equal(span(last, 2027, 2, 27), "2027-01-31..2027-02-27");
  assert.equal(span(last, 2027, 2, 28), "2027-02-28..2027-03-30");
  assert.equal(span(last, 2028, 2, 28), "2028-01-31..2028-02-28");
  assert.equal(span(last, 2028, 2, 29), "2028-02-29..2028-03-30");
});

test("a pay-day change starts at its effective date; the transition cycle is at least 15 days", () => {
  // 25th -> last day, effective 25 Dec: 31 Dec is only 6 days later, so the next cycle starts 31 Jan.
  const a = [{ payDay: 25 }, { payDay: 31, from: "2026-12-25" }];
  assert.equal(span(a, 2026, 12, 24), "2026-11-25..2026-12-24", "cycles before the change keep their dates");
  assert.equal(span(a, 2026, 12, 25), "2026-12-25..2027-01-30");
  assert.equal(span(a, 2027, 1, 30), "2026-12-25..2027-01-30");
  assert.equal(span(a, 2027, 1, 31), "2027-01-31..2027-02-27");
  // 1st -> 15th, effective 1 Jan: 15 Jan is 14 days later, so the transition runs to 14 Feb.
  const b = [{ payDay: 1 }, { payDay: 15, from: "2027-01-01" }];
  assert.equal(span(b, 2027, 1, 10), "2027-01-01..2027-02-14");
  assert.equal(span(b, 2027, 2, 15), "2027-02-15..2027-03-14");
  // 1st -> 20th: 20 Jan is 19 days later, so it starts a cycle (two cycles start in January).
  const c = [{ payDay: 1 }, { payDay: 20, from: "2027-01-01" }];
  assert.equal(span(c, 2027, 1, 5), "2027-01-01..2027-01-19");
  assert.equal(span(c, 2027, 1, 20), "2027-01-20..2027-02-19");
});

test("a later change cuts the running cycle at its effective date", () => {
  const s = [{ payDay: 10 }, { payDay: 20, from: "2027-03-10" }];
  assert.equal(span(s, 2027, 3, 1), "2027-02-10..2027-03-09");
  assert.equal(span(s, 2027, 3, 10), "2027-03-10..2027-04-19");
});

test("cycles tile the calendar across pay-day changes: no gaps, no overlaps, 15+ days each", () => {
  const schedules = [
    [{ payDay: 25 }, { payDay: 31, from: "2026-12-25" }, { payDay: 5, from: "2027-05-31" }],
    [{ payDay: 1 }, { payDay: 15, from: "2027-01-01" }],
    [{ payDay: 28 }, { payDay: 1, from: "2027-02-28" }],
  ];
  for (const sched of schedules) {
    let p = cycleFor(at(2026, 10, 1), sched);
    for (let i = 0; i < 18; i++) {
      const [y, m, d] = p.endStr.split("-").map(Number);
      const next = cycleFor(at(y, m, d + 1), sched);
      assert.equal(next.startStr, toLocalDateString(at(y, m, d + 1)), `no gap after ${p.endStr}`);
      assert.ok(next.totalDays >= 15, `${next.startStr} lasts ${next.totalDays} days`);
      assert.equal(cycleFor(at(y, m, d), sched).startStr, p.startStr, "last day still in its own cycle");
      p = next;
    }
  }
});

test("paySchedule: onboarding pay day plus changes", () => {
  assert.deepEqual(paySchedule(null), [{ payDay: 1 }]);
  assert.deepEqual(
    paySchedule({ month_start_day: 25, pay_day_changes: [{ pay_day: 31, effective_from: "2026-12-25" }] }),
    [{ payDay: 25 }, { payDay: 31, from: "2026-12-25" }],
  );
});
