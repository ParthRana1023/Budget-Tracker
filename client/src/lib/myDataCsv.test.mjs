import test from "node:test";
import assert from "node:assert/strict";
import { myDataToCsv } from "./myDataCsv.mjs";

const data = {
  exportedAt: "2026-12-05T10:00:00Z",
  currency: "USD",
  profile: { email: "a@example.com", name: 'Asha "A"', photo: null },
  plan: { salary: 120000, payday: 1, saveFirstPct: 20 },
  planHistory: [
    { field: "salary", from_value: 10000000, to_value: 120000, from_text: "INR", to_text: "USD", applies: "now" },
  ],
  categories: [{ name: "Groceries", monthly_limit: 12000, original_amount: 1000000, original_currency: "INR" }],
  entries: [
    { date: "2026-11-10", type: "expense", amount: 200000, base_currency: "INR", note: "Rice, dal" },
    { date: "2026-12-02", type: "expense", amount: 2500, base_currency: "USD", note: null },
  ],
  recurring: [],
  goals: [],
  goalContributions: [],
  incomeOnHold: [],
  preferences: { theme: "dark", currency: "USD" },
};

test("all my data as one CSV: a titled section per part, amounts in units of their own currency", () => {
  const sections = myDataToCsv(data).split("\r\n\r\n");
  assert.equal(sections.length, 11);
  assert.match(sections[0], /^SaveFirst data export\r\nExported at,2026-12-05T10:00:00Z\r\nBase currency,USD/);
  assert.equal(sections[1], 'Profile\r\nField,Value\r\nemail,a@example.com\r\nname,"Asha ""A"""\r\nphoto,');
  assert.equal(sections[2], "Plan\r\nField,Value\r\nsalary,1200.00\r\npayday,1\r\nsaveFirstPct,20");
  assert.equal(
    sections[3],
    "Plan history\r\nfield,from_value,to_value,from_text,to_text,applies\r\nsalary,100000.00,1200.00,INR,USD,now",
    "a base switch's salary row: ₹1,00,000 -> $1,200",
  );
  assert.equal(
    sections[4],
    "Categories\r\nname,monthly_limit,original_amount,original_currency\r\nGroceries,120.00,10000.00,INR",
  );
  assert.equal(
    sections[5],
    'Entries\r\ndate,type,amount,base_currency,note\r\n2026-11-10,expense,2000.00,INR,"Rice, dal"\r\n2026-12-02,expense,25.00,USD,',
  );
  assert.equal(sections[6], "Recurring items\r\nNone");
});
