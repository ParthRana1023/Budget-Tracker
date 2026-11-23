import { createClient } from "@/utils/supabase/server";
import { STARTER_CATEGORIES } from "@/lib/starterCategories.mjs";
import { errorFields, log } from "@/lib/log.mjs";
import { SETTINGS_SELECT } from "@/lib/settings.mjs";
import { redirect } from "next/navigation";
import DashboardClient, { type View } from "@/components/DashboardClient";

export type DashboardPageProps = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/**
 * Loads everything the Dashboard shows. /dashboard and the phone pages (/ledger, /more,
 * /bills, /budgets, /goals) all render it; `page` picks which one opens.
 */
export async function renderDashboard({ searchParams }: DashboardPageProps, page?: View) {
  const { view, add } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch user settings
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select(SETTINGS_SELECT)
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) throw new Error(`Could not load your settings: ${settingsError.message}`);

  // New accounts set up their salary, savings, bills and categories first.
  if (settings && !settings.onboarded_at) redirect("/onboarding");

  // Fetch categories
  let { data: categories, error: categoriesError } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id)
    .order("name", { ascending: true });
  if (categoriesError) throw new Error(`Could not load your categories: ${categoriesError.message}`);

  // A user with no categories at all gets the starter set. The database function
  // ensure_starter_categories() is preferred; if it is not installed yet (migration
  // not applied) or fails, insert the same list directly so the user is never left
  // with an empty dashboard. Limits start at 0 = "no limit set".
  if (!categories || categories.length === 0) {
    const { error: rpcError } = await supabase.rpc("ensure_starter_categories");
    if (rpcError) {
      log.warn("starter_categories_rpc_failed", {
        ...errorFields(rpcError),
        rpc: "ensure_starter_categories",
        userId: user.id,
      });
      const { error: insertError } = await supabase
        .from("categories")
        .insert(STARTER_CATEGORIES.map((c) => ({ user_id: user.id, name: c.name, type: c.type, monthly_limit: 0 })));
      if (insertError) throw new Error(`Could not create starter categories: ${insertError.message}`);
    }
    const { data: seeded, error: seededError } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name", { ascending: true });
    if (seededError) throw new Error(`Could not load starter categories: ${seededError.message}`);
    if (seeded) categories = seeded;
  }

  // Fetch transactions with category join
  const { data: transactions, error: transactionsError } = await supabase
    .from("transactions")
    .select("*, category:categories(name, type)")
    .eq("user_id", user.id)
    .order("date", { ascending: false });
  if (transactionsError) throw new Error(`Could not load your transactions: ${transactionsError.message}`);

  // Fetch income sources
  const { data: incomeSources, error: incomeError } = await supabase
    .from("income_sources")
    .select("*")
    .eq("user_id", user.id);
  if (incomeError) throw new Error(`Could not load your income sources: ${incomeError.message}`);

  // Fetch savings goals
  // No starter goal: the dashboard shows what the user set up (design handoff).
  const { data: savingsGoals, error: goalsError } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id);
  if (goalsError) throw new Error(`Could not load your savings goals: ${goalsError.message}`);

  // Fetch goal contributions
  const { data: contributions, error: contributionsError } = await supabase
    .from("goal_contributions")
    .select("goal_id, amount, date")
    .eq("user_id", user.id);
  if (contributionsError) throw new Error(`Could not load your savings contributions: ${contributionsError.message}`);
  const { data: recurringItems, error: recurringError } = await supabase
    .from("recurring_items")
    .select("*")
    .eq("user_id", user.id);
  if (recurringError) throw new Error(`Could not load your recurring items: ${recurringError.message}`);

  return (
    <DashboardClient
      initialUser={{ id: user.id, email: user.email, verified: !!user.email_confirmed_at }}
      initialSettings={settings}
      initialCategories={(categories || []) as any}
      initialTransactions={(transactions || []) as any}
      initialIncomeSources={incomeSources || []}
      initialSavingsGoals={savingsGoals || []}
      initialContributions={contributions || []}
      initialRecurringItems={recurringItems || []}
      initialView={page ?? (view === "reports" ? "reports" : "dashboard")}
      initialAdd={add === "expense"}
    />
  );
}
