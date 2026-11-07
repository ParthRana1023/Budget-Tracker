import assert from "node:assert/strict";
import test from "node:test";
import { computeCategoryBudgets } from "./categoryBudgets.mjs";

const cat = (id, limit, type = "flexible") => ({ id, name: id, type, monthly_limit: limit });
const exp = (category_id, amount) => ({ category_id, amount, type: "expense" });
const one = (limit, spent) => computeCategoryBudgets([cat("c", limit)], spent ? [exp("c", spent)] : [])[0];

test("a category with no limit set is never over budget, however much is spent", () => {
  const r = one(0, 123456);
  assert.equal(r.hasLimit, false);
  assert.equal(r.status, "safe");
  assert.equal(r.percentUsed, 0);
  assert.equal(r.remaining, 0);
  assert.equal(r.spent, 123456);
});

test("status thresholds: 74% safe, 75% warning, 90% danger, 100% exceeded", () => {
  assert.equal(one(10000, 7499).status, "safe");
  assert.equal(one(10000, 7500).status, "warning");
  assert.equal(one(10000, 8999).status, "warning");
  assert.equal(one(10000, 9000).status, "danger");
  assert.equal(one(10000, 9999).status, "danger");
  assert.equal(one(10000, 10000).status, "exceeded");
  assert.equal(one(10000, 15000).status, "exceeded");
});

test("remaining goes negative when over a real limit", () => {
  assert.equal(one(10000, 12500).remaining, -2500);
  assert.equal(one(10000, 4000).remaining, 6000);
});

test("only expenses in that category count", () => {
  const [a, b] = computeCategoryBudgets(
    [cat("a", 10000), cat("b", 10000)],
    [exp("a", 1000), exp("b", 2000), { category_id: "a", amount: 9999, type: "income" }, { category_id: "a", amount: 500, type: "savings_transfer" }, exp(null, 700)]
  );
  assert.equal(a.spent, 1000);
  assert.equal(b.spent, 2000);
});

test("amounts arriving as numeric strings (bigint columns) are summed correctly", () => {
  const [r] = computeCategoryBudgets([{ id: "c", name: "c", type: "fixed", monthly_limit: "5000" }], [{ category_id: "c", amount: "1250", type: "expense" }]);
  assert.equal(r.spent, 1250);
  assert.equal(r.monthlyLimit, 5000);
});
