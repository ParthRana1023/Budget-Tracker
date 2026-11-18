import { test, expect } from "@playwright/test";
import { setUpAccount } from "./helpers";

// Design handoff, Dashboard. A fresh account set up with ₹1,00,000 pay, 20% savings,
// a ₹28,000 rent bill and a ₹10,000 groceries limit, before any salary is recorded.

test.describe("Dashboard", () => {
  test("shows the cycle, safe to spend, budgets and bills from onboarding", async ({ page }) => {
    await setUpAccount(page);

    await expect(page.getByText(/^Cycle .* · Day \d+ of \d+$/)).toBeVisible();
    // No salary recorded yet: savings and rent already come off, so safe to spend is negative.
    await expect(page.getByTestId("safe-to-spend")).toHaveText("−₹48,000", { timeout: 5_000 });
    await expect(page.getByText(/after ₹20,000 to savings and ₹28,000 in bills still due/)).toBeVisible();

    const groceries = page.locator('[data-testid="budget-row"][data-name="Groceries"]');
    await expect(groceries).toContainText("₹0 / ₹10,000");
    await expect(page.locator('[data-testid="budget-row"][data-name="Dining out"]')).toContainText("no limit");

    await expect(page.locator('[data-testid="bill-row"][data-name="Rent"]')).toContainText("Fixed bill");
    await expect(page.getByRole("img", { name: /Money left this cycle/ })).toBeVisible();
    await expect(page.getByText(/Until payday · \d+ days/)).toBeVisible();
  });

  test("goals: create, add money, edit and delete", async ({ page }) => {
    await setUpAccount(page);
    await expect(page.getByText("No goals yet.")).toBeVisible();

    await page.getByRole("button", { name: "New goal" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Goal name").fill("Emergency fund");
    await dialog.getByLabel("Target amount").fill("100000");
    await dialog.getByLabel(/Already saved/).fill("25000");
    await dialog.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Created Emergency fund" })).toBeVisible();

    const goal = page.locator('[data-testid="goal-row"][data-name="Emergency fund"]');
    await expect(goal).toContainText("₹25,000 of ₹1,00,000");
    await expect(goal).toContainText("25%");

    await goal.getByRole("button", { name: "Add money to Emergency fund" }).click();
    await page.getByRole("dialog").getByLabel("Amount").fill("5000");
    await page.getByRole("dialog").getByRole("button", { name: "Add ₹5,000" }).click();
    await expect(goal).toContainText("₹30,000 of ₹1,00,000");

    await goal.getByRole("button", { name: "Edit Emergency fund" }).click();
    await page.getByRole("dialog").getByLabel("Goal name").fill("Rainy day");
    await page.getByRole("dialog").getByRole("button", { name: "Save goal" }).click();
    const renamed = page.locator('[data-testid="goal-row"][data-name="Rainy day"]');
    await expect(renamed).toBeVisible();

    await renamed.getByRole("button", { name: "Delete Rainy day" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete goal" }).click();
    await expect(renamed).toHaveCount(0);
  });

  test("a goal form checks its fields and asks before discarding", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "New goal" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create goal" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Give the goal a name.");
    await dialog.getByLabel("Goal name").fill("Car");
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("alertdialog")).toContainText("Discard what you’ve entered?");
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the ledger collapses and remembers it", async ({ page }) => {
    await setUpAccount(page);
    const toggle = page.getByRole("button", { name: "Ledger" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText(/0 entries · ₹0 spent this cycle/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Ledger" })).toHaveAttribute("aria-expanded", "false");
  });

  test("sign out asks first", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("dialog")).toContainText("Everything you’ve logged stays saved.");
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
