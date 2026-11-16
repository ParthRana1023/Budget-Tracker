import test from "node:test";
import assert from "node:assert/strict";
import { computeSpendingPace } from "./spendingPace.mjs";
import { getPeriodRange } from "./periods.mjs";

const flex = (date, amount) => ({ type: "expense", amount, date, category: { type: "flexible" } });

// Cycle 1-30 Nov 2026, today = 10 Nov (day 10 of 30). Budget 30,000 -> 1,000/day planned.
const period = getPeriodRange(new Date(2026, 10, 10, 12), 1);

test("cumulative series uses actual dates and only counts flexible expenses", () => {
  const pace = computeSpendingPace({
    flexibleBudget: 30_000,
    period,
    cycleTransactions: [
      flex("2026-11-01", 500),
      flex("2026-11-03", 1_500),
      { type: "expense", amount: 9_999, date: "2026-11-02", category: { type: "fixed" } },
      { type: "savings_transfer", amount: 7_777, date: "2026-11-02", category: null },
    ],
  });
  assert.equal(pace.points.length, 30);
  assert.equal(pace.points[0].date, "2026-11-01");
  assert.equal(pace.points[29].date, "2026-11-30");
  assert.equal(pace.points[0].actual, 500);
  assert.equal(pace.points[1].actual, 500);
  assert.equal(pace.points[2].actual, 2_000);
  assert.equal(pace.points[9].actual, 2_000); // today
  assert.equal(pace.points[10].actual, null); // future
  assert.equal(pace.points[29].expected, 30_000);
  assert.equal(pace.flexibleSpent, 2_000);
  assert.equal(pace.status, "on_track");
});

test("projection starts at today's actual and ends at the burn-rate projection", () => {
  const pace = computeSpendingPace({ flexibleBudget: 30_000, period, cycleTransactions: [flex("2026-11-05", 20_000)] });
  assert.equal(pace.points[8].projected, null);
  assert.equal(pace.points[9].projected, 20_000);
  assert.equal(pace.points[29].projected, pace.burnRate.projectedEndOfMonth);
  assert.equal(pace.projectedEnd, 60_000);
  assert.equal(pace.projectedOverspend, 30_000);
  assert.equal(pace.status, "at_risk");
});

test("status distinguishes faster, exceeded and no budget", () => {
  // 10,500 spent vs 10,000 planned by day 10 -> 5% ahead.
  const faster = computeSpendingPace({ flexibleBudget: 30_000, period, cycleTransactions: [flex("2026-11-02", 10_500)] });
  assert.equal(faster.status, "faster");

  const exceeded = computeSpendingPace({ flexibleBudget: 1_000, period, cycleTransactions: [flex("2026-11-02", 1_200)] });
  assert.equal(exceeded.status, "exceeded");

  const none = computeSpendingPace({ flexibleBudget: 0, period, cycleTransactions: [flex("2026-11-02", 1_200)] });
  assert.equal(none.status, "no_budget");
});

test("a cycle that spans two months walks calendar days locally", () => {
  const split = getPeriodRange(new Date(2026, 10, 20, 12), 15); // 15 Nov - 14 Dec
  const pace = computeSpendingPace({ flexibleBudget: 30_000, period: split, cycleTransactions: [] });
  assert.equal(pace.points[0].date, "2026-11-15");
  assert.equal(pace.points[16].date, "2026-12-01");
  assert.equal(pace.points.at(-1).date, "2026-12-14");
});
