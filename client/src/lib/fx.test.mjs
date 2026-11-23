import test from "node:test";
import assert from "node:assert/strict";
import { convert, frankfurterUrl, parseFrankfurter, repricePatches, staleCurrencies } from "./fx.mjs";

test("convert: foreign minor units to base minor units, rounded once", () => {
  assert.equal(convert(1999, "USD", 92.68, "INR"), 185267, "$19.99 = ₹1,852.67");
  assert.equal(convert(1200, "JPY", 0.5462, "INR"), 65544, "¥1,200 has no minor unit");
  assert.equal(convert(1999, "USD", 156.12, "JPY"), 3121, "to a zero-decimal base");
  assert.equal(convert(1234, "KWD", 270.5, "INR"), 33380, "three decimals: 1.234 KWD");
  assert.equal(convert(1, "USD", 92.68, "INR"), 93, "one cent rounds to the nearest paisa");
});

test("Frankfurter: URL and parsing", () => {
  assert.equal(
    frankfurterUrl("USD", "INR", "2026-11-22"),
    "https://api.frankfurter.dev/v1/2026-11-22?base=USD&symbols=INR",
  );
  assert.deepEqual(parseFrankfurter({ amount: 1, base: "USD", date: "2026-11-20", rates: { INR: 92.68 } }, "INR"), {
    rate: 92.68,
    ecbDate: "2026-11-20",
  });
  assert.equal(parseFrankfurter({ message: "not found" }, "INR"), null);
  assert.equal(parseFrankfurter({ rates: { INR: -1 } }, "INR"), null);
});

test("a new cycle re-prices foreign bills at its own rate; past cycles keep theirs", () => {
  const items = [
    { id: "a", amount: 165000, original_amount: 1999, original_currency: "USD", fx_rate: 82.5, fx_date: "2026-10-25" },
    { id: "b", amount: 50000, original_amount: 500, original_currency: "EUR", fx_rate: 100, fx_date: "2026-11-25" },
    { id: "c", amount: 70000 },
    { id: "d", amount: 1000, original_amount: 1000, original_currency: "JPY", fx_rate: 0.55, fx_date: null },
  ];
  assert.deepEqual(staleCurrencies(items, "2026-11-25"), ["USD", "JPY"]);
  assert.deepEqual(repricePatches(items, "amount", "2026-11-25", new Map([["USD", 92.68]])), [
    { id: "a", patch: { amount: 185267, fx_rate: 92.68, fx_date: "2026-11-25" } },
  ]);
});
