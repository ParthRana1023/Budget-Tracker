import { createClient } from "@/utils/supabase/server";
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

  // If no categories exist yet for this user, insert starter categories dynamically
  if (!categories || categories.length === 0) {
    const defaultCategories = [
      { user_id: user.id, name: "Rent / Housing", type: "fixed", monthly_limit: 2500000 },
      { user_id: user.id, name: "Utilities & Bills", type: "fixed", monthly_limit: 500000 },
      { user_id: user.id, name: "EMI & Loans", type: "fixed", monthly_limit: 1500000 },
      { user_id: user.id, name: "Insurance", type: "fixed", monthly_limit: 300000 },
      { user_id: user.id, name: "Subscriptions", type: "fixed", monthly_limit: 150000 },
      { user_id: user.id, name: "Groceries", type: "flexible", monthly_limit: 1200000 },
      { user_id: user.id, name: "Food & Dining Out", type: "flexible", monthly_limit: 800000 },
      { user_id: user.id, name: "Transport & Fuel", type: "flexible", monthly_limit: 500000 },
      { user_id: user.id, name: "Shopping", type: "flexible", monthly_limit: 600000 },
      { user_id: user.id, name: "Entertainment", type: "flexible", monthly_limit: 400000 },
      { user_id: user.id, name: "Health", type: "flexible", monthly_limit: 300000 },
      { user_id: user.id, name: "Travel", type: "flexible", monthly_limit: 500000 },
      { user_id: user.id, name: "Miscellaneous", type: "flexible", monthly_limit: 200000 },
    ];

    const { data: inserted } = await supabase
      .from("categories")
      .insert(defaultCategories)
      .select();

    if (inserted) {
      categories = inserted;
    }
  }

  // Fetch transactions with category join
  const { data: transactions } = await supabase
    .from("transactions")
    .select("id, category_id, amount, type, date, note, category:categories(name, type)")
    .eq("user_id", user.id)
    .order("date", { ascending: false });

  // Fetch income sources
  const { data: incomeSources } = await supabase
    .from("income_sources")
    .select("*")
    .eq("user_id", user.id);

  // Fetch savings goals
  const { data: savingsGoals } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id);

  return (
    <DashboardClient
      initialUser={{ id: user.id, email: user.email }}
      initialSettings={settings}
      initialCategories={(categories || []) as any}
      initialTransactions={(transactions || []) as any}
      initialIncomeSources={incomeSources || []}
      initialSavingsGoals={savingsGoals || []}
    />
  );
}
