import assert from "node:assert/strict";
import test from "node:test";

import { transactionsToCsv } from "./csvExport.mjs";

test("exports transactions as escaped CSV with amounts in rupees", () => {
  const csv = transactionsToCsv([
    {
      id: "tx-1",
      amount: 123456,
      type: "expense",
      date: "2026-11-03",
      note: 'Lunch, "team"',
      category: { name: "Food & Dining Out" },
    },
  ]);

  assert.equal(
    csv,
    'Date,Type,Category,Amount (INR),Note\r\n2026-11-03,expense,Food & Dining Out,1234.56,"Lunch, ""team"""'
  );
});
