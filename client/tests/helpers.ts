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
export async function setUpAccount(page: Page) {
  await signUpFreshUser(page);
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
}
