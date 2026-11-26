import test from "node:test";
import assert from "node:assert/strict";
import { cardHistory, cardStatus, cardsSummary, lastOn, nextOn } from "./cards.mjs";
import { buildCycleModel } from "./cycleModel.mjs";
import { cycleHistory } from "./reports.mjs";
import { projectUntilPayday } from "./untilPayday.mjs";
import { spendByMethod } from "./paymentMethods.mjs";
import { demoAccount, R } from "./demoAccount.fixture.mjs";

const CARD = { id: "c1", name: "HDFC Regalia", statement_day: 20, due_day: 5, opening_balance: 0 };
const spend = (amount, date, card_id = "c1", extra = {}) => ({
  type: "expense",
  payment_method: "credit_card",
  card_id,
  amount: amount * R,
  date,
  ...extra,
});
const pay = (amount, date, card_id = "c1") => ({ type: "card_payment", card_id, amount: amount * R, date });
const SPEND = [
  spend(500, "2026-11-10"),
  spend(300, "2026-11-22"),
  spend(777, "2026-11-11", "c2"), // another card
  { type: "expense", payment_method: "upi", card_id: null, amount: 999 * R, date: "2026-11-11" },
  { type: "expense", payment_method: "credit_card", card_id: null, amount: 50 * R, date: "2026-11-12" }, // no card
];
const at = (today, entries = SPEND, card = CARD) => cardStatus(card, entries, today);

test("owed, this statement and its due date; only this card's spend", () => {
  const s = at("2026-11-25");
  assert.equal(s.owed, 800 * R);
  assert.equal(s.statement, 500 * R);
  assert.equal(s.statementDate, "2026-11-20");
  assert.equal(s.dueDate, "2026-12-05");
  assert.equal(s.daysToDue, 10);
  assert.equal(s.status, "due");
  assert.deepEqual([s.spend, s.spendCount, s.paid, s.payments], [800 * R, 2, 0, 0]);
  // On the statement day itself, that day's spend is on the statement.
  assert.equal(at("2026-11-20", [...SPEND, spend(40, "2026-11-20")]).statement, 540 * R);
});

test("due soon within 3 days, overdue once the due date passes unpaid", () => {
  assert.equal(at("2026-12-01").status, "due");
  assert.equal(at("2026-12-02").status, "soon");
  assert.equal(at("2026-12-05").status, "soon");
  const late = at("2026-12-09");
  assert.equal(late.status, "overdue");
  assert.equal(late.daysToDue, -4);
});

test("paid in full before the due date, then a new purchase: not overdue", () => {
  const card = { ...CARD, statement_day: 1, due_day: 18 };
  const entries = [spend(1000, "2026-10-25"), pay(1000, "2026-11-17"), spend(200, "2026-11-19")];
  const s = cardStatus(card, entries, "2026-11-20");
  assert.equal(s.statement, 0);
  assert.equal(s.owed, 200 * R);
  assert.equal(s.status, "due");
  assert.equal(s.dueDate, "2026-12-18", "the next statement's due date");
});

test("part payment leaves the rest on the statement; overpaying leaves credit", () => {
  const part = at("2026-11-25", [...SPEND, pay(200, "2026-11-24")]);
  assert.deepEqual([part.statement, part.owed], [300 * R, 600 * R]);
  const over = at("2026-11-25", [...SPEND, pay(1000, "2026-11-24")]);
  assert.deepEqual([over.statement, over.owed, over.status], [0, -200 * R, "credit"]);
  assert.equal(at("2026-11-25", [...SPEND, pay(800, "2026-11-24")]).status, "clear");
});

test("opening balance is on the first statement", () => {
  const s = at("2026-11-25", SPEND, { ...CARD, opening_balance: 1000 * R });
  assert.deepEqual([s.statement, s.owed, s.opening], [1500 * R, 1800 * R, 1000 * R]);
});

test("recurring entries tagged with the card count; an entry switched to UPI doesn't", () => {
  const rec = spend(1200, "2026-11-05", "c1", { source: "recurring" });
  assert.equal(at("2026-11-25", [...SPEND, rec]).statement, 1700 * R);
  assert.equal(at("2026-11-25", [...SPEND, { ...rec, payment_method: "upi", card_id: null }]).statement, 500 * R);
});

