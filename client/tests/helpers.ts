import { expect, Page } from "@playwright/test";

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

/** Sign up and onboard: ₹1,00,000 pay, 20% savings, ₹28,000 rent due on the 3rd, ₹10,000 groceries limit. */
export async function setUpAccount(page: Page): Promise<string> {
  const email = await signUpFreshUser(page);
  await page.fill("#ob-sal", "100000");
  await onboardingNext(page).click();
  await page.getByRole("button", { name: "20%" }).click();
  await onboardingNext(page).click();
  await page.getByLabel("Rent amount").fill("28000");
  await onboardingNext(page).click();
  await page.getByLabel("Groceries monthly limit").fill("10000");
  await onboardingNext(page).click();
  await page.getByRole("button", { name: "Open my dashboard" }).click();
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
