import test from "node:test";
import assert from "node:assert/strict";
import {
  baseCurrency,
  cleanTyped,
  CURRENCIES,
  formatExact,
  formatMoney,
  inr,
  minorDigits,
  setCurrency,
  setNumberFormat,
  showTyped,
  toMajor,
  toMinor,
  ZERO_DECIMAL,
} from "./money.mjs";

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

test("base currency: symbol, minor units and typing follow it", () => {
  setCurrency("JPY");
  assert.equal(inr(120000), "¥1,20,000", "yen have no minor unit");
  assert.equal(toMinor(1200), 1200);
  assert.equal(cleanTyped("1,200.50", "indian"), "1200", "no decimals for yen");
  setCurrency("USD");
  assert.equal(inr(-1999), "−$20");
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMajor(1999), 19.99);
  setCurrency("KWD");
  assert.equal(baseCurrency(), "INR", "unsupported currencies fall back to INR");
  assert.equal(formatMoney(150000, "international", "CHF"), "CHF 1,500", "letter codes get a space");
  assert.equal(formatExact(1999, "USD"), "$19.99");
  assert.equal(formatExact(1200, "JPY"), "¥1,200");
});

test("minor-unit digits: 0, 2 and 3 decimals, and the SQL list matches", () => {
  assert.equal(minorDigits("JPY"), 0);
  assert.equal(minorDigits("INR"), 2);
  assert.equal(minorDigits("KWD"), 3);
  assert.equal(toMinor(1.234, "KWD"), 1234);
  assert.deepEqual(
    CURRENCIES.filter((c) => minorDigits(c) === 0),
    ZERO_DECIMAL,
    "currency_digits() in the multicurrency migration lists the same zero-decimal currencies",
  );
});
