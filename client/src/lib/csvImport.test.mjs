import test from "node:test";
import assert from "node:assert/strict";
import { checkImport, parseCsv } from "./csvImport.mjs";
import { transactionsToCsv } from "./csvExport.mjs";
import { setCurrency } from "./money.mjs";

const categories = [{ name: "Groceries" }, { name: "Rent / Housing" }];

test("parses quotes, commas, CRLF and a BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n'), [
    ["a", "b"],
    ["x, y", 'say "hi"'],
  ]);
});

test("an export imports back as it was", () => {
  const csv = transactionsToCsv([
    { date: "2026-11-02", type: "expense", category: { name: "Groceries" }, amount: 120050, note: "DMart, Andheri" },
    { date: "2026-11-01", type: "income", category: null, amount: 9000000, note: "Salary" },
  ]);
  const r = checkImport(csv, { categories });
  assert.equal(r.error, null);
  assert.deepEqual(r.rows, [
    { date: "2026-11-02", type: "expense", category: "Groceries", amount: 120050, note: "DMart, Andheri" },
    { date: "2026-11-01", type: "income", category: "", amount: 9000000, note: "Salary" },
  ]);
});

test("bad rows are listed with a reason; duplicates are counted", () => {
  const csv = [
    "Date,Type,Category,Amount (INR),Note",
    "02/11/2026,expense,Groceries,100,a",
    "2026-11-02,expense,Gym,100,b",
    "2026-11-02,expense,groceries,0,c",
    "2026-11-02,savings_transfer,,500,d",
    "2026-11-02,refund,,500,e",
    '2026-11-03,expense,groceries,"1,200.5",f',
    "2026-11-03,expense,Groceries,1200.50,f",
    "2026-11-04,income,,500,saved before",
  ].join("\n");
  const r = checkImport(csv, {
    categories,
    existing: [{ date: "2026-11-04", type: "income", category: null, amount: 50000, note: "saved before" }],
  });
  assert.deepEqual(r.skipped, [
    { line: 2, reason: "Date isn’t YYYY-MM-DD" },
    { line: 3, reason: "No category called “Gym”" },
    { line: 4, reason: "Amount must be above ₹0.00" },
    { line: 5, reason: "Savings and reserve moves aren’t imported" },
    { line: 6, reason: "Unknown type “refund”" },
  ]);
  assert.deepEqual(r.rows, [{ date: "2026-11-03", type: "expense", category: "Groceries", amount: 120050, note: "f" }]);
  assert.equal(r.duplicates, 2, "one repeated in the file, one already saved");
});

test("a file without the needed columns, or empty, is refused", () => {
  assert.match(checkImport("Name,Value\nx,1", { categories }).error, /Date and Amount/);
  assert.match(checkImport("Date,Amount\n", { categories }).error, /no entries/);
});

test("payment method: round-trips through export, optional, unknown values skipped", () => {
  const csv = transactionsToCsv([
    {
      date: "2026-11-02",
      type: "expense",
      category: { name: "Groceries" },
      amount: 50000,
      note: "a",
      payment_method: "credit_card",
    },
    { date: "2026-11-03", type: "expense", category: { name: "Groceries" }, amount: 60000, note: "b" },
  ]);
  assert.deepEqual(checkImport(csv, { categories }).rows, [
    {
      date: "2026-11-02",
      type: "expense",
      category: "Groceries",
      amount: 50000,
      note: "a",
      payment_method: "credit_card",
    },
    { date: "2026-11-03", type: "expense", category: "Groceries", amount: 60000, note: "b" },
  ]);
  const r = checkImport(
    "Date,Type,Category,Amount,Payment method\n2026-11-04,expense,Groceries,10,Cheque\n2026-11-05,income,,10,UPI",
    {
      categories,
    },
  );
  assert.deepEqual(r.skipped, [{ line: 2, reason: "Unknown payment method “Cheque”" }]);
  assert.equal(r.rows[0].payment_method, undefined, "income never carries a method");
});

test("amounts are read in the base currency: no decimals for yen", () => {
  setCurrency("JPY");
  const r = checkImport(
    'Date,Type,Category,Amount (JPY)\n2026-11-04,expense,Groceries,"¥1,200"\n2026-11-05,expense,Groceries,12.5',
    {
      categories,
    },
  );
  setCurrency("INR");
  assert.equal(r.rows[0].amount, 1200);
  assert.deepEqual(r.skipped, [{ line: 3, reason: "Amount must be above ¥0" }]);
});

test("Currency column: today's base goes in, an older base is listed with the reason", () => {
  const csv = [
    "Date,Type,Category,Amount,Currency,Note",
    "2026-11-02,expense,Groceries,100,INR,today's base",
    "2026-11-03,expense,Groceries,25,USD,older base",
  ].join("\n");
  const r = checkImport(csv, { categories });
  assert.deepEqual(
    r.rows.map((x) => x.note),
    ["today's base"],
  );
  assert.deepEqual(r.skipped, [{ line: 3, reason: "In USD; only INR amounts can be imported" }]);
});
