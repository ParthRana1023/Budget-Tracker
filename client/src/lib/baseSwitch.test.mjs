import test from "node:test";
import assert from "node:assert/strict";
import { baseOn, inTodaysBase, lastSwitch, otherBases, ratesFromRows } from "./baseSwitch.mjs";
import { buildCycleModel } from "./cycleModel.mjs";
import { cycleHistory } from "./reports.mjs";
import { cycleFor, parseLocalDate } from "./periods.mjs";

// INR until 30 Nov, USD from 1 Dec; a pending switch back to INR from 1 Jan was cancelled.
const settings = {
  currency: "USD",
  month_start_day: 1,
  plan_changes: [
    { field: "currency", from_text: "INR", to_text: "USD", applies: "next", effective_from: "2026-12-01" },
    {
      field: "currency",
      from_text: "USD",
      to_text: "INR",
      applies: "next",
      effective_from: "2027-01-01",
      superseded_at: "2026-12-05",
    },
  ],
};

test("baseOn: the base in effect on a date; superseded rows don't count", () => {
  assert.equal(baseOn(settings, "2026-11-30"), "INR");
  assert.equal(baseOn(settings, "2026-12-01"), "USD");
  assert.equal(baseOn(settings, "2027-02-01"), "USD");
  assert.equal(baseOn({ currency: "EUR" }, "2026-01-01"), "EUR", "never switched");
});

test("lastSwitch: only a switch that has started", () => {
  assert.deepEqual(lastSwitch(settings, "2026-12-03"), { from: "INR", to: "USD", on: "2026-12-01" });
  assert.equal(lastSwitch({ ...settings, currency: "INR" }, "2026-11-20"), null, "still pending");
});

test("ratesFromRows: the newest rate per currency", () => {
  const rates = ratesFromRows([
    { original_currency: "INR", fx_rate: 0.012, fx_date: "2026-12-01" },
    { original_currency: "INR", fx_rate: 0.0118, fx_date: "2027-01-01" },
    { original_currency: "EUR", fx_rate: 0, fx_date: "2027-01-01" },
    { original_currency: null, fx_rate: 5 },
  ]);
  assert.deepEqual([...rates], [["INR", 0.0118]]);
});

const txs = [
  { id: "a", type: "expense", amount: 200000, date: "2026-11-10", base_currency: "INR", category_id: "g" },
  { id: "b", type: "expense", amount: 2500, date: "2026-12-04", base_currency: "USD", category_id: "g" },
];

test("inTodaysBase: old-base rows convert at today's rate and keep what was recorded", () => {
  const out = inTodaysBase(txs, (t) => t.base_currency, new Map([["INR", 0.012]]), "USD");
  assert.equal(out[0].amount, 2400, "₹2,000.00 -> $24.00");
  assert.equal(out[0].recorded_amount, 200000);
  assert.equal(out[0].recorded_currency, "INR");
  assert.equal(out[1], txs[1], "today's base is untouched");
  assert.equal(inTodaysBase(txs, (t) => t.base_currency, new Map(), "USD")[0], txs[0], "no rate yet: as stored");
  assert.deepEqual(
    otherBases(txs, (t) => t.base_currency, "USD"),
    ["INR"],
  );
});

test("Reports: an old-base cycle's totals are in today's base", () => {
  const converted = inTodaysBase(txs, (t) => t.base_currency, new Map([["INR", 0.012]]), "USD");
  const hist = cycleHistory({
    transactions: converted,
    categories: [{ id: "g", name: "Groceries", type: "flexible", monthly_limit: 30000 }],
    schedule: [{ payDay: 1 }],
    today: "2026-12-10",
    count: 2,
  });
  assert.deepEqual(
    hist.map((c) => c.flex),
    [2400, 2500],
  );
});

test("reserve: windfall in INR and a USD bill paid from it add up in USD", () => {
  const reserve = [
    { id: "r1", type: "reserve_transfer", amount: 1000000, date: "2026-11-05", base_currency: "INR" },
    { id: "r2", type: "expense", amount: 5000, date: "2026-12-03", base_currency: "USD", from_reserve: true },
  ];
  const transactions = inTodaysBase(reserve, (t) => t.base_currency, new Map([["INR", 0.012]]), "USD");
  const model = buildCycleModel({
    settings: { ...settings, take_home_pay: 120000, savings_pct: 20 },
    categories: [],
    transactions,
    recurringItems: [],
    period: cycleFor(parseLocalDate("2026-12-10"), [{ payDay: 1 }]),
    today: "2026-12-10",
  });
  assert.equal(model.reserveIn, 12000, "₹10,000 -> $120.00");
  assert.equal(model.reserveLeft, 7000);
});

test("goal savings: contributions convert by the base on their date", () => {
  const contributions = [
    { goal_id: "t", amount: 100000, date: "2026-11-15" },
    { goal_id: "t", amount: 1000, date: "2026-12-02" },
  ];
  const out = inTodaysBase(contributions, (c) => baseOn(settings, c.date), new Map([["INR", 0.012]]), "USD");
  assert.equal(
    out.reduce((s, c) => s + c.amount, 0),
    2200,
    "₹1,000 -> $12.00, plus $10.00",
  );
});
