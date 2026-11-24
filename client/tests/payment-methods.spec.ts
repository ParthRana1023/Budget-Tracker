import { test, expect, Page } from "@playwright/test";
import { openLogExpense, setUpAccount, show } from "./helpers";

// Design handoff v3, Payment: how an expense was paid. Tracking only; safe to spend doesn't change.

/** method: a full name to pick, "clear" for Not set, or undefined to keep the default. */
async function logExpense(page: Page, amount: string, note: string, method?: string) {
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill(amount);
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByLabel("Note").fill(note);
  if (method === "clear") await dialog.getByRole("button", { name: "Clear payment method" }).click();
  else if (method) await dialog.getByRole("radio", { name: method }).click();
  await dialog.getByRole("button", { name: /^Log ₹/ }).click();
  await expect(dialog).toHaveCount(0);
}

test("payment method: pick, default to last used, filter in the URL, Reports, and edit", async ({ page }) => {
  test.setTimeout(90_000); // one long journey: sign-up, two entries, filters, a reload, Reports, an edit
  await setUpAccount(page);
  await logExpense(page, "640", "Swiggy dinner", "UPI");

  // The next expense starts on the last method used.
  await openLogExpense(page);
  await expect(page.getByRole("dialog").getByRole("radio", { name: "UPI" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await logExpense(page, "300", "Corner shop", "clear");

  const ledger = page.locator("#ledger-body");
  const upiRow = ledger.getByRole("button", { name: /^Edit Swiggy dinner/ });
  const shopRow = ledger.getByRole("button", { name: /^Edit Corner shop/ });
  await expect(upiRow).toContainText("UPI");
  await expect(shopRow).not.toContainText("UPI");

  const chips = page.getByRole("group", { name: "Filter by payment method" });
  await chips.getByRole("button", { name: /^UPI/ }).click();
  await expect(page).toHaveURL(/[?&]method=upi\b/);
  await expect(upiRow).toBeVisible();
  await expect(shopRow).toHaveCount(0);
  await expect(page.getByText("1 of 2 expenses · UPI · ₹640.00")).toBeVisible();

  // Kept across a reload; Not set added alongside.
  await page.reload();
  await expect(chips.getByRole("button", { name: /^UPI/ })).toHaveAttribute("aria-pressed", "true");
  await chips.getByRole("button", { name: /^Not set/ }).click();
  await expect(page).toHaveURL(/method=upi%2Cnone|method=upi,none/);
  await expect(shopRow).toBeVisible();
  await chips.getByRole("button", { name: /^UPI/ }).click();
  await chips.getByRole("button", { name: /^Not set/ }).click();
  await chips.getByRole("button", { name: /^Cash/ }).click();
  await expect(page.getByText("Nothing paid with Cash this cycle.")).toBeVisible();
  await chips.getByRole("button", { name: "All" }).click();
  await expect(page).not.toHaveURL(/method=/);

  await show(page, "Reports");
  await page.getByRole("tab", { name: /Spending habits/ }).click();
  const card = page.locator("#pm-card");
  await expect(card.getByRole("heading", { name: "Spend by payment method" })).toBeVisible();
  await expect(card.getByRole("button", { name: /^UPI: ₹640.00/ })).toBeVisible();
  await expect(card.getByRole("button").last()).toHaveAccessibleName(/^Not set: ₹300.00/); // Not set is last

  // Change it to a credit card in Edit entry.
  await show(page, "Home");
  await upiRow.click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByRole("radio", { name: "UPI" })).toHaveAttribute("aria-checked", "true");
  await edit.getByRole("radio", { name: "Credit card" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(upiRow).toContainText("Credit");
});
