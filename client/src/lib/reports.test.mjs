import test from "node:test";
import assert from "node:assert/strict";
import { cycleHistory, flexByDay, forecastNext, suggestLimits, topPayees, weekdayAverages } from "./reports.mjs";
import { demoAccount, R } from "./demoAccount.fixture.mjs";

const DEMO = demoAccount();
// Add last month (October) so there is a full cycle to compare against.
const october = [
  { id: "o1", type: "income", amount: 95000 * R, date: "2026-10-01" },
  { id: "o2", type: "expense", category_id: "rent", amount: 28000 * R, date: "2026-10-03" },
  { id: "o3", type: "expense", category_id: "dine", amount: 6200 * R, date: "2026-10-10", note: "Swiggy lunch" },
  {
    id: "o4",
    type: "expense",
    category_id: "groc",
    amount: 9000 * R,
    date: "2026-10-18",
    payee: "BigBasket",
    note: "weekly shop",
  },
  { id: "o5", type: "savings_transfer", amount: 30000 * R, date: "2026-10-02" },
];
const hist = cycleHistory({
  transactions: [...DEMO.transactions, ...october],
  categories: DEMO.categories,
  schedule: [{ payDay: 1 }],
  today: DEMO.today,
  count: 3,
});

test("cycle history: oldest first, current cycle partial", () => {
  assert.deepEqual(
    hist.map((c) => [c.label, c.partial]),
    [
      ["Sep", false],
      ["Oct", false],
      ["Nov", true],
    ],
  );
  const [sep, oct, nov] = hist;
  assert.equal(sep.income, 0);
  assert.equal(oct.flex, (6200 + 9000) * R);
  assert.equal(oct.fixed, 28000 * R);
  assert.equal(Math.round(oct.rate), 32, "30,000 of 95,000 saved");
  assert.equal(nov.flex, 12900 * R);
  assert.equal(nov.fixed, (28000 + 1200 + 600) * R);
  assert.equal(flexByDay(nov, 8), (1620 + 1860) * R, "the ₹2,400 DMart run was on the 10th");
});

test("payees use the payee field, else a name from the note", () => {
  const top = topPayees(hist[1], hist[0]);
  const big = top.find((p) => p.name === "BigBasket");
  assert.equal(big.amount, 9000 * R);
  assert.equal(big.previous, null, "new this month");
  assert.ok(top.some((p) => p.name === "Swiggy lunch" && p.amount === 6200 * R));
});

test("weekday averages: Monday 16 Nov had ₹1,820 over three Mondays so far", () => {
  const avg = weekdayAverages([hist[2]], DEMO.today);
  assert.equal(avg.length, 7);
  assert.equal(Math.round(avg[0] / R), Math.round(1820 / 3));
});

test("suggested limits and the next-cycle forecast", () => {
  const full = hist.filter((c) => !c.partial);
  const s = suggestLimits(
    [
      { id: "dine", name: "Dining out", monthly_limit: 5000 * R },
      { id: "groc", name: "Groceries", monthly_limit: 10000 * R },
      { id: "health", name: "Health", monthly_limit: 0 },
    ],
    full,
  );
  // Averages over Sep + Oct: Dining out 3,100 -> 3,250; Groceries 4,500 -> 4,500. Health never used: no suggestion.
  assert.deepEqual(
    s.map((x) => [x.name, x.tag, x.to / R]),
    [
      ["Dining out", "Lower", 3250],
      ["Groceries", "Lower", 4500],
    ],
  );
  const f = forecastNext({
    settings: DEMO.settings,
    fixed: DEMO.categories.filter((c) => c.type === "fixed"),
    recurringItems: DEMO.recurringItems,
    flex: [],
    fullCycles: full,
    lastIncome: 0,
  });
  assert.equal(f.income, 100000 * R);
  assert.equal(f.savings, 30000 * R);
  assert.equal(f.fixedTotal, 35300 * R);
  assert.equal(f.left, (100000 - 30000 - 35300) * R, "every recurring item here belongs to a fixed bill");
});
