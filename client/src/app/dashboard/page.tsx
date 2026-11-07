import { createClient } from "@/utils/supabase/server";
import { STARTER_CATEGORIES } from "@/lib/starterCategories.mjs";
import { redirect } from "next/navigation";
import DashboardClient from "@/components/DashboardClient";

export default async function DashboardPage() {
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
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) throw new Error(`Could not load your settings: ${settingsError.message}`);

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
      console.error("ensure_starter_categories failed, inserting starters directly:", rpcError.message);
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
    .select("id, category_id, amount, type, date, note, external_id, category:categories(name, type)")
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
  let { data: savingsGoals, error: goalsError } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id);
  if (goalsError) throw new Error(`Could not load your savings goals: ${goalsError.message}`);

  if (!savingsGoals || savingsGoals.length === 0) {
    const { data: starterGoal, error: starterGoalError } = await supabase
      .from("savings_goals")
      .insert([
        { user_id: user.id, name: "Emergency Fund", target_amount: 10000000 }, // ₹1,00,000 starter goal
      ])
      .select();
    if (starterGoalError) throw new Error(`Could not create your starter savings goal: ${starterGoalError.message}`);
    if (starterGoal) {
      savingsGoals = starterGoal;
    }
  }

  // Fetch goal contributions
  const { data: contributions, error: contributionsError } = await supabase
    .from("goal_contributions")
    .select("goal_id, amount, date")
    .eq("user_id", user.id);
  if (contributionsError) throw new Error(`Could not load your savings contributions: ${contributionsError.message}`);
  const { data: recurringItems, error: recurringError } = await supabase.from("recurring_items").select("*").eq("user_id", user.id);
  if (recurringError) throw new Error(`Could not load your recurring items: ${recurringError.message}`);

  return (
    <DashboardClient
      initialUser={{ id: user.id, email: user.email }}
      initialSettings={settings}
      initialCategories={(categories || []) as any}
      initialTransactions={(transactions || []) as any}
      initialIncomeSources={incomeSources || []}
      initialSavingsGoals={savingsGoals || []}
      initialContributions={contributions || []}
      initialRecurringItems={recurringItems || []}
    />
  );
}
