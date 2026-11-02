import { test, expect } from "@playwright/test";

test.describe("Authentication and Landing Flow", () => {
  test("landing page renders hero and navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SafeFirst")).toBeVisible();
    await expect(page.locator("text=Savings-First Personal Budgeting")).toBeVisible();
    await expect(page.locator("text=safe to spend")).toBeVisible();

    // Check action links
    const getStartedLink = page.locator('a:has-text("Get Started")');
    await expect(getStartedLink).toBeVisible();
  });

  test("navigation to login page works and form elements exist", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("text=Welcome Back")).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator("#login-submit-btn")).toBeVisible();
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
});

