import test from "node:test";
import assert from "node:assert/strict";
import { analyticsAllowed, consentCookie, parseConsent, saveConsent } from "./consent.mjs";

test("parseConsent reads sf_consent from a cookie string; anything unknown counts as no choice", () => {
  assert.deepEqual(parseConsent("a=1; sf_consent=v1.a1.2026-11-26; b=2"), { analytics: true, date: "2026-11-26" });
  assert.deepEqual(parseConsent("sf_consent=v1.a0.2026-11-26"), { analytics: false, date: "2026-11-26" });
  assert.equal(parseConsent(""), null, "no cookie: no choice yet");
  assert.equal(parseConsent("sf_consent=v2.a1.2026-11-26"), null, "another version asks again");
  assert.equal(parseConsent("sf_consent=yes"), null);
  assert.equal(parseConsent("xsf_consent=v1.a1.2026-11-26"), null, "only the exact name");
});

test("analytics only with an explicit yes", () => {
  assert.equal(analyticsAllowed("sf_consent=v1.a1.2026-11-26"), true);
  assert.equal(analyticsAllowed("sf_consent=v1.a0.2026-11-26"), false);
  assert.equal(analyticsAllowed(""), false, "no choice yet: off");
  assert.equal(analyticsAllowed("sf_consent=garbage"), false);
});

test("consentCookie: first-party, whole site, 180 days, Lax; Secure on https", () => {
  assert.equal(
    consentCookie(true, "2026-11-26", true),
    "sf_consent=v1.a1.2026-11-26; Path=/; Max-Age=15552000; SameSite=Lax; Secure",
  );
  assert.equal(consentCookie(false, "2026-11-26", false), "sf_consent=v1.a0.2026-11-26; Path=/; Max-Age=15552000; SameSite=Lax");
  assert.deepEqual(parseConsent(consentCookie(true, "2026-11-26", true).split(";")[0]), {
    analytics: true,
    date: "2026-11-26",
  });
});

test("saveConsent writes the cookie (or clears it) and tells the page", () => {
  const doc = { cookie: "" };
  const events = [];
  const win = { location: { protocol: "https:" }, dispatchEvent: (e) => events.push(e.type) };
  saveConsent(false, "2026-11-26", doc, win);
  assert.equal(doc.cookie, "sf_consent=v1.a0.2026-11-26; Path=/; Max-Age=15552000; SameSite=Lax; Secure");
  saveConsent(null, "2026-11-26", doc, win);
  assert.equal(doc.cookie, "sf_consent=; Path=/; Max-Age=0; SameSite=Lax; Secure", "withdrawn: no choice again");
  assert.deepEqual(events, ["sf-consent", "sf-consent"]);
});
