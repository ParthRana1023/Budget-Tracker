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
    'Date,Type,Category,Amount,Currency,Note,Payment method,Original amount\r\n2026-11-03,expense,Food & Dining Out,1234.56,INR,"Lunch, ""team""",UPI,\r\n2026-11-04,expense,Food,165.00,INR,Netflix,,$1.99',
  );
});

test("exports in the base currency's units: yen have no decimals", () => {
  setCurrency("JPY");
  const csv = transactionsToCsv([{ amount: 1200, type: "expense", date: "2026-11-03", note: "Ramen" }]);
  setCurrency("INR");
  assert.equal(
    csv,
    "Date,Type,Category,Amount,Currency,Note,Payment method,Original amount\r\n2026-11-03,expense,,1200,JPY,Ramen,,",
  );
});

test("each entry in the base it was recorded in: a base switch keeps older entries as made", () => {
  setCurrency("USD");
  const csv = transactionsToCsv([
    { amount: 2500, type: "expense", date: "2026-12-04", note: "Lunch", base_currency: "USD" },
    { amount: 200000, type: "expense", date: "2026-11-10", note: "Groceries", base_currency: "INR" },
    // a copy converted for Reports still exports what was recorded
    {
      amount: 2400,
      recorded_amount: 200000,
      recorded_currency: "INR",
      type: "expense",
      date: "2026-11-11",
      note: "Rice",
    },
  ]);
  setCurrency("INR");
  assert.equal(
    csv.split("\r\n").slice(1).join("|"),
    "2026-12-04,expense,,25.00,USD,Lunch,,|2026-11-10,expense,,2000.00,INR,Groceries,,|2026-11-11,expense,,2000.00,INR,Rice,,",
  );
});
