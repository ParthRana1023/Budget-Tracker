import { test, expect, type Page } from "@playwright/test";
import { openLogExpense, setUpAccount, show } from "./helpers";

// Handoff v4 §1: credit card tracker. Card spend already counts in safe to spend; marking a bill
// paid is a transfer that only lowers what's owed (lib/cards.mjs has the maths and its tests).

async function addCard(page: Page, name: string, opening = "") {
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByLabel("Card name").fill(name);
  if (opening) await page.getByLabel(/^Opening balance/).fill(opening);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("credit cards: set up, log card spend, mark the bill paid, a second card, Reports", async ({ page }) => {
  test.setTimeout(120_000); // one journey: sign-up, settings, two entries, a payment, Reports
  await setUpAccount(page);
  await expect(page.getByText("Track your card bill")).toBeVisible();
  const safe = await page.getByTestId("safe-to-spend").textContent();

  // Settings › Credit cards: add one, and a duplicate name is refused.
  await page.goto("/settings?s=card");
  await expect(page.getByText("No cards yet")).toBeVisible();
  await addCard(page, "HDFC Regalia", "1000");
  await expect(
    page.getByRole("button", { name: /HDFC Regalia.*Statement on the 1st · due on the 18th · reminders on/ }),
  ).toBeVisible();
  await addCard(page, "hdfc regalia");
  await expect(page.getByRole("alert")).toHaveText("You already have a card with this name.");

  // One card: Log expense has no "Which card"; the spend lands on the card.
  await page.goto("/dashboard");
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("500");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByLabel("Note").fill("DMart");
  await dialog.getByRole("radio", { name: "Credit card" }).click();
  await expect(dialog.getByText("Which card")).toHaveCount(0);
  await dialog.getByRole("button", { name: /^Log ₹/ }).click();
  await expect(dialog).toHaveCount(0);

  const tile = page.locator("section", { has: page.locator("#card-h") });
  await expect(tile.locator("#card-h")).toHaveText("Card bill · HDFC Regalia");
  await expect(tile).toContainText("₹1,500");
  await expect(tile).toContainText("Card spend (1 entry)");

  // Mark part of it paid: safe to spend stays as it was; the tile drops by the payment.
  await tile.getByRole("button", { name: "Mark bill paid" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Card bill paid" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Full balance/ })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByLabel("Amount").fill("600");
  await expect(sheet.getByRole("status").filter({ hasText: "still owed on HDFC Regalia" })).toBeVisible();
  await sheet.getByLabel(/^Note/).fill("Paid from savings account");
  await sheet.getByRole("button", { name: /^Mark ₹600/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText(/HDFC Regalia bill paid · ₹600/)).toBeVisible();
  await expect(tile).toContainText("₹900");
  await expect(page.getByTestId("safe-to-spend")).toHaveText(safe ?? "");

  // Ledger: a transfer row and its own filter chip.
  await show(page, "Ledger");
  const row = page.getByRole("button", { name: /^Edit Card bill paid/ });
  await expect(row).toContainText("HDFC Regalia · Transfer · Paid from savings account");
  await expect(row).toContainText("⇄");
  const chips = page.getByRole("group", { name: "Filter by payment method" });
  await chips.getByRole("button", { name: /^Card payments/ }).click();
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit DMart/ })).toHaveCount(0);

  // A second card: Log expense asks which card.
  await page.goto("/settings?s=card");
  await addCard(page, "Axis Ace");
  await expect(page.getByRole("button", { name: /^Axis Ace/ })).toBeVisible();
  await page.goto("/dashboard");
  await openLogExpense(page);
  await page.getByRole("dialog").getByRole("radio", { name: "Credit card" }).click();
  await expect(page.getByRole("radiogroup", { name: "Which card" }).getByRole("radio")).toHaveCount(2);
  await page.goto("/dashboard?view=reports");

  // Reports › Spending habits: the Credit cards panel.
  await page.getByRole("tab", { name: /Spending habits/ }).click();
  const panel = page.locator("section[aria-labelledby='cc-h']");
  await expect(panel.getByRole("heading", { name: "Credit cards" })).toBeVisible();
  await expect(panel).toContainText("2 cards");
  await expect(panel).toContainText("Card payments aren’t counted as spending.");
});
