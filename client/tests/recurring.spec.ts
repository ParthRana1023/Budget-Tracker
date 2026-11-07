import { test, expect, Page } from "@playwright/test";
import { signUpFreshUser } from "./helpers";

// Day 1 is always "due" (today's date is >= 1), so a freshly created schedule can be posted immediately.
const row = (page: Page, name: string) => page.locator(`[data-testid="recurring-row"][data-name="${name}"]`);
const postButton = (page: Page, name: string) => page.locator(`[data-testid="recurring-post-btn"][data-name="${name}"]`);

async function createSchedule(page: Page, opts: { type: "expense" | "income"; name: string; amount: string; day?: string; category?: string }) {
  await page.getByTestId(`recurring-new-type-${opts.type}`).click();
  await page.getByTestId("recurring-new-name").fill(opts.name);
  await page.getByTestId("recurring-new-amount").fill(opts.amount);
  await page.getByTestId("recurring-new-day").fill(opts.day ?? "1");
  if (opts.type === "expense") await page.getByTestId("recurring-new-category").selectOption({ label: opts.category ?? "Rent / Housing" });
  await page.getByTestId("recurring-new-submit").click();
  await expect(row(page, opts.name)).toBeVisible();
}

test.describe("Recurring schedules", () => {
  test("create an expense schedule, post it once, and it stays posted after reload", async ({ page }) => {
    await signUpFreshUser(page);
    await createSchedule(page, { type: "expense", name: "Rent", amount: "25000", category: "Rent / Housing" });

    await expect(row(page, "Rent")).toContainText("₹25,000");
    await expect(row(page, "Rent")).toContainText("Rent / Housing");
    await expect(postButton(page, "Rent")).toContainText("Review & post expense");

    await postButton(page, "Rent").click();
    await expect(postButton(page, "Rent")).toHaveCount(0);

    await page.reload();
    await expect(row(page, "Rent")).toBeVisible();
    await expect(postButton(page, "Rent")).toHaveCount(0); // already posted this month: not offered again
  });

  test("create a recurring INCOME schedule (no category) and post it", async ({ page }) => {
    await signUpFreshUser(page);

    await page.getByTestId("recurring-new-type-income").click();
    await expect(page.getByTestId("recurring-new-category")).toHaveCount(0); // income needs no category

    await createSchedule(page, { type: "income", name: "Salary", amount: "80000" });
    await expect(row(page, "Salary")).toContainText("Income");
    await expect(row(page, "Salary")).toContainText("₹80,000");
    await expect(postButton(page, "Salary")).toContainText("Review & post income");

    await postButton(page, "Salary").click();
    await expect(postButton(page, "Salary")).toHaveCount(0);
    await expect(page.getByTestId("recurring-error")).toHaveCount(0);
  });

  test("edit a schedule's name, amount and day", async ({ page }) => {
    await signUpFreshUser(page);
    await createSchedule(page, { type: "expense", name: "Gym", amount: "1000", category: "Health" });

    await row(page, "Gym").getByTestId("recurring-edit-btn").click();
    await page.getByTestId("recurring-edit-name").fill("Gym membership");
    await page.getByTestId("recurring-edit-amount").fill("1500");
    await page.getByTestId("recurring-edit-day").fill("5");
    await page.getByTestId("recurring-edit-submit").click();

    await expect(row(page, "Gym")).toHaveCount(0);
    await expect(row(page, "Gym membership")).toContainText("₹1,500");
    await expect(row(page, "Gym membership")).toContainText("day 5");

    await page.reload();
    await expect(row(page, "Gym membership")).toContainText("₹1,500"); // persisted
  });

  test("edit can switch an expense schedule to income", async ({ page }) => {
    await signUpFreshUser(page);
    await createSchedule(page, { type: "expense", name: "Side gig", amount: "3000", category: "Miscellaneous" });

    await row(page, "Side gig").getByTestId("recurring-edit-btn").click();
    await page.getByTestId("recurring-edit-type-income").click();
    await page.getByTestId("recurring-edit-submit").click();

    await expect(row(page, "Side gig")).toContainText("Income");
    await expect(row(page, "Side gig")).not.toContainText("Miscellaneous");
  });

  test("cancelling an edit changes nothing", async ({ page }) => {
    await signUpFreshUser(page);
    await createSchedule(page, { type: "expense", name: "Netflix", amount: "649", category: "Subscriptions" });

    await row(page, "Netflix").getByTestId("recurring-edit-btn").click();
    await page.getByTestId("recurring-edit-name").fill("Something else");
    await page.getByTestId("recurring-edit-cancel").click();

    await expect(row(page, "Netflix")).toBeVisible();
    await expect(row(page, "Something else")).toHaveCount(0);
  });

  test("pause stops it being due, resume brings it back; neither deletes it", async ({ page }) => {
    await signUpFreshUser(page);
    await createSchedule(page, { type: "expense", name: "Broadband", amount: "999", category: "Utilities & Bills" });
    await expect(postButton(page, "Broadband")).toBeVisible();

    await row(page, "Broadband").getByTestId("recurring-toggle-btn").click();
    await expect(row(page, "Broadband").getByTestId("recurring-status")).toHaveText("Paused");
    await expect(postButton(page, "Broadband")).toHaveCount(0);

    await page.reload();
    await expect(row(page, "Broadband")).toBeVisible(); // still exists after reload

    await row(page, "Broadband").getByTestId("recurring-toggle-btn").click();
    await expect(row(page, "Broadband").getByTestId("recurring-status")).toHaveText("Active");
    await expect(postButton(page, "Broadband")).toBeVisible();
  });

  test("delete really deletes: it asks first, can be cancelled, and is gone after reload", async ({ page }) => {
    await signUpFreshUser(page);
    await createSchedule(page, { type: "expense", name: "Old plan", amount: "499", category: "Subscriptions" });

    await row(page, "Old plan").getByTestId("recurring-delete-btn").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByTestId("recurring-delete-cancel").click();
    await expect(row(page, "Old plan")).toBeVisible(); // "Keep" leaves it alone

    await row(page, "Old plan").getByTestId("recurring-delete-btn").click();
    await page.getByTestId("recurring-delete-confirm").click();
    await expect(row(page, "Old plan")).toHaveCount(0);

    await page.reload();
    await expect(row(page, "Old plan")).toHaveCount(0); // not merely paused
  });

  test("the form rejects bad input with a clear message", async ({ page }) => {
    await signUpFreshUser(page);

    await page.getByTestId("recurring-new-submit").click();
    await expect(page.getByTestId("recurring-error")).toContainText("Enter a name");

    await page.getByTestId("recurring-new-name").fill("Rent");
    await page.getByTestId("recurring-new-amount").fill("0");
    await page.getByTestId("recurring-new-submit").click();
    await expect(page.getByTestId("recurring-error")).toContainText("valid amount");

    await page.getByTestId("recurring-new-amount").fill("1000");
    await page.getByTestId("recurring-new-day").fill("29");
    await page.getByTestId("recurring-new-submit").click();
    await expect(page.getByTestId("recurring-error")).toContainText("between 1 and 28");

    await page.getByTestId("recurring-new-day").fill("1");
    await page.getByTestId("recurring-new-submit").click();
    await expect(page.getByTestId("recurring-error")).toContainText("category");

    await expect(page.getByTestId("recurring-row")).toHaveCount(0); // nothing was saved
  });
});
