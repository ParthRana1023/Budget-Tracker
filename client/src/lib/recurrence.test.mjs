import assert from "node:assert/strict";
import test from "node:test";
import { isRecurringItemDue, recurringExternalId, rupeesToPaise, validateRecurringForm } from "./recurrence.mjs";

test("marks an active item due once its scheduled day arrives without a matching posting", () => {
  assert.equal(isRecurringItemDue({ active: true, day_of_month: 5, id: "rent" }, [], new Date("2026-11-05T12:00:00")), true);
  assert.equal(isRecurringItemDue({ active: true, day_of_month: 5, id: "rent" }, [{ external_id: "recurring:rent:2026-11" }], new Date("2026-11-05T12:00:00")), false);
});

test("not due before its day, when paused, or once posted this month; due again next month", () => {
  const item = { active: true, day_of_month: 10, id: "x" };
  assert.equal(isRecurringItemDue(item, [], new Date(2026, 10, 9, 23, 59)), false);
  assert.equal(isRecurringItemDue(item, [], new Date(2026, 10, 10, 0, 0)), true);
  assert.equal(isRecurringItemDue({ ...item, active: false }, [], new Date(2026, 10, 20)), false);
  const posted = [{ external_id: "recurring:x:2026-11" }];
  assert.equal(isRecurringItemDue(item, posted, new Date(2026, 10, 30)), false);
  assert.equal(isRecurringItemDue(item, posted, new Date(2026, 11, 10)), true);
});

test("posting key uses the LOCAL month (1st of the month shortly after midnight)", () => {
  // 1 Nov 00:30 local. A UTC-derived key would say 2026-10 in IST.
  assert.equal(recurringExternalId("x", new Date(2026, 10, 1, 0, 30)), "recurring:x:2026-11");
  assert.equal(isRecurringItemDue({ active: true, day_of_month: 1, id: "x" }, [{ external_id: "recurring:x:2026-10" }], new Date(2026, 10, 1, 0, 30)), true);
});

test("rupeesToPaise parses exact amounts and rejects junk", () => {
  assert.equal(rupeesToPaise("999"), 99900);
  assert.equal(rupeesToPaise("999.5"), 99950);
  assert.equal(rupeesToPaise("1.15"), 115);
  assert.equal(rupeesToPaise("0.07"), 7);
  assert.equal(rupeesToPaise(" 12 "), 1200);
  for (const bad of ["", "0", "0.00", "-5", "abc", "1.234", "1e3", "1,000", null, undefined]) assert.equal(rupeesToPaise(bad), null, `should reject ${JSON.stringify(bad)}`);
});

test("validateRecurringForm: expense requires a category, income ignores it", () => {
  assert.deepEqual(validateRecurringForm({ name: " Rent ", amount: "25000", day: "1", type: "expense", categoryId: "c1" }), {
    value: { name: "Rent", amount: 2500000, type: "expense", day_of_month: 1, category_id: "c1" },
  });
  assert.match(validateRecurringForm({ name: "Rent", amount: "25000", day: "1", type: "expense", categoryId: "" }).error, /category/i);
  assert.deepEqual(validateRecurringForm({ name: "Salary", amount: "80000", day: "28", type: "income", categoryId: "stale-selection" }), {
    value: { name: "Salary", amount: 8000000, type: "income", day_of_month: 28, category_id: null },
  });
});

test("validateRecurringForm rejects bad name, amount, day and type", () => {
  const ok = { name: "A", amount: "10", day: "5", type: "expense", categoryId: "c" };
  assert.ok(validateRecurringForm({ ...ok, name: "  " }).error);
  assert.ok(validateRecurringForm({ ...ok, amount: "0" }).error);
  assert.ok(validateRecurringForm({ ...ok, day: "0" }).error);
  assert.ok(validateRecurringForm({ ...ok, day: "29" }).error);
  assert.ok(validateRecurringForm({ ...ok, day: "1.5" }).error);
  assert.ok(validateRecurringForm({ ...ok, type: "transfer" }).error);
});
