import test from "node:test";
import assert from "node:assert/strict";
import { buildCycleModel } from "./cycleModel.mjs";
import { monotonePath, projectUntilPayday } from "./untilPayday.mjs";
import { demoAccount, R } from "./demoAccount.fixture.mjs";

const DEMO = demoAccount();
const run = (over = {}) => projectUntilPayday({ ...DEMO, model: buildCycleModel(DEMO), ...over });

test("demo account: today, opening amount and payday", () => {
  const p = run({ weekPattern: false });
  assert.equal(p.todayValue, 22300 * R, "₹16,800 safe + ₹5,500 kept for bills");
  assert.equal(p.openValue, 65000 * R, "salary minus savings on the 1st");
  assert.equal(p.pace, (12900 * R) / 16, "recurring entries are not part of the daily pace");
  assert.equal(p.bills.get(20)[0].name, "Electricity");
  assert.equal(p.bills.get(25).length, 1, "Insurance is counted once, via its fixed bill, not again as recurring");
  assert.ok(Math.abs(p.finalValue - (22300 * R - p.pace * 14 - 5500 * R)) < 1);
  assert.equal(p.shortDay, null);
  assert.equal(p.sliderMax, Math.ceil((p.pace * 2) / 50000) * 50000);
});

test("'My week' reshapes the days but lands on the same payday amount", () => {
  const even = run({ weekPattern: false }), week = run({ weekPattern: true });
  assert.ok(Math.abs(even.finalValue - week.finalValue) < 1);
  const daily = [17, 18, 19, 20, 21, 22, 23].map((k) => week.spendOn(k));
  assert.ok(Math.max(...daily) > Math.min(...daily), "weekdays differ when there is a pattern");
});

test("spending faster runs short, and overdue bills come off tomorrow", () => {
  const fast = run({ dailySpend: 2000 * R, weekPattern: false });
  assert.equal(fast.shortDay, 25, "₹2,000 a day runs out on the insurance due day");
  const late = run({ ...DEMO, today: "2026-11-22", period: { ...DEMO.period, daysElapsed: 22 }, weekPattern: false });
  assert.equal(late.bills.get(23).find((b) => b.name === "Electricity")?.overdue, true);
});

test("monotonePath never overshoots its points", () => {
  const pts = [[0, 10], [10, 10], [20, 40], [30, 45], [40, 90], [50, 92]];
  const nums = monotonePath(pts).replace(/[MC]/g, " ").trim().split(/[\s]+/).map(Number);
  // M x0 y0, then per segment: cx1 cy1 cx2 cy2 x y
  for (let i = 0; i < pts.length - 1; i++) {
    const [, cy1, , cy2] = nums.slice(2 + i * 6, 2 + i * 6 + 4);
    const lo = Math.min(pts[i][1], pts[i + 1][1]), hi = Math.max(pts[i][1], pts[i + 1][1]);
    assert.ok(cy1 >= lo - 1e-9 && cy1 <= hi + 1e-9 && cy2 >= lo - 1e-9 && cy2 <= hi + 1e-9, `segment ${i} stays within its ends`);
  }
  assert.equal(monotonePath([[0, 1]]), "M0 1");
  assert.equal(monotonePath([]), "");
});
