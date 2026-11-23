import { test, expect } from "@playwright/test";
import { setUpAccount, openLogExpense, show } from "./helpers";

// Design handoff, Reports. A brand-new account has no closed cycle yet.

test("Reports: tabs, keyboard, empty states, and habits after one expense", async ({ page }) => {
  await setUpAccount(page);
  await show(page, "Reports");
  await expect(page.getByRole("heading", { name: /Reports & analysis/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your first report arrives after a few entries." })).toBeVisible();

  await page.getByRole("tab", { name: /Overview/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Spending habits/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Patterns need a few weeks of entries." })).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /Plan ahead/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Forecasts start after your first cycle." })).toBeVisible();

  // One flexible expense fills the habits tab.
  await show(page, "Home");
  await openLogExpense(page);
  await page.getByRole("dialog").getByLabel("Amount").fill("640");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Groceries/ })
    .click();
  await page.getByRole("dialog").getByLabel("Payee").fill("Swiggy");
  await page.getByRole("dialog").getByRole("button", { name: "Log ₹640" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await show(page, "Reports");
  await page.getByRole("tab", { name: /Spending habits/ }).click();
  await expect(page.getByRole("heading", { name: "Spending pace" })).toBeVisible();
  await page.getByRole("button", { name: "Swiggy: ₹640" }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText("Swiggy");
  await expect(drawer).toContainText("₹640");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
});
