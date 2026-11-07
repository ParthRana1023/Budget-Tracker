import { test, expect, Page } from "@playwright/test";
import { lastMonth15th, signUpFreshUser } from "./helpers";

// Recurring income / expenses live inside the expense and income pop-ups: a checkbox,
// suggestions at the top, and an optional day for automatic recording. There is no
// separate recurring section.

const expenseModal = (page: Page) => page.getByTestId("expense-modal");
const incomeModal = (page: Page) => page.getByTestId("income-modal");
const suggestion = (page: Page, name: string) => page.locator(`[data-testid="recurring-suggestion"][data-name="${name}"]`);

async function openExpense(page: Page) {
  await page.locator("#open-fast-expense-btn").click();
  await expect(expenseModal(page)).toBeVisible();
}

async function openIncome(page: Page) {
  await page.locator("#open-income-btn").click();
  await expect(incomeModal(page)).toBeVisible();
}

async function logExpense(page: Page, o: { amount: string; category: string; note?: string; date?: string; recurring?: boolean; day?: string }) {
  await openExpense(page);
  const modal = expenseModal(page);
  await modal.getByPlaceholder("0").fill(o.amount);
  await modal.locator(`[data-testid="expense-category"][data-name="${o.category}"]`).click();
  if (o.note || o.date) {
    await modal.getByRole("button", { name: /Add note or change date/ }).click();
    if (o.date) await modal.locator('input[type="date"]').fill(o.date);
    if (o.note) await modal.getByPlaceholder("e.g. Swiggy lunch or fuel").fill(o.note);
  }
  if (o.recurring) {
    await modal.getByTestId("recurring-checkbox").check();
    if (o.day) await modal.getByTestId("recurring-day").fill(o.day);
  }
  await modal.locator("#save-expense-btn").click();
}

async function logIncome(page: Page, o: { name: string; amount: string; date?: string; recurring?: boolean; day?: string }) {
  await openIncome(page);
  const modal = incomeModal(page);
  await modal.getByPlaceholder("e.g. October Salary, Quarterly Bonus").fill(o.name);
  await modal.getByPlaceholder("0").fill(o.amount);
  if (o.date) await modal.locator('input[type="date"]').fill(o.date);
  if (o.recurring) {
    await modal.getByTestId("recurring-checkbox").check();
    if (o.day) await modal.getByTestId("recurring-day").fill(o.day);
  }
  await modal.getByRole("button", { name: "Save Income" }).click();
}

