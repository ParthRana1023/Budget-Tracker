import test from "node:test";
import assert from "node:assert/strict";
import { calculateSafeToSpend, getPeriodRange } from "../dist/services/budgetCalculator.js";

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
});

test("period days remaining matches inclusive local calendar dates", () => {
  const reference = new Date(2026, 10, 8, 12);
  const range = getPeriodRange(reference, 3);
  assert.equal(range.startDate.getDate(), 3);
  assert.equal(range.endDate.getDate(), 2);
  assert.equal(range.daysRemaining, 25);
});

test("period start day is clamped by the calculator", () => {
  const range = getPeriodRange(new Date(2026, 0, 15), 99);
  assert.equal(range.startDate.getDate(), 28);
});
