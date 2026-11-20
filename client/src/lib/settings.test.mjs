import test from "node:test";
import assert from "node:assert/strict";
import { applyPlan, deleteAccount, exportAllCsv, nextCycleStart, payDayStatus, savePreferences } from "./settings.mjs";

/** Records rpc calls; serves `rows` in pages for from("transactions"). */
function fakeSupabase({ rows = [], rpcError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => (calls.push([name, args]), { error: rpcError }),
    auth: { signOut: async () => calls.push(["signOut"]) },
    from: () => {
      const q = {
        select: () => q,
        order: () => q,
        range: async (a, b) => (calls.push(["range", a, b]), { data: rows.slice(a, b + 1), error: null }),
      };
      return q;
    },
  };
}

test("a new pay day starts at the next cycle", () => {
  assert.equal(nextCycleStart([{ payDay: 25 }], "2026-11-28"), "2026-12-25");
  assert.equal(nextCycleStart([{ payDay: 31 }], "2027-02-10"), "2027-02-28");
  // A pending change ends the current cycle early: the next cycle starts at it.
  assert.equal(nextCycleStart([{ payDay: 25 }, { payDay: 1, from: "2026-12-25" }], "2026-11-28"), "2026-12-25");
});

test("pay day in force today and a pending change", () => {
  const s = [{ payDay: 25 }, { payDay: 31, from: "2026-12-25" }];
  assert.deepEqual(payDayStatus(s, "2026-11-28"), { current: 25, pending: { payDay: 31, from: "2026-12-25" } });
  assert.deepEqual(payDayStatus(s, "2026-12-25"), { current: 31, pending: null });
  assert.deepEqual(payDayStatus([{ payDay: 1 }], "2026-11-28"), { current: 1, pending: null });
});

test("applyPlan starts at this cycle or the next one; savePreferences sends only its keys", async () => {
  const sb = fakeSupabase();
  await applyPlan(sb, { savePct: 25 }, "now", [{ payDay: 25 }], "2026-11-28");
  await applyPlan(sb, { payday: 31, salary: 8500000 }, "next", [{ payDay: 25 }], "2026-11-28");
  await savePreferences(sb, { theme: "system" });
  assert.deepEqual(sb.calls, [
    [
      "update_plan",
      { p_salary: null, p_payday: null, p_save_pct: 25, p_applies: "now", p_effective_from: "2026-11-25" },
    ],
    [
      "update_plan",
      { p_salary: 8500000, p_payday: 31, p_save_pct: null, p_applies: "next", p_effective_from: "2026-12-25" },
    ],
    ["update_preferences", { p_changes: { theme: "system" } }],
  ]);
});

test("export fetches every page, not just the first 1000 rows", async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => ({
    date: "2026-11-01",
    type: "expense",
    amount: 100,
    note: `n${i}`,
  }));
  const sb = fakeSupabase({ rows });
  const { csv, count, error } = await exportAllCsv(sb);
  assert.equal(error, null);
  assert.equal(count, 2345);
  assert.equal(csv.split("\r\n").length, 2346, "header + every row");
  assert.deepEqual(
    sb.calls.map((c) => c.slice(1)),
    [
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ],
  );
});

test("deleteAccount signs out only after the account is gone", async () => {
  const ok = fakeSupabase();
  assert.deepEqual(await deleteAccount(ok), { error: null });
  assert.deepEqual(ok.calls, [["delete_my_account", undefined], ["signOut"]]);
  const failed = fakeSupabase({ rpcError: { message: "nope" } });
  assert.deepEqual(await deleteAccount(failed), { error: { message: "nope" } });
  assert.deepEqual(failed.calls, [["delete_my_account", undefined]], "no sign-out when the delete failed");
});
