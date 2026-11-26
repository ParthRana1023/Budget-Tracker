import { test, expect } from "@playwright/test";
import { setUpAccount, show } from "./helpers";

// Design handoff, Dashboard. A fresh account set up with ₹1,00,000 pay, 20% savings,
// a ₹28,000 rent bill and a ₹10,000 groceries limit, before any salary is recorded.

test.describe("Dashboard", () => {
  test("shows the cycle, safe to spend, budgets and bills from onboarding", async ({ page }) => {
    await setUpAccount(page);

    await expect(page.getByText(/^Cycle .* · Day \d+ of \d+$/)).toBeVisible();
    // No salary recorded yet: nothing is safe to spend.
    await expect(page.getByTestId("safe-to-spend")).toHaveText("₹0.00", { timeout: 5_000 });
    await expect(page.getByText(/after ₹20,000.00 to savings and ₹28,000.00 in bills still due/)).toBeVisible();

    await show(page, "Budgets");
    const groceries = page.locator('[data-testid="budget-row"][data-name="Groceries"]');
    await expect(groceries).toContainText("₹0.00 / ₹10,000.00");
    await expect(page.locator('[data-testid="budget-row"][data-name="Dining out"]')).toContainText("no limit");

    await show(page, "Bills");
    await expect(page.locator('[data-testid="bill-row"][data-name="Rent"]')).toContainText("Fixed bill");
    await show(page, "Home");
    await expect(page.getByRole("img", { name: /Money left this cycle/ })).toBeVisible();
    await expect(page.getByText(/Until payday · \d+ days/)).toBeVisible();
  });

  test("goals: create, add money, edit and delete", async ({ page }) => {
    await setUpAccount(page);
    await show(page, "Goals");
    await expect(page.getByText("No goals yet.")).toBeVisible();

    await page.getByRole("button", { name: "New goal" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Goal name").fill("Emergency fund");
    await dialog.getByLabel("Target amount").fill("100000");
    await dialog.getByLabel(/Already saved/).fill("25000");
    await dialog.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Created Emergency fund" })).toBeVisible();

    const goal = page.locator('[data-testid="goal-row"][data-name="Emergency fund"]');
    await expect(goal).toContainText("₹25,000.00 of ₹1,00,000.00");
    await expect(goal).toContainText("25%");
    // No target month chosen: an open-ended goal, with no monthly figure or on-track bar.
    await expect(goal).toContainText("No end date");
    await expect(goal).not.toContainText("a month");

    await goal.getByRole("button", { name: "Add money to Emergency fund" }).click();
    await page.getByRole("dialog").getByLabel("Amount").fill("5000");
    await page.getByRole("dialog").getByRole("button", { name: "Add ₹5,000.00" }).click();
    await expect(goal).toContainText("₹30,000.00 of ₹1,00,000.00");

    await goal.getByRole("button", { name: "Edit Emergency fund" }).click();
    await page.getByRole("dialog").getByLabel("Goal name").fill("Rainy day");
    await page.getByRole("dialog").getByRole("button", { name: "Save goal" }).click();
    const renamed = page.locator('[data-testid="goal-row"][data-name="Rainy day"]');
    await expect(renamed).toBeVisible();

    await renamed.getByRole("button", { name: "Rainy day options" }).click();
    await page.getByRole("menuitem", { name: "Delete goal" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete goal" }).click();
    await expect(renamed).toHaveCount(0);
    // Undo puts it back with its money.
    await page
      .getByRole("status")
      .filter({ hasText: "Deleted Rainy day" })
      .getByRole("button", { name: "Undo" })
      .click();
    await expect(renamed).toContainText("₹30,000.00 of ₹1,00,000.00");
  });

  test("goals: sub-goals, split a goal that holds money, Undo, delete by typing its name", async ({ page }) => {
    test.setTimeout(90_000);
    await setUpAccount(page);
    await show(page, "Goals");
    const toast = (text: string) => page.getByRole("status").filter({ hasText: text });

    // A goal with nothing in it gets sub-goals one at a time.
    await page.getByRole("button", { name: "New goal" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Goal name").fill("House");
    await dialog.getByLabel("Target amount").fill("500000");
    await dialog.getByRole("button", { name: "Create goal" }).click();
    const house = page.locator('[data-testid="goal-row"][data-name="House"]');
    await house.getByRole("button", { name: "House options" }).click();
    await page.getByRole("menuitem", { name: "Add sub-goal" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Part of House");
    await dialog.getByLabel("Goal name").fill("Deposit");
    await dialog.getByLabel("Target amount").fill("300000");
    await dialog.getByRole("button", { name: "Add sub-goal" }).click();
    await expect(toast("Added Deposit to House")).toBeVisible();
    await expect(house).toContainText("Total of 1 sub-goal");
    await expect(house.getByRole("button", { name: "Add money to House" })).toHaveCount(0);
    await expect(house.getByRole("button", { name: "Hide 1 sub-goal" })).toHaveAttribute("aria-expanded", "true");

    // A goal that already holds money is split, and the money is shared out.
    await page.getByRole("button", { name: "New goal" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Goal name").fill("Holiday");
    await dialog.getByLabel("Target amount").fill("60000");
    await dialog.getByLabel(/Already saved/).fill("10000");
    await dialog.getByRole("button", { name: "Create goal" }).click();
    const holiday = page.locator('[data-testid="goal-row"][data-name="Holiday"]');
    await holiday.getByRole("button", { name: "Holiday options" }).click();
    await page.getByRole("menuitem", { name: /Split into sub-goals/ }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Split Holiday" })).toBeVisible();
    await dialog.getByLabel("Name").first().fill("Flights");
    await dialog.getByLabel("Target").first().fill("40000");
    await dialog.getByLabel("Name").nth(1).fill("Hotel");
    await dialog.getByLabel("Target").nth(1).fill("20000");
    await dialog.getByRole("radio", { name: /I’ll choose/ }).click();
    await dialog.getByRole("button", { name: "Put all ₹10,000.00 into Flights" }).click();
    await expect(dialog.getByRole("status")).toContainText("All placed");
    await dialog.getByRole("button", { name: "Split goal" }).click();
    await expect(toast("Split Holiday into 2 sub-goals · ₹10,000.00 shared out")).toBeVisible();
    await expect(page.locator('[data-testid="sub-goal-row"][data-name="Flights"]')).toContainText(
      "₹10,000.00 of ₹40,000.00",
    );
    await expect(holiday).toContainText("₹10,000.00 of ₹60,000.00");

    // Undo the split: one goal again, with its money.
    await toast("Split Holiday").getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-testid="sub-goal-row"][data-name="Flights"]')).toHaveCount(0);
    await expect(holiday).toContainText("₹10,000.00 of ₹60,000.00");

    // Deleting a main goal with sub-goals needs its name typed.
    await house.getByRole("button", { name: "House options" }).click();
    await page.getByRole("menuitem", { name: "Delete goal" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Deposit");
    await dialog.getByRole("button", { name: "Delete goal" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Type “House” to confirm.");
    await dialog.getByLabel("Type “House” to confirm").fill("house");
    await dialog.getByRole("button", { name: "Delete goal" }).click();
    await expect(toast("Deleted House and 1 sub-goal")).toBeVisible();
    await expect(house).toHaveCount(0);
  });

  test("a goal form checks its fields and asks before discarding", async ({ page }) => {
    await setUpAccount(page);
    await show(page, "Goals");
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
    await expect(page.getByText(/0 entries · ₹0.00 spent this cycle/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Ledger" })).toHaveAttribute("aria-expanded", "false");
  });

  test("account menu: keyboard, links, and sign out asks first", async ({ page }) => {
    await setUpAccount(page);
    const avatar = page.getByRole("button", { name: /^Account menu/ });
    await avatar.click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(avatar).toBeFocused();

    // Log expense and Record income live on the Dashboard tab only.
    await show(page, "Reports");
    await expect(page.getByRole("button", { name: "Log expense" })).toHaveCount(0);
    await show(page, "Home");

    await avatar.click();
    await menu.getByRole("menuitem", { name: "Account profile" }).click();
    await page.waitForURL("**/settings/account");
    await show(page, "Home");
    await page.waitForURL("**/dashboard");

    await avatar.click();
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("dialog")).toContainText("Everything you’ve logged stays saved.");
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
