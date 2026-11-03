import assert from "node:assert/strict";
import test from "node:test";
import { isRecurringItemDue } from "./recurrence.mjs";

test("marks an active item due once its scheduled day arrives without a matching posting", () => {
  assert.equal(isRecurringItemDue({ active: true, day_of_month: 5, id: "rent" }, [], new Date("2026-11-05T12:00:00")), true);
  assert.equal(isRecurringItemDue({ active: true, day_of_month: 5, id: "rent" }, [{ external_id: "recurring:rent:2026-11" }], new Date("2026-11-05T12:00:00")), false);
});
