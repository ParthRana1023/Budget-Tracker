import test from "node:test";
import assert from "node:assert/strict";
import { calculateSafeToSpend, computeCycleBudgetInputs } from "./safeToSpend.mjs";

test("safe to spend subtracts savings, unpaid fixed bills and flexible spend", () => {
  const r = calculateSafeToSpend({
    confirmedIncome: 10_000_000,
    targetSavings: 2_000_000,
    budgetedFixedBills: 3_000_000,
    paidFixedBills: 1_000_000,
    flexibleSpent: 500_000,
    daysRemaining: 10,
  });
  assert.equal(r.remainingFixedBills, 2_000_000);
  assert.equal(r.safeToSpend, 5_500_000);
  assert.equal(r.dailyAllowance, 550_000);
  assert.equal(r.isOverspent, false);
});

test("overpaid fixed bills never add money back", () => {
  const r = calculateSafeToSpend({
    confirmedIncome: 1_000, targetSavings: 0, budgetedFixedBills: 500, paidFixedBills: 900, flexibleSpent: 0, daysRemaining: 1,
  });
  assert.equal(r.remainingFixedBills, 0);
  assert.equal(r.safeToSpend, 1_000);
});

test("overspent cycle has zero daily allowance", () => {
  const r = calculateSafeToSpend({
    confirmedIncome: 1_000, targetSavings: 800, budgetedFixedBills: 0, paidFixedBills: 0, flexibleSpent: 500, daysRemaining: 0,
  });
  assert.equal(r.safeToSpend, -300);
  assert.equal(r.dailyAllowance, 0);
  assert.equal(r.isOverspent, true);
});

test("cycle inputs only count rows inside the cycle and keep expected variable pay out of income", () => {
  const inputs = computeCycleBudgetInputs({
    startStr: "2026-11-01",
    endStr: "2026-11-30",
    incomeSources: [
      { type: "salary", status: "received", amount: 100, received_date: "2026-11-01" },
      { type: "salary", status: "received", amount: 999, received_date: "2026-10-31" },
      { type: "variable", status: "expected", amount: 50, expected_date: "2026-11-20" },
      { type: "variable", status: "expected", amount: 70, expected_date: "2026-12-01" },
    ],
    contributions: [{ amount: 10, date: "2026-11-05" }, { amount: 40, date: "2026-12-01" }, { amount: 5, date: null }],
    categories: [{ type: "fixed", monthly_limit: 30 }, { type: "fixed", monthly_limit: 20 }, { type: "flexible", monthly_limit: 500 }],
    cycleTransactions: [
      { type: "expense", amount: 15, category: { type: "fixed" } },
      { type: "expense", amount: 7, category: { type: "flexible" } },
      { type: "expense", amount: 3, category: null },
      { type: "savings_transfer", amount: 10, category: null },
    ],
  });
  assert.deepEqual(inputs.expectedVariableSources.map((i) => i.amount), [50]);
  const { expectedVariableSources, ...totals } = inputs;
  assert.deepEqual(totals, {
    confirmedIncome: 100,
    unreceivedVariable: 50,
    budgetedFixedBills: 50,
    paidFixedBills: 15,
    flexibleSpent: 7,
    targetSavings: 10,
  });
});
