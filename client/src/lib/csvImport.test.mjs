import test from "node:test";
import assert from "node:assert/strict";
import { checkImport, parseCsv } from "./csvImport.mjs";
import { transactionsToCsv } from "./csvExport.mjs";

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
    { line: 4, reason: "Amount must be above ₹0" },
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
