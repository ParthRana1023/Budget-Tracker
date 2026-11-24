import test from "node:test";
import assert from "node:assert/strict";
import { methodLabel, methodShort, parseMethod, parseMethodFilter, spendByMethod } from "./paymentMethods.mjs";

test("labels and CSV parsing", () => {
  assert.equal(methodLabel("credit_card"), "Credit card");
  assert.equal(methodLabel(null), "");
  assert.equal(methodLabel("cheque"), "");
  assert.equal(parseMethod("UPI"), "upi");
  assert.equal(parseMethod(" debit card "), "debit_card");
  assert.equal(parseMethod("credit_card"), "credit_card");
  assert.equal(parseMethod(""), null, "blank = not recorded");
  assert.equal(parseMethod("cheque"), undefined, "unknown");
});

test("spend by method: expenses only, Not set grouped and last, the rest biggest first", () => {
  const rows = spendByMethod([
    { type: "expense", amount: 50000, payment_method: "upi" },
    { type: "expense", amount: "20000", payment_method: "upi" },
    { type: "expense", amount: 90000, payment_method: null },
    { type: "expense", amount: 10000, payment_method: "cash" },
    { type: "income", amount: 999999, payment_method: "upi" },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.label, r.amount, r.count]),
    [
      ["UPI", 70000, 2],
      ["Cash", 10000, 1],
      ["Not set", 90000, 1],
    ],
  );
  assert.equal(rows[0].key, "upi");
});

test("short names and the ledger filter in the URL", () => {
  assert.equal(methodShort("debit_card"), "Debit");
  assert.equal(methodShort(null), "");
  assert.deepEqual(parseMethodFilter("none,cash"), ["cash", "none"], "picker order, Not set last");
  assert.deepEqual(parseMethodFilter("cash,cheque,,"), ["cash"], "unknown keys dropped");
  assert.deepEqual(parseMethodFilter(null), []);
  assert.deepEqual(parseMethodFilter("card_payment,credit_card"), ["credit_card", "card_payment"], "card payments last");
});
