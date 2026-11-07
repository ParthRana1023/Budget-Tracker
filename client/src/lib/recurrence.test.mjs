import assert from "node:assert/strict";
import test from "node:test";
import { formatShortDate, mergeAutoRecorded, parseOptionalDay, recurringKey, scheduleLabel, suggestRecurring } from "./recurrence.mjs";

test("recurringKey matches the SQL key: recurring:<id>:<YYYY-MM>", () => {
  assert.equal(recurringKey("abc", "2026-11-03"), "recurring:abc:2026-11");
  assert.equal(recurringKey("abc", "2026-12-31"), "recurring:abc:2026-12");
});

test("parseOptionalDay: blank means suggestion-only, otherwise 1-28", () => {
  assert.deepEqual(parseOptionalDay(""), { value: null });
  assert.deepEqual(parseOptionalDay("   "), { value: null });
  assert.deepEqual(parseOptionalDay(undefined), { value: null });
  assert.deepEqual(parseOptionalDay("1"), { value: 1 });
  assert.deepEqual(parseOptionalDay(" 28 "), { value: 28 });
  for (const bad of ["0", "29", "31", "-1", "1.5", "abc", "1e1", "100"]) {
    assert.ok(parseOptionalDay(bad).error, `should reject ${JSON.stringify(bad)}`);
  }
});

const item = (id, name, type, day, extra = {}) => ({ id, name, type, day_of_month: day, active: true, ...extra });

test("suggestRecurring: only the requested type, paused items hidden", () => {
  const items = [item("1", "Rent", "expense", 5), item("2", "Salary", "income", 1), item("3", "Old", "expense", 2, { active: false })];
  assert.deepEqual(suggestRecurring(items, "expense", [], "2026-11-03").map((s) => s.item.name), ["Rent"]);
  assert.deepEqual(suggestRecurring(items, "income", [], "2026-11-03").map((s) => s.item.name), ["Salary"]);
});

test("suggestRecurring flags items already recorded in the entry's month, and lists them last", () => {
  const items = [item("1", "Rent", "expense", 5), item("2", "Gym", "expense", 10), item("3", "Netflix", "expense", null)];
  const txns = [{ external_id: "recurring:1:2026-11" }, { external_id: null }, {}];
  const result = suggestRecurring(items, "expense", txns, "2026-11-20");
  assert.deepEqual(result.map((s) => [s.item.name, s.recorded]), [["Gym", false], ["Netflix", false], ["Rent", true]]);
  // The same schedule is NOT recorded in a different month.
  assert.equal(suggestRecurring(items, "expense", txns, "2026-12-01").find((s) => s.item.name === "Rent").recorded, false);
});

test("suggestRecurring orders by day, suggestion-only last, then name", () => {
  const items = [item("a", "Zeta", "expense", 20), item("b", "Alpha", "expense", null), item("c", "Beta", "expense", 3), item("d", "Aardvark", "expense", 3)];
  assert.deepEqual(suggestRecurring(items, "expense", [], "2026-11-01").map((s) => s.item.name), ["Aardvark", "Beta", "Zeta", "Alpha"]);
});

test("scheduleLabel", () => {
  assert.equal(scheduleLabel({ day_of_month: 5 }), "auto-records after day 5");
  assert.equal(scheduleLabel({ day_of_month: null }), "suggestion only");
});

test("mergeAutoRecorded maps database rows and ignores an occurrence it already has", () => {
  const row = { transaction_id: "t1", item_id: "i1", item_name: "Rent", item_type: "expense", amount_paise: "2500000", occurred_on: "2026-11-05" };
  const first = mergeAutoRecorded([], [row]);
  assert.deepEqual(first, [{ transactionId: "t1", itemId: "i1", name: "Rent", type: "expense", amount: 2500000, date: "2026-11-05" }]);
  assert.equal(mergeAutoRecorded(first, [row]), first); // same array back: nothing new, no re-render
  assert.equal(mergeAutoRecorded(first, [{ ...row, transaction_id: "t2" }]).length, 2);
  assert.deepEqual(mergeAutoRecorded([], []), []);
});

test("formatShortDate does not shift the day across timezones", () => {
  assert.match(formatShortDate("2026-11-01"), /^1 Nov/);
  assert.match(formatShortDate("2026-12-31"), /^31 Dec/);
});
