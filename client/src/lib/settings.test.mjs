import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPlan,
  avatarProblem,
  deleteAccount,
  exportAllCsv,
  nextCycleStart,
  payDayPreview,
  payDayStatus,
  pendingPlan,
  planHistory,
  saveCard,
  archiveCard,
  savePreferences,
} from "./settings.mjs";

/** Records rpc and storage calls; serves `rows` in pages for from("transactions"). */
function fakeSupabase({ rows = [], rpcError = null, files = [], listError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => (calls.push([name, args]), { error: rpcError }),
    auth: { signOut: async () => calls.push(["signOut"]) },
    storage: {
      from: () => ({
        list: async (dir) => (calls.push(["list", dir]), { data: files.map((name) => ({ name })), error: listError }),
        remove: async (paths) => (calls.push(["remove", paths]), { error: null }),
      }),
    },
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

test("saveCard adds or edits a card, with the handoff's name errors; archiveCard archives", async () => {
  const calls = [];
  let result = { data: { id: "c9" }, error: null };
  const query = {
    insert: (row) => (calls.push(["insert", row]), query),
    update: (row) => (calls.push(["update", row]), query),
    eq: (k, v) => (calls.push(["eq", k, v]), query),
    select: () => query,
    single: async () => result,
  };
  const sb = { from: (t) => (calls.push(["from", t]), query) };

  assert.deepEqual(await saveCard(sb, { name: "  HDFC Regalia ", statementDay: 20, dueDay: 31, opening: 1250000 }), {
    id: "c9",
    error: null,
  });
  await saveCard(sb, { id: "c9", name: "HDFC", statementDay: 1, dueDay: 18, reminders: false });
  assert.deepEqual(calls, [
    ["from", "credit_cards"],
    ["insert", { name: "HDFC Regalia", statement_day: 20, due_day: 31, opening_balance: 1250000, reminders: true }],
    ["from", "credit_cards"],
    ["update", { name: "HDFC", statement_day: 1, due_day: 18, opening_balance: 0, reminders: false }],
    ["eq", "id", "c9"],
  ]);

  assert.equal(
    (await saveCard(sb, { name: " ", statementDay: 1, dueDay: 1 })).error.message,
    "Give the card a name so you can tell it apart.",
  );
  result = { data: null, error: { code: "23505", message: "duplicate key" } };
  assert.equal(
    (await saveCard(sb, { name: "HDFC", statementDay: 1, dueDay: 1 })).error.message,
    "You already have a card with this name.",
  );

  calls.length = 0;
  archiveCard(sb, "c9");
  assert.equal(calls[1][0], "update");
  assert.match(calls[1][1].archived_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(calls[2], ["eq", "id", "c9"]);
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

test("deleteAccount removes the photo first and signs out only after the account is gone", async () => {
  const ok = fakeSupabase({ files: ["1.png"] });
  assert.deepEqual(await deleteAccount(ok, "u1"), { error: null });
  assert.deepEqual(ok.calls, [["list", "u1"], ["remove", ["u1/1.png"]], ["delete_my_account", undefined], ["signOut"]]);
  const failed = fakeSupabase({ rpcError: { message: "nope" } });
  assert.deepEqual(await deleteAccount(failed, "u1"), { error: { message: "nope" } });
  assert.deepEqual(
    failed.calls,
    [
      ["list", "u1"],
      ["delete_my_account", undefined],
    ],
    "no sign-out when the delete failed",
  );
  const noPhoto = fakeSupabase({ listError: { message: "offline" } });
  assert.deepEqual(await deleteAccount(noPhoto, "u1"), { error: { message: "offline" } });
  assert.equal(noPhoto.calls.length, 1, "the account stays when its photo couldn't be removed");
});

test("payday preview: this cycle keeps its start, next cycle keeps the 15-day minimum", () => {
  // 25th -> 1st on 28 Nov.
  assert.deepEqual(payDayPreview([{ payDay: 25 }], "2026-11-28", 1), {
    now: { startStr: "2026-11-25", endStr: "2026-11-30" },
    next: { startStr: "2026-12-25", endStr: "2027-01-31" },
  });
});

const changes = [
  {
    field: "salary",
    to_value: 7800000,
    applies: "start",
    effective_from: "2026-09-10",
    created_at: "2026-09-10T09:30:00Z",
  },
  { field: "payday", to_value: 1, applies: "start", effective_from: "2026-09-10", created_at: "2026-09-10T09:30:00Z" },
  {
    field: "save_pct",
    from_value: 15,
    to_value: 20,
    applies: "now",
    effective_from: "2026-11-01",
    created_at: "2026-11-05T09:00:00Z",
  },
  {
    field: "salary",
    from_value: 7800000,
    to_value: 8500000,
    applies: "next",
    effective_from: "2026-12-01",
    created_at: "2026-11-20T09:00:00Z",
  },
  {
    field: "payday",
    from_value: 1,
    to_value: 25,
    applies: "next",
    effective_from: "2026-12-01",
    superseded_at: "2026-11-20T09:00:00Z",
    created_at: "2026-11-10T09:00:00Z",
  },
];

test("plan history: newest first, onboarding as one row", () => {
  const h = planHistory({ plan_changes: changes });
  assert.deepEqual(
    h.map((r) => [r.date, r.field, r.from, r.to, r.applies, r.superseded]),
    [
      ["2026-11-20", "salary", 7800000, 8500000, "next", false],
      ["2026-11-10", "payday", 1, 25, "next", true],
      ["2026-11-05", "save_pct", 15, 20, "now", false],
      ["2026-09-10", "created", null, null, "start", false],
    ],
  );
  assert.deepEqual(planHistory(null), []);
});

test("pending plan: only next-cycle changes still waiting", () => {
  assert.deepEqual(pendingPlan({ plan_changes: changes }, "2026-11-28"), { salary: "2026-12-01" });
  assert.deepEqual(pendingPlan({ plan_changes: changes }, "2026-12-01"), {});
});

test("photo checks", () => {
  assert.equal(avatarProblem({ type: "image/png", size: 1000 }), null);
  assert.match(avatarProblem({ type: "image/gif", size: 1000 }), /PNG, JPG or WebP/);
  assert.match(avatarProblem({ type: "image/jpeg", size: 3 * 1024 * 1024 }), /over 2 MB/);
});

test("device names from a user agent", async () => {
  const { deviceName, isMobile, hourLabel, quietLength } = await import("./settings.mjs");
  const mac =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  assert.equal(deviceName(mac), "Chrome on macOS");
  assert.equal(deviceName(iphone), "Safari on iPhone");
  assert.equal(
    deviceName("Mozilla/5.0 (Windows NT 10.0; rv:133.0) Gecko/20100101 Firefox/133.0"),
    "Firefox on Windows",
  );
  assert.equal(deviceName(null), "Unknown browser");
  assert.equal(isMobile(iphone), true);
  assert.equal(isMobile(mac), false);
  assert.equal(hourLabel(0), "12:00 am");
  assert.equal(hourLabel(22), "10:00 pm");
  assert.equal(quietLength(22, 8), 10);
  assert.equal(quietLength(9, 9), 24);
});

test("plan history: a base currency switch and its salary row carry their currencies", () => {
  const rows = planHistory({
    plan_changes: [
      {
        field: "currency",
        from_text: "INR",
        to_text: "USD",
        applies: "next",
        effective_from: "2026-12-01",
        created_at: "2026-11-24T10:00:00Z",
      },
      {
        field: "salary",
        from_value: 10000000,
        to_value: 120000,
        from_text: "INR",
        to_text: "USD",
        applies: "now",
        effective_from: "2026-12-01",
        created_at: "2026-12-01T05:00:00Z",
      },
    ],
  });
  assert.deepEqual(
    rows.map((r) => [r.field, r.from, r.to, r.fromText, r.toText]),
    [
      ["salary", 10000000, 120000, "INR", "USD"],
      ["currency", null, null, "INR", "USD"],
    ],
  );
});
