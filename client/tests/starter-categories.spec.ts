import { test, expect } from "@playwright/test";
import { categoryNames, openCategoryModal, signUpFreshUser, STARTER_FIXED, STARTER_FLEXIBLE } from "./helpers";

const sorted = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));
const row = (page: import("@playwright/test").Page, name: string) => page.locator(`[data-testid="category-row"][data-name="${name}"]`);

test.describe("Starter categories", () => {
  test("a new user starts with the 13 starter categories, none with a limit", async ({ page }) => {
    await signUpFreshUser(page);
    await openCategoryModal(page);

    // Flexible tab is shown first.
    expect(await categoryNames(page)).toEqual(sorted(STARTER_FLEXIBLE));
    await expect(page.getByTestId("category-limit").filter({ hasText: "No limit set" })).toHaveCount(STARTER_FLEXIBLE.length);

    await page.getByRole("button", { name: /Fixed Categories/ }).click();
    expect(await categoryNames(page)).toEqual(sorted(STARTER_FIXED));
    await expect(page.getByTestId("category-limit").filter({ hasText: "No limit set" })).toHaveCount(STARTER_FIXED.length);
  });

  test("a starter category can be renamed and given a limit, and it persists", async ({ page }) => {
    await signUpFreshUser(page);
    await openCategoryModal(page);

    await row(page, "Groceries").getByTestId("category-edit-btn").click();
    await page.getByTestId("category-edit-name").fill("Groceries & Staples");
    await page.getByTestId("category-edit-limit").fill("12000");
    await page.getByTestId("category-edit-save").click();

    await expect(row(page, "Groceries & Staples").getByTestId("category-limit")).toContainText("₹12,000");
    await expect(row(page, "Groceries")).toHaveCount(0);

    await page.reload();
    await openCategoryModal(page);
    await expect(row(page, "Groceries & Staples").getByTestId("category-limit")).toContainText("₹12,000");
  });

  test("renaming onto an existing name, or to nothing, is rejected", async ({ page }) => {
    await signUpFreshUser(page);
    await openCategoryModal(page);

    await row(page, "Health").getByTestId("category-edit-btn").click();
    await page.getByTestId("category-edit-name").fill("travel"); // case-insensitive clash with "Travel"
    await page.getByTestId("category-edit-save").click();
    await expect(page.getByTestId("category-error")).toContainText("already exists");

    await page.getByTestId("category-edit-name").fill("   ");
    await page.getByTestId("category-edit-save").click();
    await expect(page.getByTestId("category-error")).toContainText("cannot be empty");

    await expect(row(page, "Health")).toHaveCount(1); // nothing was renamed
  });

  test("a custom category can be added, and a duplicate name is rejected", async ({ page }) => {
    await signUpFreshUser(page);
    await openCategoryModal(page);

    await page.getByTestId("add-category-btn").click();
    await page.getByLabel("Category name").fill("Gym");
    await page.getByLabel("Monthly limit in rupees").fill("1500");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row(page, "Gym").getByTestId("category-limit")).toContainText("₹1,500");

    await page.getByTestId("add-category-btn").click();
    await page.getByLabel("Category name").fill("gym");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByTestId("category-error")).toContainText("already exists");
  });

  test("a deleted starter category can be restored, and restoring twice is a no-op", async ({ page }) => {
    await signUpFreshUser(page);
    await openCategoryModal(page);

    page.once("dialog", (dialog) => dialog.accept());
    await row(page, "Travel").getByRole("button", { name: "Delete Travel" }).click();
    await expect(row(page, "Travel")).toHaveCount(0);

    await page.getByTestId("restore-starters").click();
    await expect(page.getByTestId("category-info")).toContainText("Restored 1 starter category");
    await expect(row(page, "Travel").getByTestId("category-limit")).toContainText("No limit set");

    await page.getByTestId("restore-starters").click();
    await expect(page.getByTestId("category-info")).toContainText("already present");
    expect(await categoryNames(page)).toEqual(sorted(STARTER_FLEXIBLE));
  });

  test("restore does not overwrite a category the user has customised", async ({ page }) => {
    await signUpFreshUser(page);
    await openCategoryModal(page);

    await row(page, "Shopping").getByTestId("category-edit-btn").click();
    await page.getByTestId("category-edit-limit").fill("6000");
    await page.getByTestId("category-edit-save").click();
    await expect(row(page, "Shopping").getByTestId("category-limit")).toContainText("₹6,000");

    await page.getByTestId("restore-starters").click();
    await expect(page.getByTestId("category-info")).toContainText("already present");
    await expect(row(page, "Shopping").getByTestId("category-limit")).toContainText("₹6,000");
  });
});
