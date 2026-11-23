import { test, expect, Page } from "@playwright/test";
import { isPhone, openLogExpense, setUpAccount, show } from "./helpers";

// These flows move between Home, Budgets, Goals, Bills and the Ledger on one page; on phones
// those are separate pages, and mobile.spec covers the phone versions.
test.beforeEach(({ page }) => {
  test.skip(isPhone(page), "Wide-screen flow; phones: mobile.spec");
});

// Phase 3: how an expense was paid. Tracking only; safe to spend doesn't change with it.

async function logExpense(page: Page, amount: string, note: string, method?: string) {
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill(amount);
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByLabel("Note").fill(note);
  if (method) await dialog.getByLabel("Paid with").selectOption({ label: method });
  await dialog.getByRole("button", { name: /^Log ₹/ }).click();
  await expect(dialog).toHaveCount(0);
}

test("payment method: log with UPI, see it in the Ledger, filter, Reports, and edit it", async ({ page }) => {
  await setUpAccount(page);
  await logExpense(page, "640", "Swiggy dinner", "UPI");
  await logExpense(page, "300", "Corner shop");

  const ledger = page.locator("#ledger-body");
  const upiRow = ledger.getByRole("button", { name: /^Edit Swiggy dinner/ });
  await expect(upiRow).toContainText("UPI");
  await expect(ledger.getByRole("button", { name: /^Edit Corner shop/ })).not.toContainText("UPI");

  const filter = page.getByLabel("Show expenses paid with");
  await filter.selectOption({ label: "UPI" });
  await expect(upiRow).toBeVisible();
  await expect(ledger.getByRole("button", { name: /^Edit Corner shop/ })).toHaveCount(0);
  await filter.selectOption({ label: "Not recorded" });
  await expect(ledger.getByRole("button", { name: /^Edit Corner shop/ })).toBeVisible();
  await expect(upiRow).toHaveCount(0);
  await filter.selectOption({ label: "All entries" });

  await show(page, "Reports");
  await page.getByRole("tab", { name: /Spending habits/ }).click();
  await expect(page.getByRole("button", { name: "UPI: ₹640" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Not recorded: ₹300" })).toBeVisible();

  // Change it to a credit card in Edit entry.
  await show(page, "Home");
  await ledger.getByRole("button", { name: /^Edit Swiggy dinner/ }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel("Paid with")).toHaveValue("upi");
  await edit.getByLabel("Paid with").selectOption({ label: "Credit card" });
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(ledger.getByRole("button", { name: /^Edit Swiggy dinner/ })).toContainText("Credit card");
});
