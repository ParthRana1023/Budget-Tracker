import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGoal, simulateGoalCompletion } from "./goalAnalytics.mjs";

const ref = new Date(2026, 10, 16, 12); // 16 Nov 2026

test("completed goal", () => {
  const g = analyzeGoal({ targetAmount: 1_000, targetDate: "2027-06-01", contributions: [{ amount: 1_200, date: "2026-10-01" }], referenceDate: ref });
  assert.equal(g.status, "completed");
  assert.equal(g.remaining, 0);
  assert.equal(g.percent, 100);
  assert.equal(g.estimatedCompletion.monthsToGo, 0);
});

test("pace over the last 90 days decides on track vs behind", () => {
  // 3 x 10,000 in the last 90 days -> ~10,000/month. Needs 60,000 more by mid-May 2027 (7 months) -> ~8,572/month.
  const contributions = [
    { amount: 10_000, date: "2026-09-01" },
    { amount: 10_000, date: "2026-10-01" },
    { amount: 10_000, date: "2026-11-01" },
    { amount: 50_000, date: "2025-01-01" }, // old, outside the pace window
  ];
  const g = analyzeGoal({ targetAmount: 140_000, targetDate: "2027-05-20", contributions, referenceDate: ref });
  assert.equal(g.current, 80_000);
  assert.equal(g.remaining, 60_000);
  assert.equal(g.monthlyPace, Math.round((30_000 / 90) * (365.25 / 12)));
  assert.equal(g.status, "on_track");
  assert.equal(g.estimatedCompletion.monthsToGo, Math.ceil(60_000 / g.monthlyPace));

  const tight = analyzeGoal({ targetAmount: 140_000, targetDate: "2026-12-31", contributions, referenceDate: ref });
  assert.equal(tight.status, "behind");
});

test("a recent first contribution is not diluted over 90 days", () => {
  const g = analyzeGoal({ targetAmount: 100_000, targetDate: null, contributions: [{ amount: 9_000, date: "2026-11-10" }], referenceDate: ref });
  // window = 30 days minimum
  assert.equal(g.monthlyPace, Math.round((9_000 / 30) * (365.25 / 12)));

  // first contribution 45 calendar days ago (2 Oct -> 16 Nov inclusive = 46 days)
  const g2 = analyzeGoal({ targetAmount: 100_000, targetDate: null, contributions: [{ amount: 46_000, date: "2026-10-02" }], referenceDate: ref });
  assert.equal(g2.monthlyPace, Math.round((46_000 / 46) * (365.25 / 12)));
});

test("no contributions means no estimate and behind", () => {
  const g = analyzeGoal({ targetAmount: 100_000, targetDate: "2027-11-16", contributions: [], referenceDate: ref });
  assert.equal(g.monthlyPace, 0);
  assert.equal(g.estimatedCompletion, null);
  assert.equal(g.status, "behind");
});

test("past deadline is behind", () => {
  const g = analyzeGoal({ targetAmount: 100_000, targetDate: "2026-10-01", contributions: [{ amount: 90_000, date: "2026-11-01" }], referenceDate: ref });
  assert.equal(g.status, "behind");
  assert.equal(g.isPastDeadline, true);
});

test("simulator projects the completion month", () => {
  assert.deepEqual(
    { ...simulateGoalCompletion(25_000, 10_000, ref), completionLabel: undefined },
    { monthsToGo: 3, completionMonthKey: "2027-02", completionLabel: undefined }
  );
  assert.equal(simulateGoalCompletion(25_000, 0, ref), null);
});
