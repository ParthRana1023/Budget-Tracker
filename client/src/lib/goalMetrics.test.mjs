import test from "node:test";
import assert from "node:assert/strict";
import { calculateNeededPerMonth } from "./goalMetrics.mjs";

test("a future deadline later in the current month is not past", () => {
  const result = calculateNeededPerMonth(12000, 0, "2026-11-20", new Date(2026, 10, 8, 12));
  assert.equal(result.isPastDeadline, false);
  assert.equal(result.monthsRemaining, 1);
  assert.equal(result.neededPerMonth, 12000);
});

test("a deadline earlier in the current month is past", () => {
  const result = calculateNeededPerMonth(12000, 0, "2026-11-07", new Date(2026, 10, 8, 12));
  assert.equal(result.isPastDeadline, true);
  assert.equal(result.monthsRemaining, 0);
});

test("date-only deadline parsing is stable in local timezones", () => {
  const result = calculateNeededPerMonth(24000, 0, "2026-12-01", new Date(2026, 10, 8, 12));
  assert.equal(result.isPastDeadline, false);
  assert.equal(result.monthsRemaining, 1);
});

test("invalid calendar dates are rejected", () => {
  assert.throws(() => calculateNeededPerMonth(1000, 0, "2026-02-30", new Date(2026, 1, 1)));
});
