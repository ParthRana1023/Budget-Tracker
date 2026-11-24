import { expect, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { DEFAULT_BILLS, ONBOARDING_CATEGORIES, onboardingPayload } from "../src/lib/onboarding.mjs";

/**
 * Specs that sign up need a real Supabase with the redesign migrations applied and email
 * confirmation DISABLED: the local stack (`npx supabase start --workdir server`, see
 * server/supabase/config.toml [auth.email] enable_confirmations = false). Point the app at
 * it for the run; variables already in the environment win over client/.env.local:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 \
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from `npx supabase status --workdir server`> \
 *   sh -c "npm run build && npm run test:e2e"
 */
export async function signUpFreshUser(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "e2e-password-123";

  await page.goto("/signup");
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", password);
  await page.fill("#signup-confirm-password", password);
  await page.click("#signup-submit-btn");

  // A new account is sent to onboarding before it sees the dashboard.
  await page.waitForURL("**/onboarding", { timeout: 20_000 });
  await expect(page.getByText("Step 1 of 5")).toBeVisible();
  return email;
}

/** Primary button of the current onboarding step ("Skip for now" / "Continue" / "Open my dashboard"). */
export const onboardingNext = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: /Skip for now|Continue|Open my dashboard/ });

/** Skip every onboarding step and land on the dashboard. */
export async function skipOnboarding(page: Page) {
  for (let step = 1; step <= 4; step++) {
    await expect(page.getByText(`Step ${step} of 5`)).toBeVisible();
    await onboardingNext(page).click();
  }
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}

const env = (k: string) => {
  const v = process.env[k];
  if (!v)
    throw new Error(
      `${k} is not set. Export the local stack's API_URL, PUBLISHABLE_KEY and SECRET_KEY ` +
        "(`npx supabase status --workdir server -o env`) as NEXT_PUBLIC_SUPABASE_URL, " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.",
    );
  return v;
};

/**
 * Signed in and onboarded, without the UI: ₹1,00,000 pay, 20% savings, ₹28,000 rent due on the
 * 3rd, ₹10,000 groceries limit. The account is made with the local stack's secret key and set up
 * through the same complete_onboarding call the Onboarding page makes (with its own payload
 * builder); the browser gets the session as the cookies @supabase/ssr writes. Onboarding itself
 * is covered by onboarding.spec. Lands on /dashboard.
 */
export async function setUpAccount(page: Page): Promise<string> {
  const url = env("NEXT_PUBLIC_SUPABASE_URL"),
    key = env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "e2e-password-123";

  const admin = createClient(url, env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;

  // Sign in the way the app does on the server, collecting the cookies it would set.
  const jar = new Map<string, string>();
  const user = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list: Array<{ name: string; value: string }>) =>
        list.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const onboarded = await user.rpc(
    "complete_onboarding",
    onboardingPayload({
      salary: "100000",
      payDay: "1",
      pct: 20,
      bills: DEFAULT_BILLS.map((b) => (b.name === "Rent" ? { ...b, amt: "28000" } : b)),
      cats: ONBOARDING_CATEGORIES.map((name, i) => ({ name, limit: name === "Groceries" ? "10000" : "", on: i < 5 })),
    }),
  );
  if (onboarded.error) throw onboarded.error;

  const base = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3124";
  await page.context().addCookies([...jar].map(([name, value]) => ({ name, value, url: base })));
  await page.goto("/dashboard");
  await page.waitForURL("**/dashboard", { timeout: 20_000 });
  return email;
}

/** Under 720px the app uses the bottom nav and phone pages (design handoff v3, Mobile). */
export const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 720;

const navItem = (page: Page, label: string) =>
  page
    .getByRole("navigation", { name: "Main" })
    .locator("a, button")
    .filter({ hasText: new RegExp(`^${label}$`) });

/**
 * Go to where a part of the Dashboard lives: on wide screens one page (Dashboard or Reports
 * tab); on phones Home, Reports, Ledger, or Bills / Budgets / Goals through More.
 */
export async function show(page: Page, where: "Home" | "Reports" | "Ledger" | "Budgets" | "Goals" | "Bills") {
  if (!isPhone(page)) return navItem(page, where === "Reports" ? "Reports" : "Dashboard").click();
  if (where === "Home" || where === "Reports" || where === "Ledger") return navItem(page, where).click();
  await navItem(page, "More").click();
  await page.getByRole("button", { name: new RegExp(`^${where === "Bills" ? "Bills & recurring" : where}`) }).click();
}

/** Log expense: the header button, or Add in the bottom nav on phones. */
export async function openLogExpense(page: Page) {
  if (isPhone(page)) await page.getByRole("button", { name: "Add an entry" }).click();
  else await page.getByRole("button", { name: "Log expense" }).first().click();
}

/** Record income: the header button, or Add then the Income tab on phones. */
export async function openRecordIncome(page: Page) {
  if (!isPhone(page)) return page.getByRole("button", { name: "Record income" }).first().click();
  await page.getByRole("button", { name: "Add an entry" }).click();
  await page.getByRole("dialog").getByRole("tab", { name: "Income" }).click();
}
