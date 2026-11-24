import test from "node:test";
import assert from "node:assert/strict";
import { subscriptionGone, TEST_EVERY_MS, TEST_PUSH, testProblem } from "./pushTest.mjs";

const ok = { userId: "u1", endpoint: "https://push.example.com/abc", now: 1_000_000 };

test("a signed-in user with this device's endpoint can send a test", () => {
  assert.equal(testProblem(ok), null);
  assert.equal(testProblem({ ...ok, lastSentAt: ok.now - TEST_EVERY_MS }), null);
});

test("no user, no endpoint, or a non-https endpoint is refused", () => {
  assert.equal(testProblem({ ...ok, userId: null })?.status, 401);
  assert.equal(testProblem({ ...ok, endpoint: undefined })?.status, 400);
  assert.equal(testProblem({ ...ok, endpoint: "http://push.example.com/abc" })?.status, 400);
  assert.equal(testProblem({ ...ok, endpoint: `https://${"a".repeat(1000)}` })?.status, 400);
});

test("a second test within 30 seconds waits", () => {
  assert.equal(testProblem({ ...ok, lastSentAt: ok.now - 5_000 })?.status, 429);
});

test("404 and 410 from the push service mean the subscription is gone", () => {
  assert.equal(subscriptionGone({ statusCode: 410 }), true);
  assert.equal(subscriptionGone({ statusCode: 404 }), true);
  assert.equal(subscriptionGone({ statusCode: 500 }), false);
  assert.equal(subscriptionGone(new Error("network")), false);
});

test("the test notification copy matches the handoff", () => {
  assert.equal(TEST_PUSH.title, "Test from SaveFirst");
  assert.equal(TEST_PUSH.body, "Push notifications work on this device.");
});
