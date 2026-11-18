import { test, expect } from "@playwright/test";

test.describe("Authentication and Landing Flow", () => {
  test("landing page renders hero and navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=SaveFirst")).toBeVisible();
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

  test("a sign-in cookie that no longer works shows the session-expired page", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "sb-test-auth-token", value: "base64-eyJmYWtlIjp0cnVlfQ", url: baseURL! }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/session-expired$/);
    await expect(page.getByRole("heading", { name: /has ended/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  });

  test("the service worker and manifest are served even when signed out", async ({ request }) => {
    for (const path of ["/sw.js", "/manifest.json"]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
    }
  });

  test("expired or invalid confirmation link redirects to login with message", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=invalid&type=signup");
    await expect(page).toHaveURL(/.*login.*error.*/);
    await expect(page.locator("text=Email verification link has expired or is invalid.")).toBeVisible();
  });
});
