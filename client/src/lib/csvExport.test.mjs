import assert from "node:assert/strict";
import test from "node:test";

import { transactionsToCsv } from "./csvExport.mjs";
import { setCurrency } from "./money.mjs";

test("exports transactions as escaped CSV with amounts in rupees", () => {
  const csv = transactionsToCsv([
    {
      id: "tx-1",
      amount: 123456,
      type: "expense",
      date: "2026-11-03",
      note: 'Lunch, "team"',
      category: { name: "Food & Dining Out" },
      payment_method: "upi",
    },
    {
      id: "tx-2",
      amount: 16500,
      type: "expense",
      date: "2026-11-04",
      note: "Netflix",
      category: { name: "Food" },
      original_amount: 199,
      original_currency: "USD",
    },
  ]);

  assert.equal(
    csv,
    'Date,Type,Category,Amount (INR),Note,Payment method,Original amount\r\n2026-11-03,expense,Food & Dining Out,1234.56,"Lunch, ""team""",UPI,\r\n2026-11-04,expense,Food,165.00,Netflix,,$1.99',
  );
});

test("exports in the base currency's units: yen have no decimals", () => {
  setCurrency("JPY");
  const csv = transactionsToCsv([{ amount: 1200, type: "expense", date: "2026-11-03", note: "Ramen" }]);
  setCurrency("INR");
  assert.equal(
    csv,
    "Date,Type,Category,Amount (JPY),Note,Payment method,Original amount\r\n2026-11-03,expense,,1200,Ramen,,",
  );
});
