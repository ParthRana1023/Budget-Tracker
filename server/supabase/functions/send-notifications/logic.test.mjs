import test from "node:test";
import assert from "node:assert/strict";
import { addDays, billPush, billsDueOn, channels, isQuiet, localParts, money, weeklyPush } from "./logic.mjs";

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

test("push text for bills and the weekly summary", () => {
  assert.deepEqual(billPush("Rent", 1200000, 1), {
    title: "Rent is due tomorrow",
    body: "₹12,000. Record it in SaveFirst when you pay.",
    url: "/dashboard",
    tag: "bill:Rent",
  });
  assert.equal(billPush("Rent", 1200000, 3).title, "Rent is due in 3 days");
  assert.equal(weeklyPush(450000, 1).body, "You spent ₹4,500 across 1 entry last week.");
});

test("message amounts follow the user's base currency", () => {
  assert.equal(money(1200000), "₹12,000");
  assert.equal(money(150050, "USD"), "$1,501");
  assert.equal(money(12000, "JPY"), "¥12,000", "yen have no minor unit");
  assert.equal(billPush("Rent", 150000, 3, "USD").body, "$1,500. Record it in SaveFirst when you pay.");
});
