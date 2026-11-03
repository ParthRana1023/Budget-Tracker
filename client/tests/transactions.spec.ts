import { test, expect } from "@playwright/test";

test.describe("Phase 2 - Fast Transaction & Category Flows", () => {
  test("landing page has direct entry points to auth and budget", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SaveFirst")).toBeVisible();
    await expect(page.locator("text=safe to spend")).toBeVisible();
  });

  test("login page renders all credentials fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#login-submit-btn")).toBeVisible();
  });

  test("signup page renders password confirmation and handles mismatched passwords", async ({ page }) => {
    await page.goto("/signup");
    await page.fill("#signup-email", "testuser@example.com");
    await page.fill("#signup-password", "password123");
    await page.fill("#signup-confirm-password", "passwordXYZ");
    await page.click("#signup-submit-btn");

    await expect(page.locator("text=Passwords do not match.")).toBeVisible();
  });
});

