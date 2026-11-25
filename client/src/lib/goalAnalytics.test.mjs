import test from "node:test";
import assert from "node:assert/strict";
import { analyzeGoal, goalTrack, simulateGoalCompletion } from "./goalAnalytics.mjs";

const ref = new Date(2026, 10, 16, 12); // 16 Nov 2026

test("completed goal", () => {
  const g = analyzeGoal({
    targetAmount: 1_000,
    targetDate: "2027-06-01",
    contributions: [{ amount: 1_200, date: "2026-10-01" }],
    referenceDate: ref,
  });
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
  const g = analyzeGoal({
    targetAmount: 100_000,
    targetDate: null,
    contributions: [{ amount: 9_000, date: "2026-11-10" }],
    referenceDate: ref,
  });
  // window = 30 days minimum
  assert.equal(g.monthlyPace, Math.round((9_000 / 30) * (365.25 / 12)));

  // first contribution 45 calendar days ago (2 Oct -> 16 Nov inclusive = 46 days)
  const g2 = analyzeGoal({
    targetAmount: 100_000,
    targetDate: null,
    contributions: [{ amount: 46_000, date: "2026-10-02" }],
    referenceDate: ref,
  });
  assert.equal(g2.monthlyPace, Math.round((46_000 / 46) * (365.25 / 12)));
});

test("no end date: nothing needed per month, never behind, no on-track bar; pace still gives an estimate", () => {
  const idle = analyzeGoal({ targetAmount: 100_000, targetDate: null, contributions: [], referenceDate: ref });
  assert.equal(idle.hasTargetDate, false);
  assert.equal(idle.requiredMonthly, 0);
  assert.equal(idle.monthsRemaining, 0);
  assert.equal(idle.isPastDeadline, false);
  assert.equal(idle.status, "on_track");
  assert.equal(idle.estimatedCompletion, null);
  assert.equal(goalTrack(idle), null);

  const saving = analyzeGoal({
    targetAmount: 100_000,
    targetDate: null,
    contributions: [{ amount: 10_000, date: "2026-11-01" }],
    startingAmount: 20_000,
    referenceDate: ref,
  });
  assert.equal(saving.current, 30_000);
  assert.equal(saving.requiredMonthly, 0);
  assert.equal(saving.status, "on_track");
  assert.equal(saving.estimatedCompletion.monthsToGo, Math.ceil(70_000 / saving.monthlyPace));
  assert.equal(goalTrack(saving), null);

  const done = analyzeGoal({ targetAmount: 100_000, targetDate: null, contributions: [], startingAmount: 100_000, referenceDate: ref });
  assert.equal(done.status, "completed");
});

test("no contributions means no estimate and behind", () => {
  const g = analyzeGoal({ targetAmount: 100_000, targetDate: "2027-11-16", contributions: [], referenceDate: ref });
  assert.equal(g.monthlyPace, 0);
  assert.equal(g.estimatedCompletion, null);
  assert.equal(g.status, "behind");
});

test("past deadline is behind", () => {
  const g = analyzeGoal({
    targetAmount: 100_000,
    targetDate: "2026-10-01",
    contributions: [{ amount: 90_000, date: "2026-11-01" }],
    referenceDate: ref,
  });
  assert.equal(g.status, "behind");
  assert.equal(g.isPastDeadline, true);
});

test("simulator projects the completion month", () => {
  assert.deepEqual(
    { ...simulateGoalCompletion(25_000, 10_000, ref), completionLabel: undefined },
    { monthsToGo: 3, completionMonthKey: "2027-02", completionLabel: undefined },
  );
  assert.equal(simulateGoalCompletion(25_000, 0, ref), null);
});

test("goalTrack: on-track bar tag and projection", () => {
  const goal = (contributions, targetDate = "2027-05-31") =>
    analyzeGoal({ targetAmount: 100_000, targetDate, contributions, referenceDate: ref });
  const steady = goalTrack(
    goal([
      { amount: 15_000, date: "2026-09-20" },
      { amount: 15_000, date: "2026-10-20" },
      { amount: 15_000, date: "2026-11-10" },
    ]),
  );
  assert.equal(steady.tag, "on_track");
  assert.equal(steady.projected, 100_000, "projection is capped at the target");
  const slow = goalTrack(
    goal([
      { amount: 3_000, date: "2026-09-01" },
      { amount: 3_000, date: "2026-10-01" },
      { amount: 3_000, date: "2026-11-01" },
    ]),
  );
  assert.equal(slow.tag, "late");
  assert.ok(slow.monthsLate >= 1);
  assert.ok(slow.projected < 100_000);
  assert.equal(goalTrack(goal([])).tag, "nothing_yet");
  assert.equal(goalTrack(goal([{ amount: 100_000, date: "2026-11-01" }])), null, "finished goal: no bar");
  assert.equal(goalTrack(goal([], null)), null, "no target date: no bar");
});

test("an opening balance counts towards progress but not the pace", () => {
  const g = analyzeGoal({
    targetAmount: 100_000,
    targetDate: "2027-05-31",
    contributions: [],
    startingAmount: 40_000,
    referenceDate: ref,
  });
  assert.equal(g.current, 40_000);
  assert.equal(g.remaining, 60_000);
  assert.equal(g.monthlyPace, 0);
});
