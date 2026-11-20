import test from "node:test";
import assert from "node:assert/strict";
import { cleanTyped, formatMoney, inr, setNumberFormat, showTyped } from "./money.mjs";

test("money in each number format", () => {
  assert.equal(formatMoney(10000000, "indian"), "₹1,00,000");
  assert.equal(formatMoney(10000000, "international"), "₹100,000");
  assert.equal(formatMoney(10000000, "european"), "₹100.000");
  assert.equal(formatMoney(-84000, "indian"), "−₹840");
});

test("inr follows the user's format; unknown formats fall back to Indian", () => {
  setNumberFormat("international");
  assert.equal(inr(10000000), "₹100,000");
  setNumberFormat("nope");
  assert.equal(inr(10000000), "₹1,00,000");
  setNumberFormat(null);
  assert.equal(inr(-65000), "−₹650");
});

test("typed amounts are grouped as you type and read back in each format", () => {
  assert.equal(showTyped("123456.5", "indian"), "1,23,456.5");
  assert.equal(showTyped("123456.", "international"), "123,456.");
  assert.equal(showTyped("123456.78", "european"), "123.456,78");
  assert.equal(showTyped(".5", "european"), "0,5");
  assert.equal(showTyped("", "indian"), "");
  assert.equal(cleanTyped("1,23,456.789", "indian"), "123456.78");
  assert.equal(cleanTyped("123.456,7", "european"), "123456.7");
  assert.equal(cleanTyped("12.3.4", "international"), "12.34");
  assert.equal(cleanTyped(showTyped("98765.4", "european"), "european"), "98765.4", "round trip");
});
