import test from "node:test";
import assert from "node:assert/strict";
import { categoryDiff, draftProblems } from "./categoryDiff.mjs";

const cat = (id, name, type, monthly_limit, due_day = null, is_active = true) => ({
  id,
  name,
  type,
  monthly_limit,
  due_day,
  is_active,
});
const before = [
  cat("a", "Groceries", "flexible", 1000000),
  cat("b", "Rent", "fixed", 2800000, 3),
  cat("c", "Fuel", "flexible", 0),
];

test("no change, no writes", () => {
  assert.deepEqual(categoryDiff(before, structuredClone(before)), { updates: [], inserts: [] });
});

test("rename, new limit, move to fixed with a due day, switch off, add", () => {
  const after = [
    cat("a", " Food ", "flexible", 1200000),
    cat("b", "Rent", "fixed", 2800000, 3, false),
    cat("c", "Fuel", "fixed", 400000, 10),
    cat("new-1", "Gym", "flexible", 0),
  ];
  const d = categoryDiff(before, after);
  assert.deepEqual(d.updates, [
    { id: "a", patch: { name: "Food", monthly_limit: 1200000 } },
    { id: "b", patch: { is_active: false } },
    { id: "c", patch: { type: "fixed", monthly_limit: 400000, due_day: 10 } },
  ]);
  assert.deepEqual(d.inserts, [
    {
      name: "Gym",
      type: "flexible",
      monthly_limit: 0,
      due_day: null,
      is_active: true,
      original_amount: null,
      original_currency: null,
      fx_rate: null,
      fx_date: null,
    },
  ]);
});

test("a limit set in another currency writes its original amount and rate; back to base clears them", () => {
  const usd = { original_amount: 1500, original_currency: "USD", fx_rate: 92.68, fx_date: "2026-11-01" };
  const after = [{ ...before[1], type: "fixed", monthly_limit: 139020, ...usd }, before[0], before[2]];
  assert.deepEqual(categoryDiff(before, after).updates, [{ id: "b", patch: { monthly_limit: 139020, ...usd } }]);
  assert.deepEqual(categoryDiff(after, before).updates, [
    {
      id: "b",
      patch: { monthly_limit: 2800000, original_amount: null, original_currency: null, fx_rate: null, fx_date: null },
    },
  ]);
});

test("undo is the same diff the other way", () => {
  const after = [cat("a", "Food", "flexible", 1000000), before[1], before[2]];
  assert.deepEqual(categoryDiff(after, before).updates, [{ id: "a", patch: { name: "Groceries" } }]);
});

test("moving to flexible drops the due day; a new row that was removed again writes nothing", () => {
  const after = [
    before[0],
    cat("b", "Rent", "flexible", 2800000, 3),
    before[2],
    cat("new-2", "Tmp", "flexible", 0, null, false),
  ];
  assert.deepEqual(categoryDiff(before, after), {
    updates: [{ id: "b", patch: { type: "flexible", due_day: null } }],
    inserts: [],
  });
});

test("the draft is checked before it can close", () => {
  assert.deepEqual(draftProblems(before), []);
  assert.deepEqual(draftProblems([...before, cat("d", "rent ", "flexible", 0)]), [
    "There are two categories called rent.",
  ]);
  assert.deepEqual(draftProblems([cat("e", "Phone", "fixed", 0)]), ["Phone needs a monthly amount above ₹0.00."]);
  assert.deepEqual(draftProblems([cat("f", " ", "flexible", 0)]), ["Every category needs a name."]);
  assert.deepEqual(draftProblems([cat("g", "Old", "fixed", 0, null, false)]), [], "switched-off rows are not checked");
});
