import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, inr } from "./money.mjs";

test("money in each number format", () => {
  assert.equal(formatMoney(10000000), "₹1,00,000");
  assert.equal(formatMoney(10000000, "international"), "₹100,000");
  assert.equal(formatMoney(10000000, "european"), "₹100.000");
  assert.equal(formatMoney(-84000, "indian"), "−₹840");
  assert.equal(formatMoney(10000000, "indian"), inr(10000000), "Indian matches the existing inr()");
});
