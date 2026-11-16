import test from "node:test";
import assert from "node:assert/strict";
import { formatINRCompact } from "./chartTheme.mjs";

test("compact INR uses Indian units from paise", () => {
  assert.equal(formatINRCompact(0), "₹0");
  assert.equal(formatINRCompact(50_000), "₹500");
  assert.equal(formatINRCompact(1_250_000), "₹12.5k");
  assert.equal(formatINRCompact(10_000_000), "₹1L");
  assert.equal(formatINRCompact(25_600_000), "₹2.6L");
  assert.equal(formatINRCompact(1_500_000_000), "₹1.5Cr");
});

test("compact INR keeps the sign for deficits", () => {
  assert.equal(formatINRCompact(-350_000), "-₹3.5k");
});
