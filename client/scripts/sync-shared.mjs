// Copies the budget maths the hourly notification job needs (the weekly summary's safe to spend)
// from client/src/lib into server/supabase/functions/_shared/budget, so the job and the Dashboard
// compute it the same way. Run after changing any of these files: `npm run sync:shared -w client`.
// server/supabase/functions/_shared/budget/shared.test.mjs fails if a copy drifts.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SHARED = ["cycleModel.mjs", "recurringStatus.mjs", "cycle.mjs", "periods.mjs", "plan.mjs", "cardBalance.mjs"];

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "src", "lib");
const to = join(here, "..", "..", "server", "supabase", "functions", "_shared", "budget");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(to, { recursive: true });
  for (const f of SHARED) copyFileSync(join(from, f), join(to, f));
  console.log(`Copied ${SHARED.length} files to ${to}`);
}
