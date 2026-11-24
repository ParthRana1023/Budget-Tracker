import test from "node:test";
import assert from "node:assert/strict";
import { addDays, billPush, billsDueOn, channels, isQuiet, localParts, money, safeNow, weeklyPush } from "./logic.mjs";

test("local date, hour and weekday in the user's time zone", () => {
  // 20:30 UTC Sunday 22 Nov = 02:00 Monday 23 Nov in India.
  assert.deepEqual(localParts(new Date("2026-11-22T20:30:00Z"), "Asia/Kolkata"), {
    date: "2026-11-23",
    hour: 2,
    weekday: 1,
  });
  assert.equal(localParts(new Date("2026-11-22T20:30:00Z"), "Europe/London").date, "2026-11-22");
});

test("quiet hours, including past midnight", () => {
  const s = { quiet_hours_on: true, quiet_from: 22, quiet_to: 8 };
  assert.equal(isQuiet(23, s), true);
  assert.equal(isQuiet(3, s), true);
  assert.equal(isQuiet(8, s), false);
  assert.equal(isQuiet(12, s), false);
  assert.equal(isQuiet(13, { quiet_hours_on: true, quiet_from: 12, quiet_to: 14 }), true);
  assert.equal(isQuiet(23, { ...s, quiet_hours_on: false }), false);
});

test("bills due on a date: recurring items and fixed bills without one", () => {
  const items = [
    { id: "r1", name: "Rent", amount: 2800000, type: "expense", category_id: "c1", day_of_month: 3, active: true },
    {
      id: "r2",
      name: "Netflix",
      amount: 64900,
      type: "expense",
      category_id: null,
      day_of_month: 3,
      active: true,
      skip_month: "2026-12",
    },
    { id: "r3", name: "Salary", amount: 9000000, type: "income", category_id: null, day_of_month: 3, active: true },
  ];
  const cats = [
    { id: "c1", name: "Rent", type: "fixed", monthly_limit: 2800000, due_day: 3 },
    { id: "c2", name: "Internet", type: "fixed", monthly_limit: 120000, due_day: 3 },
    { id: "c3", name: "Phone", type: "fixed", monthly_limit: 60000, due_day: 4 },
  ];
  assert.deepEqual(billsDueOn(items, cats, "2026-11-03"), [
    { ref: "item:r1:2026-11-03", name: "Rent", amount: 2800000 },
    { ref: "item:r2:2026-11-03", name: "Netflix", amount: 64900 },
    { ref: "bill:c2:2026-11-03", name: "Internet", amount: 120000 },
  ]);
  assert.equal(billsDueOn(items, cats, "2026-12-03").length, 2, "a skipped month is left out");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

test("channels: email needs a sender and the switch, push needs a device and the kind on", () => {
  const s = {
    email_notifications: true,
    weekly_summary: false,
    notify_due: true,
    push_bills: true,
    push_weekly: false,
  };
  assert.deepEqual(channels(s, { emailReady: true, pushReady: true, devices: 1 }), {
    bills: { email: true, push: true },
    weekly: { email: false, push: false },
  });
  assert.deepEqual(channels(s, { emailReady: false, pushReady: true, devices: 0 }), {
    bills: { email: false, push: false },
    weekly: { email: false, push: false },
  });
  assert.equal(channels(s, { emailReady: true, pushReady: false, devices: 2 }).bills.push, false, "no VAPID keys");
  assert.equal(
    channels({ ...s, notify_due: false }, { emailReady: true, pushReady: true, devices: 1 }).bills.email,
    false,
  );
  assert.equal(
    channels({}, { emailReady: true, pushReady: true, devices: 1 }).weekly.push,
    true,
    "push kinds default on",
  );
  assert.equal(
    channels({}, { emailReady: true, pushReady: true, devices: 1 }).weekly.email,
    false,
    "email defaults off",
  );
});

test("push text for bills and the weekly summary (design handoff v3)", () => {
  const rent = { ref: "item:11111111-1111-1111-1111-111111111111:2026-11-25", name: "Rent", amount: 1200000 };
  assert.deepEqual(billPush(rent, 1, "2026-11-25"), {
    title: "Rent is due tomorrow",
    body: "₹12,000.00 · Tap to record it once it’s paid.",
    url: "/dashboard?record=11111111-1111-1111-1111-111111111111",
    tag: "bill-11111111-1111-1111-1111-111111111111-2026-11",
    actions: [{ action: "record", title: "Record it" }],
  });
  assert.equal(billPush(rent, 3, "2026-11-25").title, "Rent is due in 3 days");
  assert.equal(billPush(rent, 7, "2026-11-25").title, "Rent is due on 25 Nov");
  const bill = { ref: "bill:22222222-2222-2222-2222-222222222222:2026-12-01", name: "Insurance", amount: 300000 };
  assert.equal(billPush(bill, 1, "2026-12-01").url, "/dashboard?pay=22222222-2222-2222-2222-222222222222");
  assert.equal(weeklyPush(842000, 1430000, "2026-11-30").title, "Your week: ₹8,420.00 spent");
  assert.equal(
    weeklyPush(842000, 1430000, "2026-11-30").body,
    "₹14,300.00 is safe to spend until 30 Nov. Savings are already set aside.",
  );
  assert.equal(
    weeklyPush(842000, -5000, "2026-11-30").body,
    "Nothing is left to spend until 30 Nov. Savings are already set aside.",
  );
});

test("message amounts follow the user's base currency", () => {
  assert.equal(money(1200000), "₹12,000.00");
  assert.equal(money(150050, "USD"), "$1,500.50");
  assert.equal(money(12000, "JPY"), "¥12,000", "yen have no minor unit");
  assert.equal(
    billPush({ ref: "bill:c1:2026-11-25", name: "Rent", amount: 150000 }, 3, "2026-11-25", "USD").body,
    "$1,500.00 · Tap to record it once it’s paid.",
  );
});

test("the weekly summary's safe to spend is the Dashboard's: pay minus savings, bills and spending", () => {
  const settings = {
    take_home_pay: 10000000,
    savings_pct: 20,
    month_start_day: 1,
    plan_changes: [
      { field: "payday", to_value: 1, applies: "start", effective_from: "2026-01-01" },
      { field: "salary", to_value: 10000000, applies: "start", effective_from: "2026-01-01" },
      { field: "save_pct", to_value: 20, applies: "start", effective_from: "2026-01-01" },
    ],
  };
  const categories = [
    { id: "rent", name: "Rent", type: "fixed", monthly_limit: 2800000, due_day: 3 },
    { id: "food", name: "Groceries", type: "flexible", monthly_limit: 1000000 },
  ];
  const transactions = [
    { id: "t1", type: "income", amount: 10000000, date: "2026-11-01" },
    { id: "t2", type: "savings_transfer", amount: 2000000, date: "2026-11-01" },
    { id: "t3", type: "expense", amount: 2800000, date: "2026-11-03", category_id: "rent" },
    { id: "t4", type: "expense", amount: 500000, date: "2026-11-20", category_id: "food" },
  ];
  const r = safeNow({ settings, categories, transactions, recurringItems: [], today: "2026-11-23" });
  assert.equal(r.cycleStart, "2026-11-01");
  assert.equal(r.cycleEnd, "2026-11-30");
  // 1,00,000 − 20,000 saved − 28,000 rent − 5,000 groceries
  assert.equal(r.safe, 4700000);
});
