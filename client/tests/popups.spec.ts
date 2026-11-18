import { test, expect, Page } from "@playwright/test";
import { setUpAccount } from "./helpers";

// Design handoff, Dashboard → Popups. Every test starts from setUpAccount:
// ₹1,00,000 pay, 20% savings, ₹28,000 rent, ₹10,000 groceries limit, no salary recorded yet.

const dialog = (page: Page) => page.getByRole("dialog");
const toast = (page: Page, text: string | RegExp) => page.getByRole("status").filter({ hasText: text });
const safe = (page: Page) => page.getByTestId("safe-to-spend");

async function logExpense(page: Page, amount: string, category: string, extra?: (d: ReturnType<typeof dialog>) => Promise<void>) {
  await page.getByRole("button", { name: "Log expense" }).first().click();
  await dialog(page).getByLabel("Amount").fill(amount);
  await dialog(page).getByRole("button", { name: new RegExp(`^${category}`) }).click();
  if (extra) await extra(dialog(page));
  await dialog(page).getByRole("button", { name: /^Log ₹/ }).click();
  await expect(dialog(page)).toHaveCount(0);
}

test.describe("Popups", () => {
  test("Log expense: checks, preview, save and Undo", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "Log expense" }).first().click();
    await dialog(page).getByRole("button", { name: "Log expense" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Enter an amount above ₹0.");
    await dialog(page).getByRole("button", { name: "+500" }).click();
    await expect(dialog(page).getByLabel("Amount")).toHaveValue("500");
    await dialog(page).getByRole("button", { name: "Log ₹500" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Pick a category.");
    await dialog(page).getByRole("button", { name: /^Groceries/ }).click();
    await expect(dialog(page).getByText("After this")).toBeVisible();
    await expect(dialog(page)).toContainText("−₹48,500");
    await dialog(page).getByLabel("Payee").fill("DMart");
    await dialog(page).getByRole("button", { name: "Log ₹500" }).click();

    await expect(toast(page, "Logged ₹500 to Groceries")).toBeVisible();
    await expect(page.locator('[data-testid="budget-row"][data-name="Groceries"]')).toContainText("₹500 / ₹10,000");
    await expect(page.getByRole("button", { name: /Edit Groceries, − ₹500/ })).toBeVisible();

    await toast(page, "Logged ₹500").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-testid="budget-row"][data-name="Groceries"]')).toContainText("₹0 / ₹10,000");
  });

  test("Record income raises safe to spend; expected income waits on hold", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "Record income" }).first().click();
    await dialog(page).getByLabel("Amount").fill("100000");
    await expect(dialog(page)).toContainText("+₹1,00,000");
    await dialog(page).getByRole("button", { name: "Save ₹1,00,000" }).click();
    await expect(toast(page, "Added ₹1,00,000 to this cycle’s income")).toBeVisible();
    // 1,00,000 − 20,000 savings − 28,000 rent
    await expect(safe(page)).toHaveText("₹52,000", { timeout: 5_000 });

    await page.getByRole("button", { name: "Record income" }).first().click();
    await dialog(page).getByLabel("Amount").fill("60000");
    await dialog(page).getByRole("radio", { name: "Variable pay" }).click();
    await expect(dialog(page).getByRole("radio", { name: /Expected later/ })).toHaveAttribute("aria-checked", "true");
    await dialog(page).getByLabel("Source").fill("Annual bonus");
    await dialog(page).getByRole("button", { name: "Save ₹60,000" }).click();
    await expect(toast(page, "₹60,000 is on hold until it reaches your bank")).toBeVisible();
    await expect(page.getByText(/Annual bonus, expected .*Not counted until it reaches your bank\./)).toBeVisible();
    await expect(safe(page)).toHaveText("₹52,000");
  });

  test("Bonus split: savings to a goal, the rest to the reserve and this cycle", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "New goal" }).click();
    await dialog(page).getByLabel("Goal name").fill("Emergency fund");
    await dialog(page).getByLabel("Target amount").fill("100000");
    await dialog(page).getByRole("button", { name: "Create goal" }).click();
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Record expected income" }).click();
    await dialog(page).getByLabel("Amount").fill("60000");
    await dialog(page).getByRole("button", { name: "Save ₹60,000" }).click();
    await expect(dialog(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Mark received & allocate" }).click();
    await expect(dialog(page).getByLabel("Amount to savings")).toHaveValue("30000");
    await dialog(page).getByLabel("Amount to spend this cycle").fill("1000");
    await expect(dialog(page)).toContainText("₹11,000 still to allocate.");
    await dialog(page).getByRole("button", { name: "Confirm & allocate" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("The three amounts need to add up to ₹60,000.");
    await dialog(page).getByRole("button", { name: /50 \/ 30 \/ 20/ }).click();
    await dialog(page).getByRole("button", { name: "Confirm & allocate" }).click();

    await expect(toast(page, "Allocated ₹60,000 · ₹12,000 added to safe to spend")).toBeVisible();
    await expect(page.locator('[data-testid="goal-row"][data-name="Emergency fund"]')).toContainText("₹30,000 of ₹1,00,000");
    await expect(page.getByText("₹18,000 set aside from windfalls · ₹0 used")).toBeVisible();
    // The reserve can now pay a bill without touching safe to spend.
    await page.getByRole("button", { name: "Pay a bill from it" }).click();
    await expect(dialog(page).getByRole("switch", { name: "Pay from annual bills reserve" })).toHaveAttribute("aria-checked", "true");
  });

  test("Edit entry and delete it", async ({ page }) => {
    await setUpAccount(page);
    await logExpense(page, "800", "Groceries");
    await page.getByRole("button", { name: /Edit Groceries, − ₹800/ }).click();
    await expect(dialog(page)).toContainText("Edit entry");
    await dialog(page).getByLabel("Amount").fill("650");
    await dialog(page).getByRole("button", { name: "Save changes" }).click();
    await expect(toast(page, "Entry updated")).toBeVisible();
    await page.getByRole("button", { name: /Edit Groceries, − ₹650/ }).click();
    await dialog(page).getByRole("button", { name: "Delete this entry" }).click();
    await dialog(page).getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: /Edit Groceries/ })).toHaveCount(0);
  });

  test("Categories: changes apply on close, with Undo", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "Manage" }).click();
    await dialog(page).getByLabel("Groceries name").fill("Food");
    await dialog(page).getByLabel("New category name").fill("Pets");
    await dialog(page).getByLabel("Monthly limit", { exact: true }).fill("2000");
    await dialog(page).getByRole("button", { name: "Add", exact: true }).click();
    await dialog(page).getByRole("tab", { name: /Fixed bills/ }).click();
    await dialog(page).getByLabel("Rent monthly amount").fill("");
    await dialog(page).getByRole("button", { name: "Done" }).click();
    await expect(dialog(page).getByRole("alert")).toContainText("Rent needs a monthly amount above ₹0.");
    await dialog(page).getByLabel("Rent monthly amount").fill("30000");
    await page.keyboard.press("Escape");

    await expect(toast(page, "Categories updated")).toBeVisible();
    await expect(page.locator('[data-testid="budget-row"][data-name="Food"]')).toBeVisible();
    await expect(page.locator('[data-testid="budget-row"][data-name="Pets"]')).toContainText("₹0 / ₹2,000");
    await toast(page, "Categories updated").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-testid="budget-row"][data-name="Groceries"]')).toBeVisible();
    await expect(page.locator('[data-testid="budget-row"][data-name="Pets"]')).toHaveCount(0);
  });

  test("Recurring: due items wait for Record, can be skipped, and edited", async ({ page }) => {
    await setUpAccount(page);
    // A monthly gym fee due on the 1st, then this month's entry removed: it is now due.
    await logExpense(page, "1500", "Dining out", async (d) => {
      await d.getByLabel("Note").fill("Gym");
      await d.getByRole("switch", { name: "Repeat every month" }).click();
      await d.getByLabel("Due on day").fill("1");
    });
    await expect(page.locator('[data-testid="recurring-row"][data-name="Gym"]')).toContainText("Recorded");
    await page.getByRole("button", { name: /Edit Gym, − ₹1,500/ }).click();
    await dialog(page).getByRole("button", { name: "Delete this entry" }).click();
    await dialog(page).getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

    const notices = page.getByRole("region", { name: "Notices" });
    await expect(notices).toContainText("Gym");
    await notices.getByRole("button", { name: "Skip Gym this month" }).click();
    await expect(page.locator('[data-testid="recurring-row"][data-name="Gym"]')).toContainText("Skipped this month");
    await toast(page, "Skipped Gym").getByRole("button", { name: "Undo" }).click();
    await notices.getByRole("button", { name: "Record Gym" }).click();
    await expect(toast(page, "Recorded Gym · ₹1,500")).toBeVisible();
    await expect(page.locator('[data-testid="recurring-row"][data-name="Gym"]')).toContainText("Recorded");

    await page.getByRole("button", { name: "Edit Gym", exact: true }).click();
    await dialog(page).getByLabel("Name").fill("Gym membership");
    await dialog(page).getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator('[data-testid="recurring-row"][data-name="Gym membership"]')).toBeVisible();
  });
});
