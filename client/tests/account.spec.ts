import { test, expect, Page } from "@playwright/test";
import { setUpAccount } from "./helpers";

// Design handoff v2, Settings.dc.html: Notifications, Data, Security and the Account flows.
// Sign-in history needs SUPABASE_SECRET_KEY in the server's env (the local stack's SECRET_KEY).
// Every test starts from setUpAccount (₹1,00,000 pay, ₹28,000 rent, ₹10,000 groceries limit).

const PASSWORD = "e2e-password-123";
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const warning = /Groceries has reached 90% of its limit/;

async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL("**/login");
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("#login-submit-btn");
}

test.describe("Account and data", () => {
  test("notification switches hide Notices on the Dashboard", async ({ page }) => {
    await setUpAccount(page);
    // ₹9,000 of a ₹10,000 limit: the 80% warning shows.
    await page.getByRole("button", { name: "Log expense" }).first().click();
    await page.getByRole("dialog").getByLabel("Amount").fill("9000");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Groceries/ })
      .click();
    await page.getByRole("dialog").getByRole("button", { name: "Log ₹9,000" }).click();
    await expect(page.getByText(warning)).toBeVisible();

    await page.goto("/settings?s=notif");
    await expect(page.getByText("Weekly summary email")).toHaveCount(0); // email stays hidden
    await page.getByRole("switch", { name: "Category reaches 80%" }).click();
    await expect(page.getByText("✓ Saved")).toBeVisible();
    await page.goto("/dashboard");
    await expect(
      page
        .getByRole("heading", { name: /Safe to spend/i })
        .or(page.getByTestId("safe-to-spend"))
        .first(),
    ).toBeVisible();
    await expect(page.getByText(warning)).toHaveCount(0);
  });

  test("download all data, and import a CSV after its preview", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings?s=data");
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download", exact: true }).click(),
    ]);
    expect(file.suggestedFilename()).toBe("savefirst-my-data.json");

    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const csv = Buffer.from(
      [
        "Date,Type,Category,Amount (INR),Note",
        `${today},expense,Groceries,450.00,Imported milk`,
        "2026-11-02,expense,Gym,100,b",
      ].join("\r\n"),
    );
    const input = page.getByLabel("CSV file to import");
    await input.setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: csv });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Ready to import");
    await expect(dialog).toContainText("1 can’t be imported");
    await expect(dialog).toContainText("No category called “Gym”");
    await dialog.getByRole("button", { name: "Import 1 entry" }).click();
    await expect(toast(page, "Imported 1 entry")).toBeVisible();

    // The same file again: already saved, so nothing new.
    await input.setInputFiles({ name: "entries.csv", mimeType: "text/csv", buffer: csv });
    await expect(dialog).toContainText("1 already saved, skipped");
    await page.keyboard.press("Escape");
    await page.goto("/dashboard");
    await expect(page.getByText("Imported milk")).toBeVisible();
  });

  test("security: this device, sign-in history with a failed attempt, password change", async ({ page }) => {
    test.setTimeout(90_000); // three sign-ins and a password change
    const email = await setUpAccount(page);
    await signOut(page);
    await signIn(page, email, "wrong-password");
    await expect(page.getByText(/don’t match/)).toBeVisible();
    await signIn(page, email, PASSWORD);
    await page.waitForURL("**/dashboard");

    await page.goto("/settings?s=sec");
    await expect(page.getByTestId("session-row").filter({ hasText: "This device" })).toBeVisible();
    await expect(page.getByText("Failed attempt")).toBeVisible();
    await expect(page.getByText("Signed in", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Change your password" }).click();
    await page.waitForURL("**/settings/account**");
    await page.getByLabel("Current password").fill("not-it-at-all");
    await page.getByLabel("New password", { exact: true }).fill("brand-new-pass-1");
    await page.getByLabel("Confirm new password").fill("brand-new-pass-1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Your current password isn’t right.")).toBeVisible();
    await page.getByLabel("Current password").fill(PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("✓ Password changed.")).toBeVisible();

    await signOut(page);
    await signIn(page, email, "brand-new-pass-1");
    await page.waitForURL("**/dashboard");
  });

  test("change email asks to confirm by link", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings/account");
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.getByLabel("New email address").fill("not-an-email");
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
    await page.getByLabel("New email address").fill(`moved-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByText(/Check moved-\d+@example.com for a link/)).toBeVisible();
  });
});
