import test from "node:test";
import assert from "node:assert/strict";
import { generateInsights } from "./insights.mjs";

const period = { daysElapsed: 20, totalDays: 30, daysRemaining: 11 };
const calmPace = {
  status: "on_track", flexibleSpent: 0, flexibleBudget: 0, projectedEnd: 0, projectedOverspend: 0,
  burnRate: { actualDailyRate: 0, expectedDailyRate: 0 },
};
const cat = (id, limit, spent) => {
  const percentUsed = limit > 0 ? (spent / limit) * 100 : 0;
  const status = limit <= 0 ? "safe" : percentUsed >= 100 ? "exceeded" : percentUsed >= 90 ? "danger" : percentUsed >= 75 ? "warning" : "safe";
  return { id, name: id, type: "flexible", monthlyLimit: limit, spent, remaining: limit - spent, percentUsed, hasLimit: limit > 0, status };
};
const month = (label, reg, flex, sav) => ({
  monthLabel: label, regularIncome: reg, flexibleExpenses: flex, savingsContributions: sav, baselineSavingsRate: reg > 0 ? (sav / reg) * 100 : 0,
});
const ids = (list) => list.map((i) => i.id);

test("no data, no insights", () => {
  assert.deepEqual(generateInsights({ categoryBudgets: [], period, pace: calmPace, completedMonths: [] }), []);
});

test("category near limit only when ahead of the cycle; over budget always", () => {
  const list = generateInsights({
    categoryBudgets: [
      cat("Shopping", 1_000_000, 820_000), // 82% used, 67% of cycle passed -> warn
      cat("Food", 1_000_000, 600_000), // 60% -> nothing
      cat("Fuel", 100_000, 130_000), // exceeded
      cat("Misc", 0, 999_999), // no limit -> never
    ],
    period,
    pace: calmPace,
    completedMonths: [],
  });
  assert.deepEqual(ids(list), ["cat-over-Fuel", "cat-near-Shopping"]);
  assert.equal(list[1].message, "You have used 82% of your Shopping budget with 11 days remaining.");
  assert.match(list[1].action, /₹163 a day/); // 1,800 rupees left / 11 days

  const lateCycle = generateInsights({ categoryBudgets: [cat("Shopping", 1_000_000, 820_000)], period: { daysElapsed: 28, totalDays: 30, daysRemaining: 3 }, pace: calmPace, completedMonths: [] });
  assert.deepEqual(lateCycle, []); // 82% used with 93% of the cycle gone is on pace
});

test("projected overspend needs a few days of data", () => {
  const atRisk = { ...calmPace, status: "at_risk", flexibleSpent: 2_000_000, flexibleBudget: 3_000_000, projectedEnd: 3_350_000, projectedOverspend: 350_000, burnRate: { actualDailyRate: 100_000, expectedDailyRate: 100_000 } };
  const list = generateInsights({ categoryBudgets: [], period, pace: atRisk, completedMonths: [] });
  assert.equal(list[0].message, "Your current spending pace projects an overspend of ₹3,500.");
  assert.deepEqual(generateInsights({ categoryBudgets: [], period: { ...period, daysElapsed: 2 }, pace: atRisk, completedMonths: [] }), []);
});

test("month-over-month flexible change and savings-rate trend", () => {
  const list = generateInsights({
    categoryBudgets: [],
    period,
    pace: calmPace,
    completedMonths: [month("Aug", 100_000, 10_000, 20_000), month("Sep", 100_000, 10_000, 25_000), month("Oct", 100_000, 11_200, 30_000)],
  });
  assert.deepEqual(ids(list), ["flex-change", "rate-up"]);
  assert.equal(list[0].message, "Your flexible spending increased by 12% in Oct compared with Sep.");
  assert.equal(list[1].why, "Savings as a share of regular income: 20% → 25% → 30%.");
});

test("low savings rate suggests trimming flexible spending, with the reason", () => {
  const list = generateInsights({
    categoryBudgets: [],
    period,
    pace: calmPace,
    completedMonths: [month("Sep", 10_000_000, 3_000_000, 1_000_000), month("Oct", 10_000_000, 3_000_000, 1_000_000)],
  });
  assert.deepEqual(ids(list), ["trim-flexible"]);
  assert.equal(list[0].message, "Reducing flexible spending by 10% could add about ₹3,000 a month to your savings.");
  assert.match(list[0].why, /saved 10% of regular income/);
});
