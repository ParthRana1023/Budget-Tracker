import { test, expect } from "@playwright/test";

// Design handoff, Status Pages.

test.describe("Status pages", () => {
  test("unknown page shows the 404", async ({ page }) => {
    // Under /auth/ so the signed-out redirect to /login doesn't apply.
    const res = await page.goto("/auth/no-such-page");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /This page isn’t in the budget\./ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/dashboard");
  });

  test("cookie policy opens signed out and lists what the app stores", async ({ page }) => {
    await page.goto("/cookies");
    await expect(page).toHaveURL(/\/cookies$/);
    await expect(page.getByRole("heading", { name: "What SaveFirst keeps in your browser" })).toBeVisible();
    for (const name of ["Necessary", "Your settings", "Analytics"])
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "sf_consent", exact: true })).toBeVisible();
  });

  test("offline page offers a retry", async ({ page }) => {
    await page.goto("/offline");
    await expect(page.getByRole("heading", { name: /You’re offline\./ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("a sign-in cookie that no longer works shows the session-expired page", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "sb-test-auth-token", value: "base64-eyJmYWtlIjp0cnVlfQ", url: baseURL! }]);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/session-expired$/);
    await expect(page.getByRole("heading", { name: /has ended/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  });

  test("no sign-in cookie at all goes to the login page instead", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the service worker and manifest are served even when signed out", async ({ request }) => {
    for (const path of ["/sw.js", "/manifest.json"]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
    }
  });
});
