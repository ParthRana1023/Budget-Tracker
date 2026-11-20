import test from "node:test";
import assert from "node:assert/strict";
import { reportClientError } from "./log.mjs";

test("reportClientError sends payload via beacon or fetch without throwing", () => {
  let beaconCalled = false;
  let beaconUrl = "";

  const originalSendBeacon = globalThis.navigator?.sendBeacon;
  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: (url, blob) => {
      beaconCalled = true;
      beaconUrl = url;
      return true;
    },
    configurable: true,
    writable: true,
  });

  assert.doesNotThrow(() => {
    reportClientError("test_event", { route: "/test", message: "sample error" });
  });

  assert.equal(beaconCalled, true);
  assert.equal(beaconUrl, "/api/log");

  if (originalSendBeacon) {
    Object.defineProperty(globalThis.navigator, "sendBeacon", {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    });
  } else {
    delete globalThis.navigator.sendBeacon;
  }
});

test("reportClientError falls back to fetch if sendBeacon returns false or is absent", async () => {
  let fetchCalled = false;
  let fetchUrl = "";
  let fetchOpts = null;

  const originalSendBeacon = globalThis.navigator?.sendBeacon;
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: () => false,
    configurable: true,
    writable: true,
  });

  globalThis.fetch = async (url, opts) => {
    fetchCalled = true;
    fetchUrl = String(url);
    fetchOpts = opts;
    return new Response(null, { status: 204 });
  };

  assert.doesNotThrow(() => {
    reportClientError("fetch_fallback_event", { route: "/dashboard" });
  });

  assert.equal(fetchCalled, true);
  assert.equal(fetchUrl, "/api/log");
  assert.equal(fetchOpts?.keepalive, true);

  if (originalSendBeacon) {
    Object.defineProperty(globalThis.navigator, "sendBeacon", {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    });
  } else {
    delete globalThis.navigator.sendBeacon;
  }
  globalThis.fetch = originalFetch;
});

test("reportClientError never throws even when beacon and fetch both throw", () => {
  const originalSendBeacon = globalThis.navigator?.sendBeacon;
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis.navigator, "sendBeacon", {
    value: () => {
      throw new Error("beacon broken");
    },
    configurable: true,
    writable: true,
  });
  globalThis.fetch = () => {
    throw new Error("fetch broken");
  };

  assert.doesNotThrow(() => {
    reportClientError("broken_client", { route: "/broken" });
  });

  if (originalSendBeacon) {
    Object.defineProperty(globalThis.navigator, "sendBeacon", {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    });
  } else {
    delete globalThis.navigator.sendBeacon;
  }
  globalThis.fetch = originalFetch;
});
