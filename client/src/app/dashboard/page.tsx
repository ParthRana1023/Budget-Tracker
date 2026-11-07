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
  const { data: settings } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // Fetch categories
  let { data: categories } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

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
      if (insertError) console.error("Could not insert starter categories:", insertError.message);
    }
    const { data: seeded } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name", { ascending: true });
    if (seeded) categories = seeded;
  }

  // Fetch transactions with category join
  const { data: transactions } = await supabase
    .from("transactions")
    .select("id, category_id, amount, type, date, note, external_id, category:categories(name, type)")
    .eq("user_id", user.id)
    .order("date", { ascending: false });

  // Fetch income sources
  const { data: incomeSources } = await supabase
    .from("income_sources")
    .select("*")
    .eq("user_id", user.id);

  // Fetch savings goals
  let { data: savingsGoals } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id);

  if (!savingsGoals || savingsGoals.length === 0) {
    const { data: starterGoal } = await supabase
      .from("savings_goals")
      .insert([
        { user_id: user.id, name: "Emergency Fund", target_amount: 10000000 }, // ₹1,00,000 starter goal
      ])
      .select();
    if (starterGoal) {
      savingsGoals = starterGoal;
    }
  }

  // Fetch goal contributions
  const { data: contributions } = await supabase
    .from("goal_contributions")
    .select("goal_id, amount, date")
    .eq("user_id", user.id);
  const { data: recurringItems } = await supabase.from("recurring_items").select("*").eq("user_id", user.id);

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
