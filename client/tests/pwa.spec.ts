import { test, expect } from "@playwright/test";
import { isPhone, setUpAccount, show } from "./helpers";

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
    await expect(page.getByText("Blocked in this browser")).toBeVisible();
    await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Push notifications on this device" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await page.evaluate(() => localStorage.setItem("e2e-permission", "default"));
    await openNotifications();
    const toggle = page.getByRole("switch", { name: "Push notifications on this device" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const asks = () => page.evaluate(() => (window as unknown as { __asks: number }).__asks);
    expect(await asks()).toBe(0);

    await toggle.click();
    const sheet = page.getByRole("dialog", { name: "Turn on push notifications" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Rent is due tomorrow");
    expect(await asks()).toBe(0);
    await sheet.getByRole("button", { name: "Not now" }).click();
    await expect(sheet).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("push: Continue asks the browser, then per-type switches and Send a test", async ({ page }) => {
    // Headless Chromium can't really subscribe: stub the permission prompt and the push service.
    await page.addInitScript(() => {
      let granted = false;
      let sub: object | null = null;
      Object.defineProperty(Notification, "permission", { get: () => (granted ? "granted" : "default") });
      Notification.requestPermission = async () => ((granted = true), "granted");
      const fake = {
        endpoint: "https://push.example.test/e2e-device",
        toJSON: () => ({ endpoint: fake.endpoint, keys: { p256dh: "e2e-p256dh", auth: "e2e-auth" } }),
        unsubscribe: async () => ((sub = null), true),
      };
      PushManager.prototype.getSubscription = async () => sub as PushSubscription | null;
      PushManager.prototype.subscribe = async () => (sub = fake) as unknown as PushSubscription;
    });
    await setUpAccount(page);
    await page.goto("/settings?s=notif");

    const toggle = page.getByRole("switch", { name: "Push notifications on this device" });
    await toggle.click();
    await page
      .getByRole("dialog", { name: "Turn on push notifications" })
      .getByRole("button", { name: "Continue" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("On here. Your other devices keep their own setting.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Bill reminders" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/Push reminders that fall in this window arrive at 8:00 am\./)).toBeVisible();

    // The test push goes through /api/push/test (stubbed: the E2E server has no private VAPID key).
    let reply = { status: 200, json: { ok: true } as object };
    await page.route("**/api/push/test", (route) => route.fulfill(reply));
    await page.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText("Sent. It should arrive in a few seconds.")).toBeVisible();
    reply = { status: 502, json: { error: { message: "Couldn’t send. Check your connection, then try again." } } };
    await page.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText("Couldn’t send. Check your connection, then try again.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    await toggle.click(); // off again: this device only
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: /Send a test|Try again/ })).toHaveCount(0);
  });

  test("offline: amounts hide, Add explains itself, numbers return online", async ({ page, context }) => {
    await setUpAccount(page);
    await expect(page.getByTestId("safe-to-spend")).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText("You’re offline", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Numbers hidden while offline" })).toBeVisible();
    await expect(page.getByTestId("safe-to-spend")).toHaveCount(0);
    await expect(page.getByText(/₹\d/)).toHaveCount(0); // no amount anywhere

    // aria-disabled, but still tappable so it can say why.
    const add = isPhone(page)
      ? page.getByRole("button", { name: "Add an entry, needs a connection" })
      : page.getByRole("button", { name: "Log expense" });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await add.click({ force: true });
    await expect(page.getByText("Adding needs a connection. Try again when you’re back online.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await context.setOffline(false);
    await expect(page.getByTestId("safe-to-spend")).toBeVisible();
    await expect(page.getByText("You’re offline", { exact: true })).toHaveCount(0);
  });

  test("install card: second visit, Not now hides it, the menu brings it back, Install", async ({ page }) => {
    await setUpAccount(page);
    // From the second visit, once the browser offers to install (stubbed: Chromium only fires
    // beforeinstallprompt for a real, engaged, installable site).
    await page.evaluate(() => {
      localStorage.setItem("sf-visits", "2");
      const e = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
        prompt: async () => {},
        userChoice: Promise.resolve({ outcome: "accepted" }),
      });
      window.dispatchEvent(e);
    });
    const card = page.getByRole("region", { name: "Install SaveFirst" });
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Not now" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByText(/^Hidden for 30 days\./)).toBeVisible();

    if (isPhone(page)) {
      await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: /^Install app/ }).click();
    } else {
      await page.getByRole("button", { name: /^Account menu/ }).click();
      await page.getByRole("menuitem", { name: "Install app" }).click();
    }
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Install app" }).click();
    await expect(page.getByText("SaveFirst is installed. Open it from your home screen.")).toBeVisible();
    await expect(card).toHaveCount(0);
    await show(page, "Home");
  });
});
