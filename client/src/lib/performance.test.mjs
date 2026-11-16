import test from "node:test";
import assert from "node:assert/strict";
import { computePerformance, comparePeriods, pctChange } from "./performance.mjs";

const month = (monthKey, { reg = 0, vari = 0, fixed = 0, flex = 0, sav = 0 } = {}) => ({
  monthKey,
  monthLabel: monthKey,
  regularIncome: reg,
  variableIncome: vari,
  fixedExpenses: fixed,
  flexibleExpenses: flex,
  totalExpenses: fixed + flex,
  savingsContributions: sav,
  baselineSavingsRate: reg > 0 ? (sav / reg) * 100 : 0,
});

test("no activity means no indicators", () => {
  assert.equal(computePerformance([month("2026-09"), month("2026-10")]), null);
});

test("averages skip empty months and the savings rate ignores variable pay", () => {
  const p = computePerformance([
    month("2026-08"),
    month("2026-09", { reg: 100_000, fixed: 30_000, flex: 20_000, sav: 10_000 }),
    month("2026-10", { reg: 100_000, vari: 500_000, fixed: 30_000, flex: 40_000, sav: 30_000 }),
  ]);
  assert.equal(p.monthsCounted, 2);
  assert.equal(p.avgExpenses, 60_000);
  assert.equal(p.avgSavings, 20_000);
  assert.equal(p.avgSavingsRate, 20);
  assert.equal(p.highestSpendMonth.monthKey, "2026-10");
  assert.equal(p.bestSavingsMonth.monthKey, "2026-10");
  assert.equal(p.flexibleChangePct, 100);
});

test("flexible change needs two months and a non-zero base", () => {
  assert.equal(computePerformance([month("2026-10", { flex: 5 })]).flexibleChangePct, null);
  assert.equal(computePerformance([month("2026-09", { reg: 1 }), month("2026-10", { flex: 5 })]).flexibleChangePct, null);
});

test("period comparison", () => {
  const prev = [month("2026-07", { reg: 100, flex: 100, sav: 10 })];
  const cur = [month("2026-10", { reg: 100, flex: 80, sav: 20 })];
  assert.deepEqual(comparePeriods(cur, prev), { expensesChangePct: -20, savingsChangePct: 100, savingsRateChangePts: 10 });
  assert.equal(comparePeriods(cur, [month("2026-07")]), null);
  assert.equal(pctChange(5, 0), null);
});
