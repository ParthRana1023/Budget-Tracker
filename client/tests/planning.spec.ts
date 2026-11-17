// End-to-end check of the analytics, planning and goal features on a real Supabase
// (needs `supabase start --workdir server` + migrations, like the other specs).
import { test, expect, Page } from "@playwright/test";
import { signUpFreshUser, openCategoryModal } from "./helpers";

const row = (page: Page, name: string) => page.locator(`[data-testid="category-row"][data-name="${name}"]`);

async function logExpense(page: Page, amount: string, category: string) {
  await page.locator("#open-fast-expense-btn").click();
  const modal = page.getByTestId("expense-modal");
  await modal.getByPlaceholder("0").fill(amount);
  await modal.locator(`[data-testid="expense-category"][data-name="${category}"]`).click();
  await modal.locator("#save-expense-btn").click();
  await expect(modal).toHaveCount(0);
}

test("analytics, budget planner and goal analytics work end to end on real data", async ({ page }) => {
  test.setTimeout(90_000); // one long journey (~30 steps); the 30s default is too tight under parallel load
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await signUpFreshUser(page);

  // Income received this cycle.
  await page.locator("#open-income-btn").click();
  const income = page.getByTestId("income-modal");
  await income.getByPlaceholder("e.g. October Salary, Quarterly Bonus").fill("Salary");
  await income.getByPlaceholder("0").fill("90000");
  await income.getByRole("button", { name: "Save Income" }).click();
  await expect(income).toHaveCount(0);

  // Shopping limit ₹4,000, then spend ₹5,000 there (over budget) and ₹3,000 on groceries.
  await openCategoryModal(page);
  await row(page, "Shopping").getByTestId("category-edit-btn").click();
  await page.getByTestId("category-edit-limit").fill("4000");
  await page.getByTestId("category-edit-save").click();
  await expect(row(page, "Shopping").getByTestId("category-limit")).toContainText("₹4,000");
  await page.getByTestId("category-modal").locator("button:has(svg.lucide-x)").first().click();
  await expect(page.getByTestId("category-modal")).toHaveCount(0);

  await logExpense(page, "5000", "Shopping");
  await logExpense(page, "3000", "Groceries");

  // Savings contribution to the starter Emergency Fund goal.
  await page.getByRole("button", { name: "Contribute" }).first().click();
  await page.locator('form input[placeholder="0"]').last().fill("10000");
  await page.getByRole("button", { name: "Save Contribution" }).click();
  await expect(page.getByText("₹10,000").first()).toBeVisible();

  // Dashboard: new sections render with real numbers.
  await expect(page.getByRole("heading", { name: "Spending Pace" })).toBeVisible();
  await expect(page.getByText("Budget exceeded")).toBeVisible(); // 5,000 > 4,000 flexible budget
  await expect(page.getByRole("heading", { name: "Upcoming Recurring Payments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Budget vs Actual" })).toBeVisible();
  // Goal analytics on the Emergency Fund card.
  await expect(page.getByText("Current pace (last 90 days)").first()).toBeVisible();

  // Budget vs Actual table: Shopping is over budget; selecting it filters the transaction list.
  const bva = page.locator("section", { has: page.getByRole("heading", { name: "Budget vs Actual" }) });
  await bva.getByRole("button", { name: "Table" }).click();
  await expect(bva.locator("tr", { hasText: "Shopping" })).toContainText("Over budget");
  await bva.locator("tr", { hasText: "Shopping" }).getByRole("button", { name: "Shopping" }).click();
  const filter = page.locator("select").filter({ has: page.locator("option", { hasText: "All Categories" }) }).first();
  await expect(filter).not.toHaveValue("all");

  // Reports: insights reflect the overspend; charts render without errors.
  await page.getByRole("button", { name: "Reports & Trends" }).first().click();
  await expect(page.getByRole("heading", { name: "Financial Insights" })).toBeVisible();
  await expect(page.getByText(/Shopping is ₹1,000 over its budget/)).toBeVisible();
  for (const h of ["Monthly Cash Flow", "Savings Rate Trend", "Expense Distribution", "Performance Indicators"]) {
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  }

  // Plan: simulate, save, reload, apply.
  await page.getByRole("button", { name: "Plan" }).first().click();
  await expect(page.getByRole("heading", { name: /Budget Planner/ })).toBeVisible();
  await expect(page.getByText("one-time database update")).toHaveCount(0); // migration is applied
  await page.getByLabel("Shopping planned limit", { exact: true }).fill("3000");
  await expect(page.getByText("Simulated — not saved")).toBeVisible();
  await page.getByRole("button", { name: "Save plan" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Starting from your saved plan/)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole("button", { name: "Plan" }).first().click();
  await expect(page.getByText(/Starting from your saved plan/)).toBeVisible();
  await expect(page.getByLabel("Shopping planned limit", { exact: true })).toHaveValue("3000");

  // Saving did not change the live limit; applying does.
  await page.getByRole("button", { name: /Apply limits to my categories now/ }).click();
  await expect(page.getByText("Shopping: ₹4,000 → ₹3,000")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Category limits updated from the plan.")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Dashboard" }).first().click();
  await openCategoryModal(page);
  await expect(row(page, "Shopping").getByTestId("category-limit")).toContainText("₹3,000");
  await page.getByTestId("category-modal").locator("button:has(svg.lucide-x)").first().click();

  // Dark mode toggle keeps everything rendering.
  await page.getByRole("button", { name: /Switch to dark mode/ }).click();
  await page.getByRole("button", { name: "Reports & Trends" }).first().click();
  await expect(page.getByRole("heading", { name: "Monthly Cash Flow" })).toBeVisible();

  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
