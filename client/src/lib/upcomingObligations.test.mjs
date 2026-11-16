import test from "node:test";
import assert from "node:assert/strict";
import { computeUpcomingObligations } from "./upcomingObligations.mjs";
import { getPeriodRange } from "./periods.mjs";

const categories = [
  { id: "rent", name: "Rent", type: "fixed" },
  { id: "ott", name: "Subscriptions", type: "flexible" },
];
const item = (id, amount, day, category_id = null, extra = {}) => ({
  id, name: id, amount, type: "expense", category_id, day_of_month: day, active: true, ...extra,
});

test("cycle spanning two months places each due day in the right month", () => {
  const period = getPeriodRange(new Date(2026, 10, 20, 12), 15); // 15 Nov - 14 Dec
  const { items } = computeUpcomingObligations({
    recurringItems: [item("a", 100, 20), item("b", 100, 5)],
    categories,
    transactions: [],
    period,
    today: "2026-11-20",
  });
  assert.deepEqual(items.map((i) => [i.id, i.dueDate, i.status]), [
    ["a", "2026-11-20", "due"],
    ["b", "2026-12-05", "upcoming"],
  ]);
});

test("recorded vs expected, fixed vs flexible totals, inactive and income ignored", () => {
  const period = getPeriodRange(new Date(2026, 10, 10, 12), 1); // 1-30 Nov
  const result = computeUpcomingObligations({
    recurringItems: [
      item("rent", 25_000, 1, "rent"),
      item("ott", 500, 15, "ott"),
      item("gym", 1_000, null),
      item("old", 999, 3, null, { active: false }),
      { ...item("salary", 90_000, 1), type: "income" },
    ],
    categories,
    transactions: [
      { id: "t1", amount: 25_500, date: "2026-11-01", external_id: "recurring:rent:2026-11" },
      { id: "t2", amount: 500, date: "2026-10-15", external_id: "recurring:ott:2026-10" }, // last cycle
    ],
    period,
    today: "2026-11-10",
  });
  assert.deepEqual(result.items.map((i) => [i.id, i.status]), [
    ["rent", "recorded"],
    ["ott", "upcoming"],
    ["gym", "unscheduled"],
  ]);
  assert.equal(result.items[0].recordedAmount, 25_500);
  assert.deepEqual(result.totals, {
    monthlyCommitment: 26_500,
    fixed: 25_000,
    flexible: 500,
    uncategorized: 1_000,
    recorded: 25_500,
    stillExpected: 1_500,
  });
});
