import { test, expect } from "@playwright/test";
import { setUpAccount } from "./helpers";

// Phase 2: installable app, service worker, offline page, push opt-in. Runs on desktop and
// mobile (Pixel 5) projects.

test.describe("PWA", () => {
  test("manifest is installable: id, scope, maskable icon and shortcuts", async ({ request }) => {
    const m = await (await request.get("/manifest.json")).json();
    expect(m.id).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    expect(m.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/dashboard?add=expense", "/dashboard"]);
    expect((await request.get("/maskable-512x512.png")).ok()).toBe(true);
  });

  test("pinch-zoom stays allowed and the page draws under the notch", async ({ page }) => {
    await page.goto("/login");
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).toContain("viewport-fit=cover");
    expect(viewport).not.toMatch(/user-scalable=(0|no)|maximum-scale=1\b/);
  });

  test("service worker caches only public files and shows /offline without a network", async ({ page, context }) => {
    await page.goto("/login");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const key of await caches.keys())
        for (const req of await (await caches.open(key)).keys()) urls.push(new URL(req.url).pathname);
      return urls;
    });
    expect(cached).toContain("/offline");
    expect(cached.filter((p) => ["/", "/login", "/signup", "/dashboard", "/settings"].includes(p))).toEqual([]);

    await context.setOffline(true);
    await page.goto("/signup").catch(() => {});
    await expect(page.getByText("offline.")).toBeVisible();
    await context.setOffline(false);
  });

  test("the Add expense shortcut opens Log expense", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/dashboard?add=expense");
    await expect(page.getByRole("dialog", { name: "Log expense" })).toBeVisible();
  });

  test("push: blocked state, and permission is asked only after Turn on", async ({ page }) => {
    // Counts permission requests, so the test can prove nothing asks on page load. Headless
    // Chromium reports "denied" even after grantPermissions, so the second half stubs "default".
    await page.addInitScript(() => {
      const w = window as unknown as { __asks: number };
      w.__asks = 0;
      const ask = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...a) => (w.__asks++, ask(...a));
      if (localStorage.getItem("e2e-permission"))
        Object.defineProperty(Notification, "permission", { get: () => localStorage.getItem("e2e-permission") });
    });
    const openNotifications = async () => {
      await page.goto("/settings");
      await page
        .getByRole("navigation", { name: /sections/ })
        .getByRole("button", { name: "Notifications" })
        .click();
    };
    await setUpAccount(page);

    // Headless Chromium starts with notifications denied: the card explains how to unblock.
    await openNotifications();
    await expect(page.getByText(/Notifications are blocked for this site/)).toBeVisible();

    await page.evaluate(() => localStorage.setItem("e2e-permission", "default"));
    await openNotifications();
    const toggle = page.getByRole("switch", { name: "Push notifications on this device" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const asks = () => page.evaluate(() => (window as unknown as { __asks: number }).__asks);
    expect(await asks()).toBe(0);

    await toggle.click();
    const sheet = page.getByRole("dialog", { name: "Get reminders on this device" });
    await expect(sheet).toBeVisible();
    expect(await asks()).toBe(0);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
