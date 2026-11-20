import test from "node:test";
import assert from "node:assert/strict";
import { errorFields, record, scrub } from "./log.mjs";

test("scrub removes emails and long numbers", () => {
  assert.equal(scrub("login failed for priya@example.com"), "login failed for [email]");
  assert.equal(scrub("amount 1,20,000 too big"), "amount [n] too big");
  assert.equal(scrub("card 4111 1111 1111 1111"), "card [n]");
  assert.equal(scrub("error 42"), "error 42", "short codes stay");
  assert.equal(scrub("x".repeat(900)).length, 500, "capped");
});

test("only allow-listed fields are logged; numbers stay numbers", () => {
  const r = record("error", "save_failed", {
    route: "/dashboard",
    ms: 120,
    email: "priya@example.com",
    amount: 9500000,
    note: "rent for flat 4B",
    message: "duplicate key for priya@example.com",
  });
  assert.equal(r.level, "error");
  assert.equal(r.event, "save_failed");
  assert.equal(r.route, "/dashboard");
  assert.equal(r.ms, 120);
  assert.equal(r.message, "duplicate key for [email]");
  for (const k of ["email", "amount", "note"]) assert.ok(!(k in r), `${k} is never logged`);
});

test("errorFields handles Errors and Supabase errors", () => {
  assert.deepEqual(Object.keys(errorFields(new TypeError("boom"))), ["name", "message", "stack"]);
  assert.deepEqual(errorFields({ code: "23505", message: "duplicate" }), { code: "23505", message: "duplicate" });
  assert.deepEqual(errorFields("plain"), { code: undefined, message: "plain" });
});
