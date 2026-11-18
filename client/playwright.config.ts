import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The specs sign up throwaway users, so they must never reach the hosted Supabase.
// Same lookup order as Next: the shell env wins, then .env.local.
function supabaseUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  const file = path.join(__dirname, ".env.local");
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^"'\s]+)/m);
  return m?.[1];
}
const url = supabaseUrl();
let host = "";
try {
  host = url ? new URL(url).hostname : "";
} catch {}
if (host !== "localhost" && host !== "127.0.0.1") {
  throw new Error(
    `E2E refused: NEXT_PUBLIC_SUPABASE_URL is "${url ?? "unset"}", not a local Supabase. ` +
      "Run `npx supabase start --workdir server` from the repo root and export its API_URL and PUBLISHABLE_KEY " +
      "as NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY first.",
  );
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3124",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    // Build here so the bundle uses the Supabase URL checked above; never reuse a
    // running server, which may have been built against the hosted project.
    // Own port, so a `next dev` on 3000 can stay up.
    command: "npm run build && npm run start -- -p 3124",
    url: "http://localhost:3124",
    reuseExistingServer: false,
    timeout: 300000,
  },
});
