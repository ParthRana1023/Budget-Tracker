import { test, expect, Page, type Locator } from "@playwright/test";
import { openLogExpense, setUpAccount } from "./helpers";

// Design handoff v3, Currency: the currency chip and list, the rate line and its states.
// /api/rates is mocked: the specs never reach the real rates service.

const prefs = async (page: Page) => {
  await page.goto("/settings");
  await page
    .getByRole("navigation", { name: /sections/ })
    .getByRole("button", { name: "Preferences" })
    .click();
};
const rate = (page: Page, value: number) =>
  page.route("**/api/rates?**", (route) => route.fulfill({ json: { rate: value, date: "2026-11-01", stale: false } }));

/** Opens a chip's list, searches and picks the first match with Enter. */
async function pickCurrency(scope: Locator, chipName: RegExp, query: string) {
  await scope.getByRole("button", { name: chipName }).click();
  await scope.getByLabel("Search currencies").fill(query);
  await scope.getByLabel("Search currencies").press("Enter");
}

test("a USD expense: chip, list, rate line, ledger and Edit entry with bank fees", async ({ page }) => {
  await rate(page, 92.68);
  await setUpAccount(page);

  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "+100" })).toBeVisible();
  await pickCurrency(dialog, /^Currency: INR/, "USD");
  await expect(dialog.getByRole("button", { name: /^Currency: USD/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "+100" })).toBeHidden(); // quick amounts are in ₹
  await dialog.getByLabel("Amount").fill("19.99");
  await expect(dialog).toContainText("$19.99 = ₹1,852.67 at ₹92.68");
  await expect(dialog).toContainText("Rate locked for this cycle, from 1 Nov");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByLabel("Note").fill("App subscription");
  await dialog.getByRole("button", { name: "Log ₹1,852.67" }).click();
  await expect(dialog).toHaveCount(0);

  const row = () => page.locator("#ledger-body").getByRole("button", { name: /^Edit App subscription/ });
  await expect(row()).toContainText("₹1,852.67");
  await expect(row()).toContainText("$19.99");

  // Editing keeps the saved rate: $10 at 92.68 = ₹926.80.
  await row().click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel("Amount")).toHaveValue("19.99");
  await expect(edit).toContainText("Paid $19.99 at ₹92.68");
  await edit.getByLabel("Amount").fill("10");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(row()).toContainText("₹926.80");

  // The bank charged a little more: the base amount can be typed over.
  await row().click();
  await edit.getByLabel("Charged in INR").fill("930");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(row()).toContainText("₹930.00");
  await expect(row()).toContainText("$10.00");
});

test("rate line: an error offers Try again or your own rate; your own rate is for this entry", async ({ page }) => {
  let down = true;
  await page.route("**/api/rates?**", (route) =>
    down
      ? route.fulfill({ status: 503, json: { error: "Rates are unavailable." } })
      : route.fulfill({ json: { rate: 92.68, date: "2026-11-01", stale: false } }),
  );
  await setUpAccount(page);
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await pickCurrency(dialog, /^Currency: INR/, "USD");
  await expect(dialog).toContainText("Couldn’t get this cycle’s rate.");

  down = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog).toContainText("$1.00 = ₹92.68 at ₹92.68");

  await dialog.getByRole("button", { name: "Use my own rate" }).click();
  await expect(dialog.getByLabel("₹ for 1 USD")).toHaveValue("92.68");
  await dialog.getByLabel("₹ for 1 USD").fill("95");
  await dialog.getByLabel("Amount").fill("10");
  await expect(dialog).toContainText("$10.00 = ₹950.00 at ₹95.00");
  await dialog.getByRole("button", { name: "Use this cycle’s rate" }).click();
  await expect(dialog).toContainText("$10.00 = ₹926.80 at ₹92.68");
});

test("rates under ₹1 read per 100 units; yen have no decimals", async ({ page }) => {
  await rate(page, 0.5571);
  await setUpAccount(page);
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await pickCurrency(dialog, /^Currency: INR/, "yen");
  await dialog.getByLabel("Amount").fill("3200");
  await expect(dialog).toContainText("¥3,200 = ₹1,782.72 at ₹55.71 per ¥100");
});

test("a category limit set in USD is budgeted at this cycle's rate", async ({ page }) => {
  await rate(page, 92.68);
  await setUpAccount(page);

  await page.getByRole("button", { name: "Manage" }).click();
  const dialog = page.getByRole("dialog");
  await pickCurrency(dialog, /^Groceries currency: INR/, "USD");
  await expect(dialog.getByLabel("₹ for 1 USD")).toHaveValue("92.68");
  await dialog.getByLabel("Groceries monthly limit").fill("100");
  await expect(dialog).toContainText("≈ ₹9,268.00 this cycle");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  const groceries = page.locator('[data-testid="budget-row"][data-name="Groceries"]');
  await expect(groceries).toContainText("₹9,268.00");
  await expect(groceries).toContainText("$100.00 a month · ₹9,268.00 this cycle");

  // Reopened, it still shows what was typed, in USD.
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(dialog.getByRole("button", { name: /^Groceries currency: USD/ })).toBeVisible();
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
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("12.5");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByRole("button", { name: "Log $12.50" }).click();
  await expect(dialog).toHaveCount(0);

  await prefs(page);
  await expect(page.getByLabel("Base currency")).toBeDisabled();
  await expect(page.getByText("Locked after your first entry")).toBeVisible();
});
