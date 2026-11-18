import test from "node:test";
import assert from "node:assert/strict";
import { getPeriodRange } from "./periods.mjs";
import { addDaysStr, cycleDayOf, dueDateInCycle } from "./cycle.mjs";
import { recurringStatus } from "./recurringStatus.mjs";
import { buildCycleModel } from "./cycleModel.mjs";
import { budgetWarnings } from "./notices.mjs";
import { demoAccount, R } from "./demoAccount.fixture.mjs";

const DEMO = demoAccount();

test("demo account: the handoff's hero numbers", () => {
  const m = buildCycleModel(DEMO);
  assert.equal(m.income, 95000 * R);
  assert.equal(m.savingsTarget, 30000 * R);
  assert.equal(m.flexSpent, 12900 * R);
  assert.equal(m.fixedCommitted, 35300 * R);
  assert.equal(m.unpaidBills, 5500 * R, "₹5,500 in bills still due");
  assert.equal(m.safe, 16800 * R, "safe to spend ₹16,800");
  assert.equal(m.perDay, 1120 * R, "₹1,120 a day for the next 15 days");
  assert.equal(m.savedTotal, 30000 * R, "savings line uses the target when less was moved so far");
  assert.deepEqual(m.bar, { savings: 30000 * R, bills: 35300 * R, spent: 12900 * R, safe: 16800 * R });
});

test("windfall savings, reserve and reserve-paid bills", () => {
  const extra = [
    { id: "w1", type: "income", amount: 60000 * R, date: "2026-11-16", source: "manual" },
    { id: "w2", type: "savings_transfer", amount: 30000 * R, date: "2026-11-16", source: "windfall" },
    { id: "w3", type: "reserve_transfer", amount: 18000 * R, date: "2026-11-16", source: "windfall" },
    { id: "w4", type: "reserve_transfer", amount: 5000 * R, date: "2026-10-10", source: "windfall" }, // last cycle
    { id: "w5", type: "expense", category_id: "health", amount: 4000 * R, date: "2026-11-16", from_reserve: true },
  ];
  const m = buildCycleModel({ ...DEMO, transactions: [...DEMO.transactions, ...extra] });
  assert.equal(
    m.safe,
    (16800 + 60000 - 30000 - 18000) * R,
    "windfall: part saved, part reserved, the rest is spendable",
  );
  assert.equal(m.reserveLeft, (18000 + 5000 - 4000) * R, "reserve is a running balance across cycles");
  assert.equal(m.spentByCat.get("health"), 0, "a bill paid from the reserve is not category spending");
  assert.equal(m.savedTotal, (30000 + 30000) * R);
});

test("skipping a fixed bill's recurring item removes it from this cycle", () => {
  const items = DEMO.recurringItems.map((r) => (r.id === "r6" ? { ...r, skip_month: "2026-11" } : r));
  const m = buildCycleModel({ ...DEMO, recurringItems: items });
  assert.equal(m.unpaidBills, 2500 * R);
  assert.equal(m.safe, (16800 + 3000) * R);
});

test("uncategorised and switched-off spending still counts; switched-off categories are hidden", () => {
  const cats = DEMO.categories.map((c) => (c.id === "ent" ? { ...c, is_active: false } : c));
  const extra = { id: "u", type: "expense", category_id: null, amount: 100 * R, date: "2026-11-16" };
  const m = buildCycleModel({ ...DEMO, categories: cats, transactions: [...DEMO.transactions, extra] });
  assert.equal(m.flexSpent, (12900 + 100) * R);
  assert.ok(!m.flex.some((c) => c.id === "ent"));
});

test("no onboarding answers: no savings target, nothing breaks", () => {
  const m = buildCycleModel({ ...DEMO, settings: null });
  assert.equal(m.savingsTarget, 0);
  assert.equal(m.safe, (16800 + 30000 - 14000) * R, "only what was actually moved to savings is set aside");
});

test("pay-day cycle dates and recurring status (salary on the 25th)", () => {
  const period = getPeriodRange(new Date(2026, 10, 28, 12), 25); // 25 Nov – 24 Dec
  assert.equal(dueDateInCycle(26, period), "2026-11-26");
  assert.equal(dueDateInCycle(3, period), "2026-12-03");
  assert.equal(dueDateInCycle(25, period), "2026-11-25");
  assert.equal(cycleDayOf("2026-12-03", period), 9);
  assert.equal(addDaysStr("2026-12-31", 1), "2027-01-01");
  const ctx = {
    cycleTransactions: [{ id: "x", date: "2026-11-27", external_id: "recurring:rec:2026-11" }],
    period,
    today: "2026-11-28",
  };
  const s = (over) => recurringStatus({ id: "i", day_of_month: 26, active: true, skip_month: null, ...over }, ctx);
  assert.equal(s({}).key, "due");
  assert.equal(s({}).dueDate, "2026-11-26");
  assert.equal(s({ day_of_month: 28 }).key, "due", "due today");
  assert.equal(s({ day_of_month: 3 }).key, "upcoming");
  assert.equal(s({ day_of_month: null }).key, "suggested");
  assert.equal(s({ active: false }).key, "paused");
  assert.equal(s({ skip_month: "2026-11" }).key, "skipped");
  assert.equal(s({ id: "rec" }).key, "recorded", "recorded beats every other state");
});

test("budget warnings at 80% and over, dismissed per level", () => {
  const flex = [
    { id: "a", name: "A", monthly_limit: 1000 },
    { id: "b", name: "B", monthly_limit: 1000 },
    { id: "c", name: "C", monthly_limit: 0 },
  ];
  const spentByCat = new Map([
    ["a", 870],
    ["b", 1200],
    ["c", 5000],
  ]);
  const w = budgetWarnings({ flex, spentByCat });
  assert.deepEqual(
    w.map((x) => [x.key, x.pct]),
    [
      ["a:80", 87],
      ["b:over", 120],
    ],
    "no warning without a limit",
  );
  assert.equal(budgetWarnings({ flex, spentByCat, dismissed: ["a:80"] }).length, 1);
  spentByCat.set("a", 1001);
  assert.equal(budgetWarnings({ flex, spentByCat, dismissed: ["a:80"] })[0].key, "a:over", "going over shows it again");
});

test("labels: rupees, dates and the cycle line", async () => {
  const { inr } = await import("./money.mjs");
  const { cycleLabel, dayLabel, monthLabel, shortDate } = await import("./cycle.mjs");
  assert.equal(inr(10000000), "₹1,00,000");
  assert.equal(inr(-65000), "−₹650");
  assert.equal(inr(-20), "₹0", "no minus sign on a rounded zero");
  assert.equal(shortDate("2026-11-20"), "20 Nov");
  assert.equal(dayLabel("2026-11-16", "2026-11-16"), "Today");
  assert.equal(dayLabel("2026-11-15", "2026-11-16"), "Yesterday");
  assert.equal(dayLabel("2026-11-01", "2026-11-16"), "1 Nov");
  assert.equal(monthLabel("2027-06-01"), "Jun 2027");
  assert.equal(cycleLabel(DEMO.period), "Cycle 1–30 Nov · Day 16 of 30");
  assert.equal(cycleLabel(getPeriodRange(new Date(2026, 10, 28, 12), 25)), "Cycle 25 Nov–24 Dec · Day 4 of 30");
});