test.describe("Recurring items in the expense / income pop-ups", () => {
  test("there is no separate recurring section any more", async ({ page }) => {
    await signUpFreshUser(page);
    await expect(page.getByTestId("recurring-section")).toHaveCount(0);
  });

  test("ticking 'repeat every month' records the entry once, and the item becomes a suggestion", async ({ page }) => {
    await signUpFreshUser(page);
    await logExpense(page, { amount: "25000", category: "Rent / Housing", note: "Rent", recurring: true });
    await expect(expenseModal(page)).toHaveCount(0);

    await openExpense(page);
    await expect(suggestion(page, "Rent")).toContainText("₹25,000");
    await expect(suggestion(page, "Rent")).toContainText("suggestion only"); // no day was given
    await expect(suggestion(page, "Rent")).toContainText("recorded this month"); // this month's is the entry just made
    await expect(suggestion(page, "Rent").getByTestId("recurring-suggestion-pick")).toBeDisabled();
  });

  test("a suggestion fills the form, and recording it is allowed once per month", async ({ page }) => {
    await signUpFreshUser(page);
    // Entered for LAST month, so this month is still open for it.
    await logExpense(page, { amount: "25000", category: "Rent / Housing", note: "Rent", date: lastMonth15th(), recurring: true });

    await openExpense(page);
    const pick = suggestion(page, "Rent").getByTestId("recurring-suggestion-pick");
    await expect(pick).toBeEnabled();
    await pick.click();

    const modal = expenseModal(page);
    await expect(modal.getByPlaceholder("0")).toHaveValue("25000");
    await expect(modal.locator('[data-testid="expense-category"][data-name="Rent / Housing"]')).toHaveAttribute("aria-pressed", "true");
    await expect(modal.getByTestId("recurring-options")).toContainText("Using recurring: Rent");

    await modal.locator("#save-expense-btn").click();
    await expect(expenseModal(page)).toHaveCount(0);

    await openExpense(page);
    await expect(suggestion(page, "Rent")).toContainText("recorded this month");
    await expect(suggestion(page, "Rent").getByTestId("recurring-suggestion-pick")).toBeDisabled();
  });

  test("a recurring income appears as a suggestion in the income pop-up", async ({ page }) => {
    await signUpFreshUser(page);
    await logIncome(page, { name: "Salary", amount: "80000", date: lastMonth15th(), recurring: true });
    await expect(incomeModal(page)).toHaveCount(0);

    await openIncome(page);
    await expect(suggestion(page, "Salary")).toContainText("₹80,000");
    await suggestion(page, "Salary").getByTestId("recurring-suggestion-pick").click();
    await expect(incomeModal(page).getByPlaceholder("0")).toHaveValue("80000");
    await expect(incomeModal(page).getByPlaceholder("e.g. October Salary, Quarterly Bonus")).toHaveValue("Salary");
  });

  test("the recurring option is not offered for income that is only expected later", async ({ page }) => {
    await signUpFreshUser(page);
    await openIncome(page);
    await expect(incomeModal(page).getByTestId("recurring-checkbox")).toBeVisible();
    await incomeModal(page).getByRole("button", { name: /Expected Later/ }).click();
    await expect(incomeModal(page).getByTestId("recurring-checkbox")).toHaveCount(0);
  });

  test("an out-of-range auto-record day is rejected and nothing is saved", async ({ page }) => {
    await signUpFreshUser(page);
    await logExpense(page, { amount: "500", category: "Subscriptions", note: "Netflix", recurring: true, day: "29" });

    await expect(page.getByTestId("recurring-options-error")).toContainText("between 1 and 28");
    await expect(expenseModal(page)).toBeVisible(); // still open, entry not saved
    await expenseModal(page).getByRole("button", { name: "Cancel" }).click();

    await openExpense(page);
    await expect(page.getByTestId("recurring-suggestions")).toHaveCount(0);
  });

  test("a recurring item can be stopped from the suggestions; its past records stay", async ({ page }) => {
    await signUpFreshUser(page);
    await logExpense(page, { amount: "999", category: "Subscriptions", note: "Gym", date: lastMonth15th(), recurring: true });

    await openExpense(page);
    await suggestion(page, "Gym").getByTestId("recurring-suggestion-stop").click();
    await page.getByTestId("recurring-stop-confirm").click();
    await expect(suggestion(page, "Gym")).toHaveCount(0);

    await page.reload();
    await openExpense(page);
    await expect(suggestion(page, "Gym")).toHaveCount(0); // really deleted, not hidden
  });

  test.describe("automatic recording at the end of the scheduled day", () => {
    // Needs "day 1 of this month has ended", i.e. today is the 2nd or later.
    test.skip(new Date().getDate() < 2, "day 1 has not ended yet today");

    test("a recurring expense is recorded automatically, an alert appears, and Undo removes it for good", async ({ page }) => {
      await signUpFreshUser(page);
      await logExpense(page, { amount: "25000", category: "Rent / Housing", note: "Rent", date: lastMonth15th(), recurring: true, day: "1" });

      // The automatic recorder runs when the app opens.
      await page.reload();
      const alert = page.getByTestId("recurring-auto-alert");
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("recorded automatically");
      await expect(alert.locator('[data-testid="recurring-auto-entry"][data-name="Rent"]')).toContainText("₹25,000");
      await expect(page.getByText("Recurring: Rent")).toBeVisible();

      await alert.getByTestId("recurring-auto-undo").click();
      await expect(alert).toHaveCount(0);
      await expect(page.getByText("Recurring: Rent")).toHaveCount(0);

      // The undo sticks: opening the app again does not put it back.
      await page.reload();
      await expect(page.getByTestId("recurring-auto-alert")).toHaveCount(0);
      await expect(page.getByText("Recurring: Rent")).toHaveCount(0);
    });

    test("a recurring income is recorded automatically too", async ({ page }) => {
      await signUpFreshUser(page);
      await logIncome(page, { name: "Salary", amount: "80000", date: lastMonth15th(), recurring: true, day: "1" });

      await page.reload();
      const entry = page.locator('[data-testid="recurring-auto-entry"][data-name="Salary"]');
      await expect(entry).toBeVisible();
      await expect(entry).toContainText("+₹80,000");
      await expect(page.getByText("Recurring: Salary")).toBeVisible();

      await entry.getByTestId("recurring-auto-undo").click();
      await expect(entry).toHaveCount(0);
      await expect(page.getByText("Recurring: Salary")).toHaveCount(0);
    });

    test("dismissing the alert hides it without undoing anything", async ({ page }) => {
      await signUpFreshUser(page);
      await logExpense(page, { amount: "700", category: "Subscriptions", note: "Cloud storage", date: lastMonth15th(), recurring: true, day: "1" });

      await page.reload();
      await expect(page.getByTestId("recurring-auto-alert")).toBeVisible();
      await page.getByTestId("recurring-auto-dismiss").click();
      await expect(page.getByTestId("recurring-auto-alert")).toHaveCount(0);
      await expect(page.getByText("Recurring: Cloud storage")).toBeVisible(); // still recorded
    });
  });
});
