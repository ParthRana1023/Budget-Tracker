import { expect, Page } from "@playwright/test";

/**
 * These specs sign up a brand-new user per test, so they need a real Supabase
 * backend with e-mail confirmation DISABLED (the default for `supabase start`,
 * see supabase/config.toml: [auth.email] enable_confirmations = false) and the
 * client's .env pointing at it. They cannot run against a mocked backend because
 * the dashboard loads its data on the server.
 */
export async function signUpFreshUser(page: Page): Promise<string> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "e2e-password-123";

  await page.goto("/signup");
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", password);
  await page.fill("#signup-confirm-password", password);
  await page.click("#signup-submit-btn");

  await page.waitForURL("**/dashboard", { timeout: 20_000 });
  await expect(page.getByTestId("recurring-section")).toBeVisible({ timeout: 20_000 });
  return email;
}

export const STARTER_FIXED = ["EMI / Loans", "Insurance", "Rent / Housing", "Subscriptions", "Utilities & Bills"];
export const STARTER_FLEXIBLE = [
  "Entertainment",
  "Food & Dining Out",
  "Groceries",
  "Health",
  "Miscellaneous",
  "Shopping",
  "Transport / Fuel",
  "Travel",
];

export async function openCategoryModal(page: Page) {
  await page.getByTitle("Manage Categories").click();
  await expect(page.getByTestId("category-modal")).toBeVisible();
}

export async function categoryNames(page: Page): Promise<string[]> {
  const names = await page.getByTestId("category-row").evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.name ?? ""));
  return names.sort((a, b) => a.localeCompare(b));
}
