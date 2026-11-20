import { test, expect, Page } from "@playwright/test";
import { setUpAccount } from "./helpers";

// Design handoff v2, Settings.dc.html. Every test starts from setUpAccount:
// ₹1,00,000 pay, 20% savings, ₹28,000 rent, ₹10,000 groceries limit.

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const history = (page: Page) => page.locator("#plan-hist");
const section = (page: Page, name: string) =>
  page.getByRole("navigation", { name: /sections/ }).getByRole("button", { name });

test.describe("Settings", () => {
  test("Budget plan: changes wait for Apply from when?, land in history, and Undo", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: /^Account menu/ }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL("**/settings");
    await expect(page.getByLabel("Monthly salary")).toHaveValue("1,00,000");
    await expect(history(page)).toContainText("Plan created during onboarding");

    await page.getByLabel("Monthly salary").fill("120000");
    await expect(page.getByText("Not saved")).toBeVisible();
    const panel = page.getByRole("region", { name: "Apply plan changes" });
    await expect(panel).toContainText("Salary: ₹1,00,000 → ₹1,20,000");
    await expect(panel).toContainText("Saved first each month");
    await panel.getByRole("button", { name: "This cycle · recalculate now" }).click();

    await expect(toast(page, "Plan updated for this cycle")).toBeVisible();
    await expect(history(page)).toContainText("Salary ₹1,00,000 → ₹1,20,000");
    await expect(history(page)).toContainText("Applied at once");
    await expect(panel).toHaveCount(0);

    await toast(page, "Plan updated").getByRole("button", { name: "Undo" }).click();
    await expect(page.getByLabel("Monthly salary")).toHaveValue("1,00,000");
    await expect(history(page)).not.toContainText("₹1,20,000");

    // Save first from the next cycle: the field says when it starts.
    await page.getByRole("button", { name: "Raise save first" }).click();
    await expect(page.getByLabel("Save first", { exact: true })).toHaveValue("21");
    await panel.getByRole("button", { name: /^Next cycle · from / }).click();
    await expect(toast(page, /Plan updated · from /)).toBeVisible();
    await expect(page.getByText(/✓ Saved · from /)).toBeVisible();
    await expect(history(page)).toContainText("Save first 20% → 21%");
    await expect(history(page)).toContainText("From next cycle");

    // A payday change previews this cycle's new dates before it's applied.
    await page.getByLabel("Payday").selectOption("31");
    await expect(panel).toContainText("Each cycle runs");
    await expect(panel).toContainText("Nothing you’ve logged moves.");
    await panel.getByRole("button", { name: "Undo changes" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("Preferences save on their own and stay after a reload", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings?s=prefs");
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByLabel("Number format").selectOption("international");
    await expect(page.getByText("₹123,456.78")).toBeVisible();
    await expect(page.getByText("✓ Saved").first()).toBeVisible();
    await page.getByLabel("Week starts on").selectOption("0");
    await expect(page.getByText("Saving…")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Number format")).toHaveValue("international");
    await expect(page.getByLabel("Week starts on")).toHaveValue("0");
    await expect(page.getByText("Currency")).toBeVisible();
    await expect(page.getByText("₹ Indian rupee")).toBeVisible();
  });

  test("Recurring items: add and delete apply on close; Undo brings a deleted item back", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings?s=cats");
    await page.getByRole("button", { name: "Edit recurring" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("New recurring item name").fill("Gym");
    await dialog.getByLabel("Category").selectOption({ label: "Groceries" });
    await dialog.getByLabel("New recurring item amount").fill("1500");
    await dialog.getByLabel("New recurring item day of month").fill("10");
    await dialog.getByRole("button", { name: "Add" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(toast(page, "Recurring items updated")).toBeVisible();

    const gym = dialog.locator('[data-testid="recurring-edit-row"][data-name="Gym"]');

    await page.reload();
    await page.getByRole("button", { name: "Edit recurring" }).click();
    await expect(gym).toBeVisible();
    await dialog.getByRole("button", { name: "Delete Gym" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await toast(page, "Recurring items updated").getByRole("button", { name: "Undo" }).click();
    await expect(toast(page, "Recurring items updated")).toHaveCount(0);
    await page.getByRole("button", { name: "Edit recurring" }).click();
    await expect(gym).toBeVisible();
  });

  test("Search finds a setting by its other names and opens the Account view", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings?s=prefs");
    await page.getByLabel("Search settings").fill("take-home");
    await expect(page.getByRole("option", { name: /Monthly salary/ })).toBeVisible();
    await page.getByLabel("Search settings").press("Enter");
    await expect(page.getByLabel("Monthly salary")).toBeFocused();

    await page.getByLabel("Search settings").fill("photo");
    await page.getByLabel("Search settings").press("Enter");
    await page.waitForURL("**/settings/account**");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
  });

  test("Account: name saves on its own; email shows as verified", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings/account");
    await page.getByLabel("Name", { exact: true }).fill("Asha Rao");
    await page.getByLabel("Name", { exact: true }).blur();
    await expect(page.getByText("✓ Saved")).toBeVisible();
    await expect(page.getByText("Verified", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Asha Rao");
    await expect(page.getByRole("main").getByText("AR", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" })).toContainText("AR");
    await page.getByRole("link", { name: "Edit in Settings" }).click();
    await page.waitForURL("**/settings?s=plan");
  });

  test("Account: profile photo uploads, replaces initials, and can be removed", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings/account");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.locator('input[type="file"]').setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("main").locator('img[src*="/avatars/"]')).toBeVisible();
    await expect(page.getByText("Change photo")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("main").locator('img[src*="/avatars/"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Account menu" }).locator("img")).toHaveAttribute("src", /avatars/);

    await page.locator('input[type="file"]').setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: png });
    await expect(page.getByText("Choose a PNG, JPG or WebP image.")).toBeVisible();

    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("main").locator('img[src*="/avatars/"]')).toHaveCount(0);
    await expect(page.getByText("Upload photo")).toBeVisible();
  });

  test("Delete account needs DELETE typed, then signs out to the landing page", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings");
    await section(page, "Delete account").click();
    const button = page.getByRole("button", { name: "Delete my account" });
    await expect(button).toBeDisabled();
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await button.click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await page.goto("/dashboard");
    await page.waitForURL(/\/(login|session-expired)/);
  });
});
