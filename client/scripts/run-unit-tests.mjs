// Runs every src/**/*.test.mjs under several timezones.
//
// Date logic that only passes in UTC is a bug waiting for a user in India or
// California, and CI machines default to UTC, so a single run proves nothing.
// UTC+5:30 (no DST), UTC-8/-7 (DST) and UTC+12/+13 (DST, southern hemisphere)
// between them cover the failure modes of "local vs UTC" mistakes.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const ZONES = ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Pacific/Auckland"];

const findTests = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return findTests(full);
    return name.endsWith(".test.mjs") ? [full] : [];
  });

const files = findTests(root);
if (files.length === 0) {
  console.error("No *.test.mjs files found under src/");
  process.exit(1);
}

let failed = [];
for (const tz of ZONES) {
  console.log(`\n=== TZ=${tz} ===`);
  const result = spawnSync(process.execPath, ["--test", ...files], { env: { ...process.env, TZ: tz }, stdio: "inherit" });
  if (result.status !== 0) failed.push(tz);
}

if (failed.length) {
  console.error(`\nUnit tests FAILED in: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nUnit tests passed in all ${ZONES.length} timezones.`);
