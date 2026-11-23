import { test, expect, Page } from "@playwright/test";
import { setUpAccount } from "./helpers";

// Phase 4: base currency and foreign-currency entries. /api/rates is mocked: the specs never
// reach the real rates service.

const prefs = async (page: Page) => {
  await page.goto("/settings");
  await page
    .getByRole("navigation", { name: /sections/ })
    .getByRole("button", { name: "Preferences" })
    .click();
};

test("a USD expense converts at this cycle's rate and keeps what was typed", async ({ page }) => {
  await page.route("**/api/rates?**", (route) =>
    route.fulfill({ json: { rate: 92.68, date: "2026-11-01", stale: false } }),
  );
  await setUpAccount(page);

  await page.getByRole("button", { name: "Log expense" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Currency").selectOption("USD");
  await expect(dialog.getByLabel("₹ for 1 USD")).toHaveValue("92.68");
  await dialog.getByLabel("Amount").fill("19.99");
  await expect(dialog).toContainText("≈ ₹1,853 at this cycle’s rate");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByLabel("Note").fill("App subscription");
  await dialog.getByRole("button", { name: "Log ₹1,853" }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.locator("#ledger-body").getByRole("button", { name: /^Edit App subscription/ });
  await expect(row).toContainText("$19.99");
  await expect(row).toContainText("₹1,853");

  // Editing keeps the saved rate: $10 at 92.68 = ₹927.
  await row.click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel("Amount")).toHaveValue("19.99");
  await expect(edit).toContainText("Logged in USD");
  await edit.getByLabel("Amount").fill("10");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(page.locator("#ledger-body").getByRole("button", { name: /^Edit App subscription/ })).toContainText(
    "₹927",
  );
});

test("a category limit set in USD is budgeted at this cycle's rate", async ({ page }) => {
  await page.route("**/api/rates?**", (route) =>
    route.fulfill({ json: { rate: 92.68, date: "2026-11-01", stale: false } }),
  );
  await setUpAccount(page);

  await page.getByRole("button", { name: "Manage" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Groceries currency").selectOption("USD");
  await expect(dialog.getByLabel("₹ for 1 USD")).toHaveValue("92.68");
  await dialog.getByLabel("Groceries monthly limit").fill("100");
  await expect(dialog).toContainText("≈ ₹9,268 this cycle");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-testid="budget-row"][data-name="Groceries"]')).toContainText("₹9,268");

  // Reopened, it still shows what was typed, in USD.
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(dialog.getByLabel("Groceries currency")).toHaveValue("USD");
  await expect(dialog.getByLabel("Groceries monthly limit")).toHaveValue("100");
});

test("base currency: changeable before the first entry, then locked", async ({ page }) => {
  await setUpAccount(page);
  await prefs(page);
  const picker = page.getByLabel("Base currency");
  await expect(picker).toBeEnabled();
  await picker.selectOption("USD");
  await expect(page.getByLabel("Base currency")).toHaveValue("USD");

  await page.goto("/dashboard");
  await expect(page.getByTestId("safe-to-spend")).toContainText("$");
  await page.getByRole("button", { name: "Log expense" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("12.5");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByRole("button", { name: "Log $13" }).click();
  await expect(dialog).toHaveCount(0);

  await prefs(page);
  await expect(page.getByLabel("Base currency")).toBeDisabled();
  await expect(page.getByText("Locked after your first entry")).toBeVisible();
});
