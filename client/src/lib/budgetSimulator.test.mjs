import test from "node:test";
import assert from "node:assert/strict";
import { simulateBudget, compareBudgets, buildPlanScenario } from "./budgetSimulator.mjs";

test("plan scenario: a saved plan wins, missing categories fall back to live limits", () => {
  const s = buildPlanScenario({
    plan: { expected_regular_income: 9_000_000, expected_variable_income: 500_000, planned_savings: 2_000_000, categories: [{ category_id: "shop", planned_limit: 700_000 }] },
    categories: [{ id: "shop", name: "Shopping", type: "flexible", monthly_limit: 1_000_000 }, { id: "rent", name: "Rent", type: "fixed", monthly_limit: 3_000_000 }],
    recurringItems: [{ amount: 1, type: "income" }],
    history: [],
    expectedVariableInCycle: 999,
    totalDays: 31,
  });
  assert.equal(s.source, "plan");
  assert.equal(s.regularIncome, 9_000_000);
  assert.equal(s.expectedVariableIncome, 500_000);
  assert.deepEqual(s.categories.map((c) => [c.id, c.amount]), [["shop", 700_000], ["rent", 3_000_000]]);
});

test("plan scenario without a plan: recurring salary, else latest regular income; average savings", () => {
  const base = {
    plan: null,
    categories: [{ id: "shop", name: "Shopping", type: "flexible", monthly_limit: 1_000_000 }],
    history: [
      { regularIncome: 8_000_000, savingsContributions: 1_000_000 },
      { regularIncome: 0, savingsContributions: 0 },
      { regularIncome: 8_500_000, savingsContributions: 2_000_000 },
    ],
    expectedVariableInCycle: 300_000,
    totalDays: 30,
  };
  const withSalary = buildPlanScenario({
    ...base,
    recurringItems: [
      { amount: 9_000_000, type: "income", income_type: "salary" },
      { amount: 5_000_000, type: "income", income_type: "variable" },
      { amount: 7_000_000, type: "income", income_type: "salary", active: false },
    ],
  });
  assert.equal(withSalary.source, "current");
  assert.equal(withSalary.regularIncome, 9_000_000);
  assert.equal(withSalary.plannedSavings, 1_500_000);
  assert.equal(withSalary.expectedVariableIncome, 300_000);

  assert.equal(buildPlanScenario({ ...base, recurringItems: [] }).regularIncome, 8_500_000);
});

const base = {
  regularIncome: 10_000_000, // ₹1,00,000
  plannedSavings: 2_000_000,
  totalDays: 30,
  categories: [
    { id: "rent", name: "Rent", type: "fixed", amount: 3_000_000 },
    { id: "shop", name: "Shopping", type: "flexible", amount: 1_000_000 },
    { id: "food", name: "Food", type: "flexible", amount: 1_500_000 },
  ],
};

test("scenario totals, surplus, savings rate and daily allowance", () => {
  const r = simulateBudget(base);
  assert.equal(r.fixed, 3_000_000);
  assert.equal(r.flexible, 2_500_000);
  assert.equal(r.totalSpending, 5_500_000);
  assert.equal(r.remainingAfterSpending, 4_500_000);
  assert.equal(r.projectedSurplus, 2_500_000);
  assert.equal(r.savingsRate, 20);
  // Safe-to-spend at cycle start: 1,00,000 - 20,000 - 30,000 = 50,000 over 30 days.
  assert.equal(r.dailyAllowance, Math.floor(5_000_000 / 30));
  assert.equal(r.plannedFlexiblePerDay, Math.floor(2_500_000 / 30));
});

test("reducing shopping from 10,000 to 7,000 shows the effect and the changed category", () => {
  const proposed = {
    ...base,
    categories: base.categories.map((c) => (c.id === "shop" ? { ...c, amount: 700_000 } : c)),
  };
  const cmp = compareBudgets(base, proposed);
  assert.equal(cmp.delta.totalSpending, -300_000);
  assert.equal(cmp.delta.projectedSurplus, 300_000);
  assert.equal(cmp.delta.savingsRate, 0);
  assert.deepEqual(cmp.changedCategories, [{ id: "shop", name: "Shopping", type: "flexible", from: 1_000_000, to: 700_000, diff: -300_000 }]);
  // The inputs are untouched.
  assert.equal(base.categories[1].amount, 1_000_000);
});

test("invalid or negative amounts count as zero and no income gives no savings rate", () => {
  const r = simulateBudget({ regularIncome: 0, plannedSavings: -5, totalDays: 0, categories: [{ id: "x", name: "x", type: "flexible", amount: NaN }] });
  assert.equal(r.savingsRate, null);
  assert.equal(r.plannedSavings, 0);
  assert.equal(r.flexible, 0);
  assert.equal(r.dailyAllowance, 0);
});
