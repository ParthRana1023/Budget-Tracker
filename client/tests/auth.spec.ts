import { test, expect } from "@playwright/test";

test.describe("Authentication and Landing Flow", () => {
  test("landing page renders hero and navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SafeFirst")).toBeVisible();
    await expect(page.locator("text=Savings-First Personal Budgeting")).toBeVisible();
    await expect(page.locator("text=safe to spend")).toBeVisible();

    const getStartedLink = page.locator('a:has-text("Get Started")');
    await expect(getStartedLink).toBeVisible();
  });

  test("login page defaults to password login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=Welcome Back")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#login-submit-btn")).toBeVisible();
  });

  test("login page switches smoothly to magic link mode", async ({ page }) => {
    await page.goto("/login");
    // Click Magic Link tab
    await page.click('button:has-text("Magic Link")');
    await expect(page.locator("#magic-email")).toBeVisible();
    await expect(page.locator("#send-magic-link-btn")).toBeVisible();
    await expect(page.locator("text=passwordless sign-in link")).toBeVisible();
  });

  test("navigation to signup page works and form elements exist", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.locator("text=Create an Account")).toBeVisible();
    await expect(page.locator("#signup-email")).toBeVisible();
    await expect(page.locator("#signup-password")).toBeVisible();
    await expect(page.locator("#signup-confirm-password")).toBeVisible();
    await expect(page.locator("#signup-submit-btn")).toBeVisible();
  });

  test("unauthenticated access to dashboard redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/.*login/);
  });

  test("expired or invalid confirmation link redirects to login with message", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=invalid&type=signup");
    await expect(page).toHaveURL(/.*login.*error.*/);
    await expect(page.locator("text=Email verification link has expired or is invalid.")).toBeVisible();
  });
});
