import test from "node:test";
import assert from "node:assert/strict";
import { planSplit, shareOut, splitGoal, splitShares } from "./goalSplit.mjs";

const sum = (a) => a.reduce((s, x) => s + x, 0);

test("shareOut: whole units that add up exactly, remainders to the largest fractions", () => {
  assert.deepEqual(shareOut(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(shareOut(10, [1, 2]), [3, 7]);
  assert.deepEqual(shareOut(0, [1, 1]), [0, 0]);
  assert.deepEqual(shareOut(5, [0, 0]), [0, 0]);
  assert.deepEqual(shareOut(7, [0, 3]), [0, 7]);
  // ₹1 crore across targets in the crores: no floating-point drift.
  const big = shareOut(1_000_000_000, [9_000_000_000_000, 1_000_000_000_000, 7]);
  assert.equal(sum(big), 1_000_000_000);
  assert.equal(big[0], 900_000_000, "899,999,999.37 rounds up: it has the largest remainder");
});

test("splitShares: equally, by target, or the user's own amounts", () => {
  const targets = [6_000_000, 4_000_000, 2_000_000]; // ₹60k, ₹40k, ₹20k
  assert.deepEqual(splitShares(2_800_000, "equal", targets), [933_334, 933_333, 933_333]);
  assert.deepEqual(splitShares(2_800_000, "target", targets), [1_400_000, 933_333, 466_667]);
  assert.deepEqual(splitShares(2_800_000, "custom", targets, [2_800_000, 0, 0]), [2_800_000, 0, 0], "all into one");
  assert.deepEqual(splitShares(2_800_000, "custom", targets, [1_000_000, 1_800_000, 0]), [1_000_000, 1_800_000, 0]);
  assert.equal(splitShares(2_800_000, "custom", targets, [1_000_000, 1_000_000, 0]), null, "doesn't add up");
  assert.equal(splitShares(100, "custom", targets, [100, -1, 1]), null, "negative");
  assert.equal(splitShares(100, "custom", targets, [99.5, 0.5, 0]), null, "not whole units");
  assert.equal(splitShares(100, "custom", targets, [100]), null, "one amount per sub-goal");
});

test("planSplit: each sub-goal gets exactly its share; contributions split in proportion", () => {
  const contributions = [
    { id: "c1", amount: 500_000 },
    { id: "c2", amount: 300_000 },
  ];
  const shares = splitShares(2_800_000, "target", [6_000_000, 4_000_000, 2_000_000]);
  const plan = planSplit({ savedBefore: 2_000_000, contributions, shares });
  assert.deepEqual(plan.contributions, [
    { id: "c1", parts: [250_000, 166_667, 83_333] },
    { id: "c2", parts: [150_000, 100_000, 50_000] },
  ]);
  assert.deepEqual(plan.savedBefore, [1_000_000, 666_666, 333_334]);
  shares.forEach((a, i) => assert.equal(plan.savedBefore[i] + sum(plan.contributions.map((r) => r.parts[i])), a));
});

test("planSplit: all into one sub-goal moves everything whole", () => {
  const plan = planSplit({ savedBefore: 7, contributions: [{ id: "c", amount: 3 }], shares: [0, 10] });
  assert.deepEqual(plan, { savedBefore: [0, 7], contributions: [{ id: "c", parts: [0, 3] }] });
});

test("planSplit: with nothing saved before, rounding is evened out inside the contributions", () => {
  // 1 + 1 + 1 split 2:1 per row rounds to [1, 0] three times: the first sub-goal would be 1 over.
  const contributions = ["a", "b", "c"].map((id) => ({ id, amount: 1 }));
  const plan = planSplit({ savedBefore: 0, contributions, shares: [2, 1] });
  assert.deepEqual(plan.savedBefore, [0, 0]);
  assert.deepEqual(
    [sum(plan.contributions.map((r) => r.parts[0])), sum(plan.contributions.map((r) => r.parts[1]))],
    [2, 1],
  );
});

test("planSplit: random plans never lose, make up or go below zero", () => {
  let seed = 7;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  for (let run = 0; run < 500; run++) {
    const n = 1 + rand(5);
    const contributions = Array.from({ length: rand(6) }, (_, j) => ({ id: `c${j}`, amount: 1 + rand(100_000) }));
    const savedBefore = rand(3) === 0 ? 0 : rand(1_000_000);
    const total = savedBefore + sum(contributions.map((c) => c.amount));
    const mode = ["equal", "target"][rand(2)];
    const shares = splitShares(total, mode, Array.from({ length: n }, () => 1 + rand(5_000_000)));
    const plan = planSplit({ savedBefore, contributions, shares });
    assert.equal(sum(plan.savedBefore), savedBefore);
    plan.savedBefore.forEach((x) => assert.ok(x >= 0));
    plan.contributions.forEach((r, j) => {
      assert.equal(sum(r.parts), contributions[j].amount);
      r.parts.forEach((x) => assert.ok(x >= 0));
    });
    shares.forEach((a, i) => assert.equal(plan.savedBefore[i] + sum(plan.contributions.map((r) => r.parts[i])), a));
  }
});

test("planSplit refuses shares that don't add up to the money held", () => {
  assert.throws(() => planSplit({ savedBefore: 10, contributions: [], shares: [5, 4] }));
});

test("splitGoal sends the sub-goals with their 'already saved' share and the contribution parts", async () => {
  const calls = [];
  const sb = { rpc: async (...a) => (calls.push(a), { data: [], error: null }) };
  const plan = { savedBefore: [7, 0], contributions: [{ id: "c", parts: [0, 3] }] };
  await splitGoal(sb, "g1", [{ name: "A", target_amount: 100 }, { name: "B", target_amount: 50, target_date: null }], plan);
  assert.deepEqual(calls, [
    [
      "split_goal",
      {
        p_goal_id: "g1",
        p_sub_goals: [
          { name: "A", target_amount: 100, saved_before: 7 },
          { name: "B", target_amount: 50, target_date: null, saved_before: 0 },
        ],
        p_contributions: [{ id: "c", parts: [0, 3] }],
      },
    ],
  ]);
});
