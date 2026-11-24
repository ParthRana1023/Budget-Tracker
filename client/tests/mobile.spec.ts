import { test, expect, type Page } from "@playwright/test";
import { isPhone, setUpAccount } from "./helpers";

// Design handoff v3, Mobile: bottom nav, phone pages, the Add sheet. Phone tests run in the
// mobile-chrome project; the wide-screen redirect runs in chromium.

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const tab = (page: Page, label: string) => nav(page).getByRole("button", { name: label, exact: true });

test.describe("Phones", () => {
  test.beforeEach(({ page }) => {
    test.skip(!isPhone(page), "Phone layout only");
  });

  test("the bottom nav switches pages in place and keeps the URL", async ({ page }) => {
    await setUpAccount(page);
    await expect(tab(page, "Home")).toHaveAttribute("aria-current", "page");
    // Home keeps the overview; budgets, bills and the ledger have their own pages.
    await expect(page.getByTestId("safe-to-spend")).toBeVisible();
    await expect(page.locator('[data-testid="budget-row"]').first()).toBeHidden();

    await tab(page, "Ledger").click();
    await expect(page).toHaveURL(/\/ledger$/);
    await expect(page.locator("#ledger-body")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ledger", expanded: true })).toHaveCount(0); // always open

    await tab(page, "More").click();
    await expect(page).toHaveURL(/\/more$/);
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();
    await page.getByRole("button", { name: /^Budgets/ }).click();
    await expect(page).toHaveURL(/\/budgets$/);
    await expect(page.locator('[data-testid="budget-row"][data-name="Groceries"]')).toContainText("₹0.00 / ₹10,000.00");
    await expect(tab(page, "More")).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "More", exact: true }).first().click();
    await page.getByRole("button", { name: /^Bills & recurring/ }).click();
    await expect(page.locator('[data-testid="bill-row"][data-name="Rent"]')).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/more$/);
    await expect(page.getByRole("heading", { name: "More" })).toBeVisible();

    // A phone page opens straight from its URL.
    await page.goto("/goals");
    await expect(page.getByText("No goals yet.")).toBeVisible();
  });

  test("Add opens a sheet: tabs keep the amount, a chip and Log make three taps", async ({ page }) => {
    await setUpAccount(page);
    await page.getByRole("button", { name: "Add an entry" }).click();
    const sheet = page.getByRole("dialog", { name: "Log expense" });
    await expect(sheet.getByRole("tab", { name: "Expense" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet.getByRole("button", { name: "Cancel" })).toBeHidden();
    await sheet.getByLabel("Amount").fill("250");

    await sheet.getByRole("tab", { name: "Income" }).click();
    const income = page.getByRole("dialog", { name: "Record income" });
    await expect(income.getByLabel("Amount")).toHaveValue("250");
    await income.getByRole("tab", { name: "Expense" }).click();
    await expect(sheet.getByLabel("Amount")).toHaveValue("250");

    await sheet.getByRole("group", { name: "Category" }).getByRole("button", { name: "Groceries" }).click();
    await sheet.getByRole("button", { name: "Log ₹250.00" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("Logged ₹250.00 to Groceries")).toBeVisible();

    await tab(page, "Ledger").click();
    await expect(page.locator("#ledger-body").getByRole("button", { name: /^Edit Groceries/ })).toBeVisible();
  });

  test("dragging the handle down closes the sheet, asking first when half-filled", async ({ page }) => {
    await setUpAccount(page);
    const drag = async () => {
      // Measure once the sheet has slid in and stopped growing: it's anchored to the bottom, so
      // content that appears while typing moves its top (and the handle) up.
      await expect(page.getByRole("dialog")).toHaveCSS("transform", "none");
      const handle = page.getByRole("dialog").locator(":scope > div").first(); // 26px, aria-hidden
      let box = (await handle.boundingBox())!;
      await expect
        .poll(async () => {
          const was = box.y;
          await page.waitForTimeout(150);
          box = (await handle.boundingBox())!;
          return box.y === was;
        })
        .toBe(true);
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 80, { steps: 4 });
      await page.mouse.move(x, y + 160, { steps: 4 });
      await page.mouse.up();
    };

    await page.getByRole("button", { name: "Add an entry" }).click();
    await page.getByRole("dialog").getByLabel("Amount").fill("90");
    await drag();
    await expect(page.getByRole("alertdialog", { name: "Discard changes" })).toBeVisible();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Add an entry" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await drag();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Settings keeps the bottom nav, with More active", async ({ page }) => {
    await setUpAccount(page);
    await page.goto("/settings");
    const more = nav(page).getByRole("link", { name: "More", exact: true });
    await expect(more).toHaveAttribute("aria-current", "page");
    await nav(page).getByRole("link", { name: "Home", exact: true }).click();
    await page.waitForURL("**/dashboard");
  });
});

test("on a wide screen a phone page becomes its Dashboard section", async ({ page }) => {
  test.skip(isPhone(page), "Wide screens only");
  await setUpAccount(page);
  await page.goto("/ledger");
  await expect(page).toHaveURL(/\/dashboard#ledger$/);
  await expect(page.locator("#ledger-body")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an entry" })).toBeHidden();
});
