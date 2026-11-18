import { test, expect } from "@playwright/test";

test.describe("Authentication and Landing Flow", () => {
  test("landing page renders hero and navigation links", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /Know what’s safe to spend/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute("href", "/login");
    // FAQ accordion: the first answer is open, another opens on click.
    await page.getByRole("button", { name: "Is it free?" }).click();
    await expect(page.getByRole("button", { name: "Is it free?" })).toHaveAttribute("aria-expanded", "true");
  });

  test("login page defaults to password login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#login-submit-btn")).toHaveText("Sign in");
    await expect(page.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  });

  test("login page switches to the email link mode", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("tab", { name: "Email link" }).click();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toHaveCount(0);
    await expect(page.locator("#login-submit-btn")).toHaveText("Email me a sign-in link");
  });

  test("login validates before calling the server", async ({ page }) => {
    await page.goto("/login");
    await page.click("#login-submit-btn");
    await expect(page.getByRole("alert").filter({ hasText: "Enter the email you signed up with." })).toBeVisible();
    await page.fill("#email", "someone@example.com");
    await page.click("#login-submit-btn");
    await expect(page.getByRole("alert").filter({ hasText: "Enter your password." })).toBeVisible();
  });

  test("navigation to signup page works and form elements exist", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /Pay yourself first/ })).toBeVisible();
    await expect(page.locator("#signup-email")).toBeVisible();
    await expect(page.locator("#signup-password")).toBeVisible();
    await expect(page.locator("#signup-confirm-password")).toBeVisible();
    await expect(page.locator("#signup-submit-btn")).toBeVisible();
    await page.fill("#signup-password", "Abcdefghij1!");
    await expect(page.getByText("Strong")).toBeVisible();
  });

  test("forgot password, verify and the Google flag", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: /Forgot it\? Happens\./ })).toBeVisible();
    await page.goto("/verify?email=someone%40example.com");
    await expect(page.getByText("someone@example.com")).toBeVisible();
    await expect(page.getByRole("button", { name: /Resend in 0:/ })).toBeDisabled();
    // Hidden until NEXT_PUBLIC_GOOGLE_AUTH=1 (the provider has to be set up in Supabase first).
    if (process.env.NEXT_PUBLIC_GOOGLE_AUTH !== "1") {
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
    }
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
    await expect(page).toHaveURL(/\/login\?error=link_expired$/);
    await expect(page.getByRole("alert").filter({ hasText: "Email verification link has expired or is invalid." })).toBeVisible();
  });
});
