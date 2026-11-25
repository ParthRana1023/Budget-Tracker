import test from "node:test";
import assert from "node:assert/strict";
import { clampDay, monthsToGoal, onboardingPayload } from "./onboarding.mjs";

const base = { salary: "", payDay: "", pct: 30, bills: [], cats: [] };

test("every step skipped still gives a valid payload", () => {
  assert.deepEqual(onboardingPayload(base), {
    p_take_home_pay: null,
    p_pay_day: 1,
    p_savings_pct: 30,
    p_bills: [],
    p_categories: [],
  });
});

test("rupees become paise; blank limits stay empty; bills without an amount are dropped", () => {
  const p = onboardingPayload({
    salary: "95000",
    payDay: "25",
    pct: 20,
    bills: [
      { name: "Rent", amt: "28000", due: "3" },
      { name: "Electricity", amt: "", due: "" },
      { name: " Internet ", amt: "1200", due: "" },
    ],
    cats: [
      { name: "Groceries", limit: "10000", on: true },
      { name: "Fuel", limit: "", on: true },
      { name: "Travel", limit: "5000", on: false },
    ],
  });
  assert.equal(p.p_take_home_pay, 9500000);
  assert.equal(p.p_pay_day, 25);
  assert.deepEqual(p.p_bills, [
    { name: "Rent", amount: 2800000, due_day: 3 },
    { name: "Internet", amount: 120000, due_day: null },
  ]);
  assert.deepEqual(p.p_categories, [
    { name: "Groceries", limit: 1000000 },
    { name: "Fuel", limit: null },
  ]);
});

test("names never collide, so the save can't be rejected", () => {
  const p = onboardingPayload({
    ...base,
    bills: [
      { name: "", amt: "100", due: "" },
      { name: "  ", amt: "200", due: "" },
      { name: "health", amt: "300", due: "" },
    ],
    cats: [{ name: "Health", limit: "", on: true }],
  });
  assert.deepEqual(
    p.p_bills.map((b) => b.name),
    ["Bill", "Bill 2", "health 2"],
  );
});

test("payday: 1-28, or 31 for the last day of the month", () => {
  assert.equal(onboardingPayload({ ...base, payDay: "31" }).p_pay_day, 31);
  assert.equal(onboardingPayload({ ...base, payDay: "25" }).p_pay_day, 25);
  assert.equal(onboardingPayload({ ...base, payDay: "" }).p_pay_day, 1);
});

test("day inputs clamp to 1-28", () => {
  assert.equal(clampDay("31"), "28");
  assert.equal(clampDay("0"), "1");
  assert.equal(clampDay("07"), "7");
  assert.equal(clampDay("a"), "");
});

test("first goal: sent only when named with a target; rupees become paise; month becomes its 1st", () => {
  assert.equal("p_goal" in onboardingPayload(base), false, "step skipped");
  assert.equal("p_goal" in onboardingPayload({ ...base, goal: { name: "  ", target: "5000", by: "" } }), false);
  assert.equal("p_goal" in onboardingPayload({ ...base, goal: { name: "Trip", target: "", by: "" } }), false);
  assert.deepEqual(onboardingPayload({ ...base, goal: { name: " Emergency fund ", target: "300000", by: "" } }).p_goal, {
    name: "Emergency fund",
    target: 30000000,
    target_date: null,
  });
  assert.deepEqual(onboardingPayload({ ...base, goal: { name: "Trip", target: "60000.5", by: "2027-06" } }).p_goal, {
    name: "Trip",
    target: 6000050,
    target_date: "2027-06-01",
  });
});

test("months to a goal at the chosen save %", () => {
  assert.equal(monthsToGoal(68000, 85000, 20), 4, "₹17,000 a cycle: 4 cycles for ₹68,000");
  assert.equal(monthsToGoal(68001, 85000, 20), 5, "a part month counts as a month");
  assert.equal(monthsToGoal(68000, 85000, 0), null, "nothing saved: no estimate");
  assert.equal(monthsToGoal(68000, 0, 20), null, "no salary yet");
  assert.equal(monthsToGoal(0, 85000, 20), null, "no target");
});
