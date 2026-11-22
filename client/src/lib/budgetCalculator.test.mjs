import test from "node:test";
import assert from "node:assert/strict";
import { calculateSafeToSpend, parseBudgetInput, periodFromQuery } from "./budgetCalculator.mjs";

test("safe-to-spend excludes unreceived variable income", () => {
  const result = calculateSafeToSpend({
    confirmedIncome: 100000,
    unreceivedVariableIncome: 50000,
    targetSavings: 20000,
    budgetedFixedBills: 30000,
    paidFixedBills: 10000,
    flexibleSpent: 15000,
    daysRemainingInPeriod: 5,
  });
  assert.equal(result.safeToSpend, 45000);
  assert.equal(result.remainingUnpaidFixedBills, 20000);
  assert.equal(result.dailyAllowance, 9000);
  assert.equal(result.isOverspent, false);
});

test("overspent: negative safe-to-spend, zero daily allowance", () => {
  const { values } = /** @type {any} */ (parseBudgetInput({ confirmedIncome: 1000, flexibleSpent: 3000 }));
  const result = calculateSafeToSpend(values);
  assert.equal(result.safeToSpend, -2000);
  assert.equal(result.dailyAllowance, 0);
  assert.equal(result.isOverspent, true);
});

test("budget input: defaults, numeric strings, and rejects", () => {
  assert.deepEqual(parseBudgetInput({}), {
    values: {
      confirmedIncome: 0,
      unreceivedVariableIncome: 0,
      targetSavings: 0,
      budgetedFixedBills: 0,
      paidFixedBills: 0,
      flexibleSpent: 0,
      daysRemainingInPeriod: 30,
    },
  });
  assert.equal(/** @type {any} */ (parseBudgetInput({ confirmedIncome: "500" })).values.confirmedIncome, 500);
  for (const bad of [
    { confirmedIncome: -1 },
    { confirmedIncome: "" },
    { confirmedIncome: "abc" },
    { targetSavings: Infinity },
    { daysRemainingInPeriod: 0 },
    { daysRemainingInPeriod: 2.5 },
  ])
    assert.ok(parseBudgetInput(bad).error, JSON.stringify(bad));
});

test("period from query: local date, defaults and rejects", () => {
  const p = /** @type {any} */ (periodFromQuery("3", "2026-11-08"));
  assert.equal(new Date(p.startDate).getDate(), 3);
  assert.equal(new Date(p.endDate).getDate(), 2);
  assert.equal(p.daysRemaining, 25);
  const now = new Date(2026, 10, 15, 12);
  assert.equal(new Date(/** @type {any} */ (periodFromQuery(null, null, now)).startDate).getDate(), 1);
  for (const day of ["0", "29", "2.5", "x"]) assert.ok(periodFromQuery(day, null).error, day);
  assert.equal(periodFromQuery("1", "not a date").error, "date must be a valid date.");
});
