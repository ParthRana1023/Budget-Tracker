import test from "node:test";
import assert from "node:assert/strict";
import { cardBalance, lastOn, nextOn } from "./cardBalance.mjs";
import { buildCycleModel } from "./cycleModel.mjs";
import { cycleHistory } from "./reports.mjs";
import { projectUntilPayday } from "./untilPayday.mjs";
import { spendByMethod } from "./paymentMethods.mjs";
import { demoAccount, R } from "./demoAccount.fixture.mjs";

const SETTINGS = {
  card_statement_day: 20,
  card_due_day: 5,
  card_tracking_since: "2026-10-01",
  card_opening_balance: 0,
};
const card = (amount, date, extra = {}) => ({ type: "expense", payment_method: "credit_card", amount: amount * R, date, ...extra });
const pay = (amount, date) => ({ type: "card_payment", amount: amount * R, date });
const SPEND = [
  card(500, "2026-11-10"),
  card(300, "2026-11-22"),
  card(777, "2026-09-30"), // before tracking started
  { type: "expense", payment_method: "upi", amount: 999 * R, date: "2026-11-11" },
  { type: "expense", payment_method: null, amount: 50 * R, date: "2026-11-12" },
];
const at = (today, transactions = SPEND, settings = SETTINGS) => cardBalance({ transactions, settings, today });

test("off without a statement day", () => {
  assert.equal(at("2026-11-25", SPEND, null), null);
  assert.equal(at("2026-11-25", SPEND, { ...SETTINGS, card_statement_day: null }), null);
});

test("this statement vs next statement; only card spend from the tracking date", () => {
  assert.deepEqual(at("2026-11-25"), {
    statement: 500 * R,
    next: 300 * R,
    total: 800 * R,
    credit: 0,
    statementDate: "2026-11-20",
    nextStatementDate: "2026-12-20",
    dueDate: "2026-12-05",
    overdue: false,
  });
  // On the statement day itself, that day's spend is on the statement.
  assert.equal(at("2026-11-20", [...SPEND, card(40, "2026-11-20")]).statement, 540 * R);
});

test("part payment rolls the rest over", () => {
  const b = at("2026-11-25", [...SPEND, pay(200, "2026-11-24")]);
  assert.equal(b.statement, 300 * R);
  assert.equal(b.next, 300 * R);
  assert.equal(b.total, 600 * R);
  assert.equal(b.dueDate, "2026-12-05");
});

test("paying more than the statement comes off the next one; once paid, the next due date shows", () => {
  const b = at("2026-11-25", [...SPEND, pay(700, "2026-11-24")]);
  assert.equal(b.statement, 0);
  assert.equal(b.next, 100 * R);
  assert.equal(b.total, 100 * R);
  assert.equal(b.dueDate, "2027-01-05");
});

test("overpaying leaves credit", () => {
  const b = at("2026-11-25", [...SPEND, pay(1000, "2026-11-24")]);
  assert.deepEqual([b.statement, b.next, b.total, b.credit], [0, 0, 0, 200 * R]);
});

test("payments before the tracking date don't count", () => {
  assert.equal(at("2026-11-25", [...SPEND, pay(500, "2026-09-20")]).statement, 500 * R);
});

test("unpaid after the due date is overdue; a new statement carries it over", () => {
  const b = at("2026-12-07");
  assert.equal(b.overdue, true);
  assert.equal(b.dueDate, "2026-12-05");
  const later = at("2026-12-21");
  assert.equal(later.statement, 800 * R, "both statements now");
  assert.equal(later.next, 0);
  assert.equal(later.dueDate, "2027-01-05");
  assert.equal(later.overdue, false);
});

test("opening balance and a later tracking date", () => {
  const s = { ...SETTINGS, card_tracking_since: "2026-11-15", card_opening_balance: 1000 * R };
  const b = at("2026-11-25", [...SPEND, card(50, "2026-11-16")], s);
  assert.equal(b.statement, 1050 * R, "opening ₹1,000 + ₹50; the 10 Nov spend is before tracking");
  assert.equal(b.next, 300 * R);
});

test("recurring entries paid by card count; a card entry switched to UPI doesn't", () => {
  const rec = card(1200, "2026-11-05", { source: "recurring", external_id: "recurring:r3:2026-11" });
  assert.equal(at("2026-11-25", [...SPEND, rec]).statement, 1700 * R);
  assert.equal(at("2026-11-25", [...SPEND, { ...rec, payment_method: "upi" }]).statement, 500 * R);
});

test("day 31 and short months", () => {
  assert.equal(lastOn("2027-02-27", 31), "2027-01-31");
  assert.equal(lastOn("2027-02-28", 31), "2027-02-28");
  assert.equal(lastOn("2028-02-29", 30), "2028-02-29");
  assert.equal(nextOn("2027-01-31", 31), "2027-02-28");
  assert.equal(nextOn("2026-12-31", 5), "2027-01-05");
  assert.equal(lastOn("2027-01-03", 20), "2026-12-20");
  const s = { ...SETTINGS, card_statement_day: 31, card_due_day: 30 };
  const b = at("2027-02-28", [card(100, "2027-02-28")], s);
  assert.equal(b.statementDate, "2027-02-28");
  assert.equal(b.dueDate, "2027-03-30");
  assert.equal(b.nextStatementDate, "2027-03-31");
});

test("a card payment never touches safe to spend, the until-payday line, Reports or spend by method", () => {
  const demo = demoAccount();
  const withPay = { ...demo, transactions: [...demo.transactions, pay(5000, "2026-11-15")] };
  const a = buildCycleModel(demo),
    b = buildCycleModel(withPay);
  assert.equal(b.safe, a.safe);
  assert.equal(b.unpaidBills, a.unpaidBills);
  const line = (input) => {
    const { spendOn, ...rest } = projectUntilPayday(input); // spendOn: a new closure each call
    return rest;
  };
  assert.deepEqual(line({ ...withPay, model: b }), line({ ...demo, model: a }));
  const hist = (transactions) =>
    cycleHistory({ transactions, categories: demo.categories, schedule: [{ payDay: 1 }], today: demo.today, count: 2 }).map(
      ({ entries, ...rest }) => ({ ...rest, byCat: [...rest.byCat] }),
    );
  assert.deepEqual(hist(withPay.transactions), hist(demo.transactions));
  assert.deepEqual(spendByMethod(withPay.transactions), spendByMethod(demo.transactions));
});
