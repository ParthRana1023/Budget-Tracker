import test from "node:test";
import assert from "node:assert/strict";
import { recurringDiff, recurringProblems } from "./recurringDiff.mjs";

const rent = { id: "a", name: "Rent", amount: 2800000, day_of_month: 3, active: true, type: "expense" };
const net = { id: "b", name: "Internet", amount: 120000, day_of_month: 5, active: true, type: "expense" };

test("draft to writes, and Undo is the same diff backwards", () => {
  const gym = { id: "c", name: " Gym ", amount: 150000, day_of_month: null, active: true, type: "expense" };
  const after = [{ ...rent, amount: 3000000, active: false }, gym];
  assert.deepEqual(recurringDiff([rent, net], after), {
    updates: [{ id: "a", patch: { amount: 3000000, active: false } }],
    inserts: [{ ...gym, name: "Gym" }],
    deletes: ["b"],
  });
  assert.deepEqual(recurringDiff(after, [rent, net]), {
    updates: [{ id: "a", patch: { amount: 2800000, active: true } }],
    inserts: [net],
    deletes: ["c"],
  });
  assert.deepEqual(recurringDiff([rent], [rent]), { updates: [], inserts: [], deletes: [] });
});

test("every item needs a name and an amount", () => {
  assert.deepEqual(recurringProblems([rent, net]), []);
  assert.deepEqual(
    recurringProblems([
      { ...rent, name: " " },
      { ...net, amount: 0 },
    ]),
    ["Every recurring item needs a name.", "Internet needs an amount above ₹0."],
  );
});
