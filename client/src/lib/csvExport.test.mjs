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
      payment_method: "upi",
    },
    { id: "tx-2", amount: 500, type: "expense", date: "2026-11-04", note: "Tea", category: { name: "Food" } },
  ]);

  assert.equal(
    csv,
    'Date,Type,Category,Amount (INR),Note,Payment method\r\n2026-11-03,expense,Food & Dining Out,1234.56,"Lunch, ""team""",UPI\r\n2026-11-04,expense,Food,5.00,Tea,',
  );
});
