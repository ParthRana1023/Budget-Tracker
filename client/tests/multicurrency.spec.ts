import { test, expect, Page, type Locator } from "@playwright/test";
import { asAdmin, openLogExpense, setUpAccount, show } from "./helpers";

// Design handoff v3, Currency: the currency chip and list, the rate line and its states.
// /api/rates is mocked: the specs never reach the real rates service.

const prefs = async (page: Page) => {
  await page.goto("/settings");
  await page
    .getByRole("navigation", { name: /sections/ })
    .getByRole("button", { name: "Preferences" })
    .click();
};
// The test account is paid on the 1st, so cycles are calendar months.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const today = () => ymd(now);
const thisStart = () => ymd(new Date(now.getFullYear(), now.getMonth(), 1));
const lastCycleDay = () => ymd(new Date(now.getFullYear(), now.getMonth() - 1, 15));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortLabel = (s: string) => `${Number(s.slice(8))} ${MON[Number(s.slice(5, 7)) - 1]}`;
const nextStartLabel = () => shortLabel(ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)));

const rate = (page: Page, value: number) =>
  page.route("**/api/rates?**", (route) => route.fulfill({ json: { rate: value, date: "2026-11-01", stale: false } }));

/** Opens a chip's list, searches and picks the first match with Enter. */
async function pickCurrency(scope: Locator, chipName: RegExp, query: string) {
  await scope.getByRole("button", { name: chipName }).click();
  await scope.getByLabel("Search currencies").fill(query);
  await scope.getByLabel("Search currencies").press("Enter");
}

test("a USD expense: chip, list, rate line, ledger and Edit entry with bank fees", async ({ page }) => {
  await rate(page, 92.68);
  await setUpAccount(page);

  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "+100" })).toBeVisible();
  await pickCurrency(dialog, /^Currency: INR/, "USD");
  await expect(dialog.getByRole("button", { name: /^Currency: USD/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "+100" })).toBeHidden(); // quick amounts are in ₹
  await dialog.getByLabel("Amount").fill("19.99");
  await expect(dialog).toContainText("$19.99 = ₹1,852.67 at ₹92.68");
  await expect(dialog).toContainText("Rate locked for this cycle, from 1 Nov");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByLabel("Note").fill("App subscription");
  await dialog.getByRole("button", { name: "Log ₹1,852.67" }).click();
  await expect(dialog).toHaveCount(0);

  const row = () => page.locator("#ledger-body").getByRole("button", { name: /^Edit App subscription/ });
  await expect(row()).toContainText("₹1,852.67");
  await expect(row()).toContainText("$19.99");

  // Editing keeps the saved rate: $10 at 92.68 = ₹926.80.
  await row().click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel("Amount")).toHaveValue("19.99");
  await expect(edit).toContainText("Paid $19.99 at ₹92.68");
  await edit.getByLabel("Amount").fill("10");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(row()).toContainText("₹926.80");

  // The bank charged a little more: the base amount can be typed over.
  await row().click();
  await edit.getByLabel("Charged in INR").fill("930");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toHaveCount(0);
  await expect(row()).toContainText("₹930.00");
  await expect(row()).toContainText("$10.00");
});

test("rate line: an error offers Try again or your own rate; your own rate is for this entry", async ({ page }) => {
  let down = true;
  await page.route("**/api/rates?**", (route) =>
    down
      ? route.fulfill({ status: 503, json: { error: "Rates are unavailable." } })
      : route.fulfill({ json: { rate: 92.68, date: "2026-11-01", stale: false } }),
  );
  await setUpAccount(page);
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await pickCurrency(dialog, /^Currency: INR/, "USD");
  await expect(dialog).toContainText("Couldn’t get this cycle’s rate.");

  down = false;
  await dialog.getByRole("button", { name: "Try again" }).click();
  await expect(dialog).toContainText("$1.00 = ₹92.68 at ₹92.68");

  await dialog.getByRole("button", { name: "Use my own rate" }).click();
  await expect(dialog.getByLabel("₹ for 1 USD")).toHaveValue("92.68");
  await dialog.getByLabel("₹ for 1 USD").fill("95");
  await dialog.getByLabel("Amount").fill("10");
  await expect(dialog).toContainText("$10.00 = ₹950.00 at ₹95.00");
  await dialog.getByRole("button", { name: "Use this cycle’s rate" }).click();
  await expect(dialog).toContainText("$10.00 = ₹926.80 at ₹92.68");
});

test("rates under ₹1 read per 100 units; yen have no decimals", async ({ page }) => {
  await rate(page, 0.5571);
  await setUpAccount(page);
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await pickCurrency(dialog, /^Currency: INR/, "yen");
  await dialog.getByLabel("Amount").fill("3200");
  await expect(dialog).toContainText("¥3,200 = ₹1,782.72 at ₹55.71 per ¥100");
});

