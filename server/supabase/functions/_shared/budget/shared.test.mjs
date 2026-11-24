import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHARED } from "../../../../../client/scripts/sync-shared.mjs";

// These are copies of client/src/lib files (the Dashboard's budget maths) for the notification
// job. Edit the client file, then run `npm run sync:shared -w client`.
const here = dirname(fileURLToPath(import.meta.url));
const lib = join(here, "..", "..", "..", "..", "..", "client", "src", "lib");

for (const f of SHARED)
  test(`_shared/budget/${f} matches client/src/lib/${f}`, () => {
    assert.equal(readFileSync(join(here, f), "utf8"), readFileSync(join(lib, f), "utf8"));
  });
