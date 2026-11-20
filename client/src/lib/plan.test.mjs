import test from "node:test";
import assert from "node:assert/strict";
import { planFor } from "./plan.mjs";

const rows = [
  { field: "salary", to_value: 7800000, applies: "start", effective_from: "2026-09-10" },
  { field: "save_pct", to_value: 15, applies: "start", effective_from: "2026-09-10" },
  // 1 Nov cycle: save-first raised for that cycle ("now").
  { field: "save_pct", to_value: 20, applies: "now", effective_from: "2026-11-01", created_at: "2026-11-05T09:00:00Z" },
  // Salary rise from the next cycle; first chose 90,000, then changed it to 85,000.
  {
    field: "salary",
    to_value: 9000000,
    applies: "next",
    effective_from: "2026-12-01",
    superseded_at: "2026-11-20T00:00:00Z",
  },
  {
    field: "salary",
    to_value: 8500000,
    applies: "next",
    effective_from: "2026-12-01",
    created_at: "2026-11-20T00:00:00Z",
  },
];
const settings = { take_home_pay: 8500000, savings_pct: 20, plan_changes: rows };

test("each cycle uses the plan in force at its start", () => {
  assert.deepEqual(planFor(settings, "2026-10-01"), { take_home_pay: 7800000, savings_pct: 15 }, "before any change");
  assert.deepEqual(
    planFor(settings, "2026-11-01"),
    { take_home_pay: 7800000, savings_pct: 20 },
    "'now' applies to its own cycle",
  );
  assert.deepEqual(
    planFor(settings, "2026-12-01"),
    { take_home_pay: 8500000, savings_pct: 20 },
    "superseded change ignored",
  );
});

test("no plan history: the settings columns", () => {
  assert.deepEqual(planFor({ take_home_pay: 100, savings_pct: 30 }, "2026-11-01"), {
    take_home_pay: 100,
    savings_pct: 30,
  });
  assert.deepEqual(planFor(null, "2026-11-01"), { take_home_pay: null, savings_pct: null });
});
