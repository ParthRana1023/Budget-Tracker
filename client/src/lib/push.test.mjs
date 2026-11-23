import test from "node:test";
import assert from "node:assert/strict";
import { pushState, vapidKeyBytes } from "./push.mjs";

test("push state: iPhone in a tab must install first, then support and permission", () => {
  const base = { supported: true, ios: false, standalone: false, permission: "default" };
  assert.equal(pushState(base), "available");
  assert.equal(pushState({ ...base, permission: "granted" }), "available");
  assert.equal(pushState({ ...base, permission: "denied" }), "blocked");
  assert.equal(pushState({ ...base, supported: false }), "unsupported");
  assert.equal(pushState({ ...base, ios: true, supported: false }), "ios-install", "Safari tab hides PushManager");
  assert.equal(pushState({ ...base, ios: true, standalone: true }), "available");
  assert.equal(pushState({ ...base, ios: true, standalone: true, supported: false }), "unsupported", "iOS before 16.4");
});

test("VAPID key: base64url without padding to bytes", () => {
  const bytes = new Uint8Array(65).map((_, i) => (i * 37) % 256);
  const key = Buffer.from(bytes).toString("base64url");
  assert.ok(!key.includes("="));
  assert.deepEqual(vapidKeyBytes(key), bytes);
});