test("day 31 and short months", () => {
  assert.equal(lastOn("2027-02-27", 31), "2027-01-31");
  assert.equal(lastOn("2027-02-28", 31), "2027-02-28");
  assert.equal(nextOn("2027-01-31", 31), "2027-02-28");
  assert.equal(lastOn("2027-01-03", 20), "2026-12-20");
  const s = cardStatus({ ...CARD, statement_day: 31, due_day: 28 }, [spend(100, "2027-02-28")], "2027-02-28");
  assert.equal(s.statementDate, "2027-02-28");
  assert.equal(s.dueDate, "2027-03-28");
});

test("bill history: on time, late, and the open bill left out", () => {
  const entries = [
    spend(400, "2026-08-10"), // Aug bill, paid on time
    pay(400, "2026-09-01"),
    spend(300, "2026-09-10"), // Sep bill, paid late
    pay(300, "2026-10-09"),
    spend(200, "2026-10-10"), // Oct bill, never paid
    spend(100, "2026-11-10"), // Nov bill, due 5 Dec: still open
  ];
  const h = cardHistory(CARD, entries, "2026-11-25");
  assert.deepEqual(
    h.map((b) => [b.statementDate, b.dueDate, b.amount / R, b.onTime, b.state]),
    [
      ["2026-08-20", "2026-09-05", 400, true, "on_time"],
      ["2026-09-20", "2026-10-05", 300, false, "late"],
      ["2026-10-20", "2026-11-05", 200, false, "none"],
    ],
  );
  assert.equal(cardHistory(CARD, entries, "2026-11-25", 2).length, 2, "the last 2");
  assert.deepEqual(cardHistory(CARD, [], "2026-11-25"), []);
});

test("summary: archived cards left out, most urgent first, credit doesn't lower the total", () => {
  const cards = [
    { id: "c4", name: "Amex", statement_day: 15, due_day: 1, opening_balance: 0 },
    { id: "c2", name: "Axis Ace", statement_day: 1, due_day: 18, opening_balance: 0 },
    { id: "c3", name: "Old card", statement_day: 1, due_day: 10, opening_balance: 5000 * R, archived_at: "2026-11-01" },
    CARD,
  ];
  const sum = cardsSummary(cards, [...SPEND, pay(35, "2026-11-20", "c4")], "2026-12-09");
  assert.deepEqual(
    sum.cards.map((c) => [c.name, c.status]),
    [
      ["HDFC Regalia", "overdue"],
      ["Axis Ace", "due"],
      ["Amex", "credit"],
    ],
  );
  assert.equal(sum.total, (800 + 777) * R);
  assert.equal(sum.urgent?.name, "HDFC Regalia");
  assert.deepEqual(cardsSummary([], [], "2026-12-09"), { cards: [], total: 0, urgent: null });
});

test("a card payment never touches safe to spend, category totals, the until-payday line, Reports or spend by method", () => {
  const demo = demoAccount();
  const withPay = { ...demo, transactions: [...demo.transactions, pay(5000, "2026-11-15")] };
  const a = buildCycleModel(demo),
    b = buildCycleModel(withPay);
  assert.equal(b.safe, a.safe);
  assert.equal(b.unpaidBills, a.unpaidBills);
  assert.deepEqual([...b.spentByCat], [...a.spentByCat]);
  const line = (input) => {
    const { spendOn, ...rest } = projectUntilPayday(input); // spendOn: a new closure each call
    return rest;
  };
  assert.deepEqual(line({ ...withPay, model: b }), line({ ...demo, model: a }));
  const hist = (transactions) =>
    cycleHistory({
      transactions,
      categories: demo.categories,
      schedule: [{ payDay: 1 }],
      today: demo.today,
      count: 2,
    }).map(({ entries, ...rest }) => ({ ...rest, byCat: [...rest.byCat] }));
  assert.deepEqual(hist(withPay.transactions), hist(demo.transactions));
  assert.deepEqual(spendByMethod(withPay.transactions), spendByMethod(demo.transactions));
});
