import { test, expect, Page } from "@playwright/test";
import { onboardingNext, signUpFreshUser, skipOnboarding } from "./helpers";

// Design handoff, Onboarding: five steps, nothing blocks, saved together at the end.

const summaryRow = (page: Page, label: string | RegExp) =>
  page.getByRole("main").locator("form div").filter({ hasText: label }).last();

test.describe("Onboarding", () => {
  test("a new account goes to onboarding; every step can be skipped", async ({ page }) => {
    await signUpFreshUser(page);

    // Signed in but not set up: the dashboard sends you back here.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding$/);

    await expect(onboardingNext(page)).toHaveText("Skip for now");
    for (let step = 1; step <= 4; step++) await onboardingNext(page).click();

    await expect(page.getByText("Step 5 of 5")).toBeVisible();
    await expect(summaryRow(page, "Take-home pay")).toContainText("Add later");
    await expect(summaryRow(page, "Fixed bills")).toContainText("None yet");
    await expect(summaryRow(page, "Flexible limits you set")).toContainText("Suggested later");
    await expect(page.getByRole("complementary")).toContainText("₹—");

    await page.getByRole("button", { name: "Open my dashboard" }).click();
    await page.waitForURL("**/dashboard");

    // Onboarding runs once.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("answers carry through to the summary and the safe-to-spend preview", async ({ page }) => {
    await signUpFreshUser(page);

    // Step 1: income. Pay day: 1st-28th, or the last day of the month.
    await page.fill("#ob-sal", "100000");
    await page.getByLabel("Salary lands on").selectOption({ label: "Last day of the month" });
    await expect(page.locator("#ob-day")).toHaveValue("31");
    await expect(onboardingNext(page)).toHaveText("Continue");
    await onboardingNext(page).click();

    // Step 2: savings.
    await page.getByRole("button", { name: "20%" }).click();
    await expect(page.getByText("₹20,000").first()).toBeVisible();
    await page.getByRole("button", { name: "Raise savings target" }).click();
    await expect(page.getByText("21%")).toBeVisible();
    await page.getByRole("button", { name: "Lower savings target" }).click();
    await onboardingNext(page).click();

    // Step 3: bills. Electricity has no amount, so it is dropped on Continue.
    await page.getByLabel("Rent amount").fill("28000");
    await page.getByLabel("Internet amount").fill("1200");
    await onboardingNext(page).click();

    // Step 4: categories. Limits are blank by default.
    await expect(page.getByLabel("Groceries monthly limit")).toHaveAttribute("placeholder", "Not sure yet");
    await page.getByLabel("Groceries monthly limit").fill("10000");
    await page.getByRole("button", { name: "Travel" }).click();
    await expect(page.getByRole("button", { name: "Travel" })).toHaveAttribute("aria-pressed", "true");

    // Back keeps what was entered.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByLabel("Rent amount")).toHaveValue("28000");
    await expect(page.getByLabel("Electricity amount")).toHaveCount(0);
    await onboardingNext(page).click();
    await onboardingNext(page).click();

    // Step 5: summary. 1,00,000 − 20% − (28,000 + 1,200) = 50,800.
    await expect(summaryRow(page, "Take-home pay")).toContainText("₹1,00,000");
    await expect(summaryRow(page, "Savings · 20%")).toContainText("−₹20,000");
    await expect(summaryRow(page, "Fixed bills")).toContainText("−₹29,200");
    await expect(summaryRow(page, "Safe to spend")).toContainText("₹50,800");
    await expect(summaryRow(page, "Flexible limits you set")).toContainText("₹10,000");
    await expect(page.getByRole("complementary")).toContainText("₹50,800");

    await page.getByRole("button", { name: "Open my dashboard" }).click();
    await page.waitForURL("**/dashboard", { timeout: 20_000 });
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("savings and bills above the pay show a warning", async ({ page }) => {
    await signUpFreshUser(page);
    await page.fill("#ob-sal", "20000");
    await onboardingNext(page).click();
    await onboardingNext(page).click();
    await page.getByLabel("Rent amount").fill("28000");
    await expect(page.getByRole("complementary")).toContainText("Savings and bills are ₹14,000 more than your pay.");
  });

  test("skipping onboarding still lands on a working dashboard", async ({ page }) => {
    await signUpFreshUser(page);
    await skipOnboarding(page);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