test("a category limit set in USD is budgeted at this cycle's rate", async ({ page }) => {
  await rate(page, 92.68);
  await setUpAccount(page);

  await page.getByRole("button", { name: "Manage" }).click();
  const dialog = page.getByRole("dialog");
  await pickCurrency(dialog, /^Groceries currency: INR/, "USD");
  await expect(dialog.getByLabel("₹ for 1 USD")).toHaveValue("92.68");
  await dialog.getByLabel("Groceries monthly limit").fill("100");
  await expect(dialog).toContainText("≈ ₹9,268.00 this cycle");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toHaveCount(0);
  const groceries = page.locator('[data-testid="budget-row"][data-name="Groceries"]');
  await expect(groceries).toContainText("₹9,268.00");
  await expect(groceries).toContainText("$100.00 a month · ₹9,268.00 this cycle");

  // Reopened, it still shows what was typed, in USD.
  await page.getByRole("button", { name: "Manage" }).click();
  await expect(dialog.getByRole("button", { name: /^Groceries currency: USD/ })).toBeVisible();
  await expect(dialog.getByLabel("Groceries monthly limit")).toHaveValue("100");
});

/** Picks a base currency in Settings › Preferences through its searchable list. */
async function pickBase(page: Page, from: string, query: string) {
  await page.getByRole("button", { name: `Base currency: ${from}` }).click();
  await page.getByLabel("Search currencies").fill(query);
  await page.getByLabel("Search currencies").press("Enter");
}

test("base currency: before the first entry it changes straight away", async ({ page }) => {
  await setUpAccount(page);
  await prefs(page);
  await expect(page.getByText("No entries yet, so a change applies straight away.")).toBeVisible();
  await pickBase(page, "INR", "USD");
  await expect(page.getByRole("button", { name: "Base currency: USD" })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByTestId("safe-to-spend")).toContainText("$");
  await openLogExpense(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("12.5");
  await dialog.getByRole("button", { name: /^Groceries/ }).click();
  await dialog.getByRole("button", { name: "Log $12.50" }).click();
  await expect(dialog).toHaveCount(0);
});

test("base currency: with entries a new base waits for the next cycle; Keep INR cancels it", async ({ page }) => {
  const email = await setUpAccount(page);
  const { admin, userId } = await asAdmin(email);
  await admin
    .from("transactions")
    .insert({ user_id: userId, type: "expense", amount: 10000, date: today(), note: "Tea" });

  await prefs(page);
  await expect(page.getByText("A change starts with your next cycle.")).toBeVisible();
  await pickBase(page, "INR", "USD");
  const card = page.getByRole("status").filter({ hasText: "Switches to USD on" });
  await expect(card).toContainText(`Switches to USD on ${nextStartLabel()}`);
  await expect(card).toContainText("This cycle stays in INR");
  await expect(page.getByRole("button", { name: "Base currency: INR" })).toBeVisible(); // still INR now

  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Notices" })).toContainText(
    `Your base currency switches to USD ($) on ${nextStartLabel()}. This cycle stays in INR`,
  );
  await expect(page.getByText(`in USD from ${nextStartLabel()}`)).toBeVisible();
  await expect(page.getByTestId("safe-to-spend")).toContainText("₹");

  await prefs(page);
  await page.getByRole("button", { name: "Keep INR" }).click();
  await expect(card).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page.getByText(`in USD from ${nextStartLabel()}`)).toHaveCount(0);
});

test("after a base switch: everything in USD, INR bills underneath, older cycles at today's rate", async ({ page }) => {
  await rate(page, 0.012); // ₹1 = $0.012: the switch and every rate after it
  const email = await setUpAccount(page);
  const { admin, userId } = await asAdmin(email);
  const { data: groceries } = await admin
    .from("categories")
    .select("id")
    .eq("user_id", userId)
    .eq("name", "Groceries")
    .single();
  // Last cycle, in INR: ₹2,000 of groceries. USD was chosen then, starting with this cycle.
  await admin.from("transactions").insert({
    user_id: userId,
    type: "expense",
    amount: 200000,
    date: lastCycleDay(),
    note: "Old groceries",
    category_id: groceries!.id,
  });
  await admin.from("user_settings").update({ currency_next: "USD", currency_from: thisStart() }).eq("user_id", userId);
  await admin.from("plan_changes").insert({
    user_id: userId,
    field: "currency",
    from_text: "INR",
    to_text: "USD",
    applies: "next",
    effective_from: thisStart(),
  });

  // Opening the Dashboard runs the switch at this cycle's rate, then loads everything again.
  await page.goto("/dashboard");
  const notices = page.getByRole("region", { name: "Notices" });
  await expect(notices).toContainText("Everything now shows in USD.", { timeout: 20_000 });
  await expect(notices).toContainText("(₹100.00 = $1.20 this cycle)");
  await expect(page.getByTestId("safe-to-spend")).toContainText("$");

  await show(page, "Bills");
  const rent = page.locator('[data-testid="bill-row"][data-name="Rent"]');
  await expect(rent).toContainText("$336.00");
  await expect(rent).toContainText("₹28,000.00");
  await expect(rent).toContainText("rate changes each cycle");

  // Reports: last cycle's ₹2,000 reads $24.00 (today's rate), with a footnote saying so.
  await show(page, "Reports");
  await expect(page.getByText(`Before ${shortLabel(thisStart())}, amounts are converted from INR`)).toBeVisible();
  await expect(page.getByText("$24.00").first()).toBeVisible();
});
