import test from "node:test";
import assert from "node:assert/strict";
import { computeForecast } from "./forecast.mjs";

const ref = new Date(2026, 10, 16, 12); // in cycle 1-30 Nov
const categories = [
  { id: "rent", type: "fixed", monthly_limit: 2_000_000 },
  { id: "food", type: "flexible", monthly_limit: 1_000_000 },
];
const month = (reg, fixed, flex, sav) => ({ regularIncome: reg, fixedExpenses: fixed, flexibleExpenses: flex, savingsContributions: sav });

test("no income basis means no forecast", () => {
  const f = computeForecast({ cycles: 3, referenceDate: ref, monthStartDay: 1, categories, recurringItems: [], incomeSources: [], history: [month(5, 0, 0, 0)] });
  assert.equal(f, null);
});

test("recurring salary is planned income; limits and recurring bills are planned expenses", () => {
  const f = computeForecast({
    cycles: 3,
    referenceDate: ref,
    monthStartDay: 1,
    categories,
    recurringItems: [
      { amount: 8_000_000, type: "income", category_id: null, income_type: "salary" },
      { amount: 9_999_999, type: "income", category_id: null, income_type: "variable" },
      { amount: 2_500_000, type: "expense", category_id: "rent" }, // above the 20,000 limit
      { amount: 100_000, type: "expense", category_id: null },
      { amount: 7_777_777, type: "expense", category_id: "rent", active: false },
    ],
    incomeSources: [{ type: "variable", status: "expected", amount: 5_000_000, expected_date: "2026-12-20" }],
    history: [],
  });
  assert.equal(f.length, 3);
  assert.deepEqual(f.map((c) => c.cycleStart), ["2026-12-01", "2027-01-01", "2027-02-01"]);
  const dec = f[0];
  assert.deepEqual(dec.income, { amount: 8_000_000, kind: "planned", source: "Recurring income" });
  assert.equal(dec.fixed.amount, 2_600_000);
  assert.equal(dec.flexible.amount, 1_000_000);
  assert.deepEqual(dec.savings, { amount: 0, kind: "planned", source: "No savings planned" });
  assert.equal(dec.surplus.amount, 8_000_000 - 2_600_000 - 1_000_000);
  assert.equal(dec.surplus.kind, "planned");
  // Expected bonus is reported but never counted as income.
  assert.equal(dec.unconfirmedVariable, 5_000_000);
  assert.equal(f[1].unconfirmedVariable, 0);
});

test("history fills gaps as estimated, and needs at least two months", () => {
  const noLimits = categories.map((c) => ({ ...c, monthly_limit: 0 }));
  const f = computeForecast({
    cycles: 1, referenceDate: ref, monthStartDay: 1, categories: noLimits, recurringItems: [], incomeSources: [],
    history: [month(6_000_000, 2_000_000, 1_000_000, 500_000), month(4_000_000, 2_000_000, 3_000_000, 0)],
  });
  assert.deepEqual(f[0].income, { amount: 5_000_000, kind: "estimated", source: "Average of recent months" });
  assert.equal(f[0].flexible.amount, 2_000_000);
  assert.equal(f[0].flexible.kind, "estimated");
  assert.equal(f[0].savings.amount, 0); // only one non-zero savings month -> not enough to estimate
  assert.equal(f[0].surplus.kind, "estimated");
});

test("a budget plan for a cycle overrides limits, income and savings", () => {
  const f = computeForecast({
    cycles: 2, referenceDate: ref, monthStartDay: 1, categories, recurringItems: [], incomeSources: [], history: [],
    plans: [{
      cycle_start: "2026-12-01", expected_regular_income: 9_000_000, expected_variable_income: 1_000_000, planned_savings: 2_000_000,
      categories: [{ category_id: "food", planned_limit: 700_000 }],
    }],
  });
  // January has no plan and nothing else to base income on, so the forecast stops after December.
  assert.equal(f.length, 1);
  const one = f;
  assert.equal(one[0].income.source, "Budget plan");
  assert.equal(one[0].flexible.amount, 700_000);
  assert.equal(one[0].fixed.amount, 2_000_000);
  assert.equal(one[0].savings.amount, 2_000_000);
  assert.equal(one[0].unconfirmedVariable, 1_000_000);
});

test("cycles follow the month start day", () => {
  const f = computeForecast({
    cycles: 2, referenceDate: ref, monthStartDay: 25, categories, incomeSources: [], history: [],
    recurringItems: [{ amount: 1, type: "income", category_id: null, income_type: "salary" }],
  });
  // 16 Nov is in 25 Oct - 24 Nov; next cycles start 25 Nov and 25 Dec.
  assert.deepEqual(f.map((c) => [c.cycleStart, c.cycleEnd]), [["2026-11-25", "2026-12-24"], ["2026-12-25", "2027-01-24"]]);
});
