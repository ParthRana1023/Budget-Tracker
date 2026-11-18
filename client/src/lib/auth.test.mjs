import test from "node:test";
import assert from "node:assert/strict";
import { authErrorFor, errorFromQuery, isValidEmail, passwordScore } from "./auth.mjs";

test("password score drives the 4-segment meter", () => {
  assert.equal(passwordScore(""), 0);
  assert.equal(passwordScore("abc"), 1, "under 6 characters is always too weak");
  assert.equal(passwordScore("abcdef"), 1);
  assert.equal(passwordScore("abcdef1"), 2);
  assert.equal(passwordScore("abcdefghij1"), 3);
  assert.equal(passwordScore("Abcdefghij1!"), 4);
});

test("email check", () => {
  assert.ok(isValidEmail(" you@example.com "));
  assert.ok(!isValidEmail("you@example"));
  assert.ok(!isValidEmail(""));
});

test("Supabase errors map to the handoff's wording and actions", () => {
  assert.equal(authErrorFor({ code: "invalid_credentials", message: "Invalid login credentials" }).action, "forgot");
  assert.equal(authErrorFor({ code: "email_not_confirmed" }).action, "verify");
  assert.equal(authErrorFor({ code: "otp_expired" }).action, "resend");
  assert.match(
    authErrorFor({ name: "AuthRetryableFetchError", message: "Failed to fetch" }).message,
    /couldn’t reach SaveFirst/,
  );
  assert.equal(authErrorFor({ message: "Something specific" }).message, "Something specific");
  assert.match(authErrorFor(null).message, /Something went wrong/);
});

test("?error= on /login only accepts known codes", () => {
  assert.match(errorFromQuery("link_expired").message, /expired or is invalid/);
  assert.match(errorFromQuery("google_cancelled").message, /Google sign-in was cancelled/);
  assert.equal(errorFromQuery("<script>alert(1)</script>"), null);
  assert.equal(errorFromQuery(null), null);
});
