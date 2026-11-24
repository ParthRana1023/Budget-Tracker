import { test, expect, Page } from "@playwright/test";
import { openLogExpense, openRecordIncome, setUpAccount, show } from "./helpers";

// Design handoff v2, Dashboard: early income, the pending-payday note, number formats.
// Every test starts from setUpAccount (₹1,00,000 pay, payday the 1st, no income yet).

const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });

/** Apply a new payday in Settings, this cycle or from the next one. */
async function applyPayday(page: Page, payDay: number, when: "This cycle" | "Next cycle") {
  await page.goto("/settings?s=plan");
  await page.getByLabel("Payday").selectOption(String(payDay));
  await page
    .getByRole("region", { name: "Apply plan changes" })
    .getByRole("button", { name: new RegExp(`^${when}`) })
    .click();
  await expect(toast(page, "Plan updated")).toBeVisible();
}

test.describe("Dashboard v2", () => {
  test("income a few days before payday can count toward the next cycle", async ({ page }) => {
    await setUpAccount(page);
    // Payday 3 days from now, from this cycle: this cycle now ends just before it.
    const soon = new Date();
    soon.setDate(soon.getDate() + 3);
    await applyPayday(page, soon.getDate() > 28 ? 31 : soon.getDate(), "This cycle");

    await page.goto("/dashboard");
    await openRecordIncome(page);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Amount").fill("5000");
    const early = dialog.getByRole("switch", { name: /^Count toward the cycle starting / });
    await expect(early).toHaveAttribute("aria-checked", "false");
    await expect(dialog).toContainText(/This arrived \d days? before payday/);
    await early.click();
    await expect(dialog).toContainText(/Counts from .*\+₹5,000.00/);
    await expect(dialog).toContainText("added to next cycle’s income");
    await dialog.getByRole("button", { name: "Save ₹5,000.00" }).click();

    await expect(toast(page, /Added ₹5,000.00 · counts toward the cycle starting /)).toBeVisible();
    // It stays out of this cycle: safe to spend is still ₹0.
    await expect(page.getByTestId("safe-to-spend")).toHaveText("₹0.00");
  });

  test("a payday change from the next cycle shows on the cycle line", async ({ page }) => {
    await setUpAccount(page);
    await applyPayday(page, 31, "Next cycle");
    await page.goto("/dashboard");
    await expect(page.getByText(/· Payday moves to the last day from \d+ \w+$/)).toBeVisible();
  });

  test("amounts follow the number format, while typing too", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings?s=prefs");
    await page.getByLabel("Number format").selectOption("european");
    await expect(page.getByText("Saving…")).toHaveCount(0);

    await page.goto("/dashboard");
    await show(page, "Budgets");
    await expect(page.locator('[data-testid="budget-row"][data-name="Groceries"]')).toContainText("₹0,00 / ₹10.000,00");
    await openLogExpense(page);
    const amount = page.getByRole("dialog").getByLabel("Amount");
    await amount.pressSequentially("1234,5");
    await expect(amount).toHaveValue("1.234,5");
    await expect(page.getByRole("dialog").getByRole("button", { name: "Log ₹1.234,50" })).toBeVisible();
  });
});
