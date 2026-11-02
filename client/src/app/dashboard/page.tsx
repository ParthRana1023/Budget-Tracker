import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { 
  PiggyBank, 
  TrendingUp, 
  Calendar, 
  AlertCircle, 
  LogOut, 
  CheckCircle2, 
  PlusCircle, 
  Layers,
  ArrowUpRight,
  ShieldAlert
} from "lucide-react";
import Link from "next/link";

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
  const { data: categories } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

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

  // Compute live numbers (in paise)
  const confirmedIncome = (incomeSources || [])
    .filter((i) => i.status === "received")
    .reduce((sum, i) => sum + Number(i.amount), 0);

  const unreceivedVariable = (incomeSources || [])
    .filter((i) => i.type === "variable" && i.status === "expected")
    .reduce((sum, i) => sum + Number(i.amount), 0);

  const fixedCategories = (categories || []).filter((c) => c.type === "fixed");
  const flexibleCategories = (categories || []).filter((c) => c.type === "flexible");

  const budgetedFixedBills = fixedCategories.reduce((sum, c) => sum + Number(c.monthly_limit), 0);
  const paidFixedBills = 0; // Phase 1 default
  const remainingFixedBills = Math.max(0, budgetedFixedBills - paidFixedBills);
  const flexibleSpent = 0; // Phase 1 default
  const targetSavings = (savingsGoals || []).reduce((sum, g) => sum + (Number(g.target_amount) > 0 ? 1000000 : 0), 0); // 10k default per goal or 0

  // Safe-to-Spend = Confirmed Income − Target Savings − Remaining Unpaid Fixed Bills − Flexible Spent
  const safeToSpend = confirmedIncome - targetSavings - remainingFixedBills - flexibleSpent;
  const daysInPeriod = 30;
  const dailyAllowance = safeToSpend > 0 ? Math.floor(safeToSpend / daysInPeriod) : 0;

  const formatINR = (paise: number) => {
    const rupees = (paise / 100).toLocaleString("en-IN", {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
    return `₹${rupees}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-500/20">
            <PiggyBank className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm tracking-tight block">Budget Tracker</span>
            <span className="text-[10px] text-slate-500 hidden sm:block">Savings-First Engine</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-600 hidden md:inline truncate max-w-xs font-medium">
            {user.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </form>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 space-y-6">
        {/* Month Anchor banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-white rounded-xl border border-slate-200 text-xs text-slate-600 shadow-xs">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <span>
              Active Budget Cycle: Starting on the <strong>{settings?.month_start_day || 1}st</strong> of each month
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-medium text-[11px]">
            <CheckCircle2 className="w-3 h-3" />
            Database Synced
          </span>
        </div>

        {/* Hero Safe-to-Spend Card */}
        <div className="bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 text-white rounded-3xl p-6 sm:p-8 shadow-xl shadow-emerald-900/10 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-emerald-200 text-xs font-semibold uppercase tracking-wider">
                Safe To Spend Remaining
              </span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-600/40 text-emerald-100 text-xs backdrop-blur-md border border-emerald-400/20">
                Phase 1 Active
              </span>
            </div>

            <div className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
              {formatINR(safeToSpend)}
            </div>

            <p className="text-emerald-100/90 text-sm max-w-lg mb-6">
              Daily allowance: <strong className="text-white font-semibold">{formatINR(dailyAllowance)} / day</strong> for the next {daysInPeriod} days.
            </p>

            {/* Breakdown Formula Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-emerald-600/40 text-xs">
              <div>
                <span className="text-emerald-300 block text-[11px]">Confirmed Income</span>
                <span className="font-bold text-white text-sm">{formatINR(confirmedIncome)}</span>
              </div>
              <div>
                <span className="text-emerald-300 block text-[11px]">Savings Target</span>
                <span className="font-bold text-white text-sm">− {formatINR(targetSavings)}</span>
              </div>
              <div>
                <span className="text-emerald-300 block text-[11px]">Unpaid Fixed Bills</span>
                <span className="font-bold text-white text-sm">− {formatINR(remainingFixedBills)}</span>
              </div>
              <div>
                <span className="text-emerald-300 block text-[11px]">Flexible Spent</span>
                <span className="font-bold text-white text-sm">− {formatINR(flexibleSpent)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Variable Pay Card (Isolated) */}
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex items-start gap-3.5">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-slate-900 text-sm">Variable Pay Holding Bucket</h4>
              <span className="font-bold text-amber-900 text-sm">{formatINR(unreceivedVariable)}</span>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Variable and year-end bonuses are tracked as expected and <strong>excluded</strong> from your monthly safe-to-spend figure until deposited into your bank account.
            </p>
          </div>
        </div>

        {/* Starter Categories Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Fixed Categories */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-sm">Fixed Categories & Obligations</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">{fixedCategories.length} Categories</span>
            </div>

            <div className="space-y-2.5">
              {fixedCategories.length > 0 ? (
                fixedCategories.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                  >
                    <span className="font-medium text-slate-700">{c.name}</span>
                    <span className="font-semibold text-slate-900">{formatINR(c.monthly_limit)}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 py-4 text-center">
                  Starter categories will auto-populate on initial setup.
                </div>
              )}
            </div>
          </div>

          {/* Flexible Categories */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Flexible Spending Categories</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium">{flexibleCategories.length} Categories</span>
            </div>

            <div className="space-y-2.5">
              {flexibleCategories.length > 0 ? (
                flexibleCategories.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs"
                  >
                    <span className="font-medium text-slate-700">{c.name}</span>
                    <span className="font-semibold text-slate-900">{formatINR(c.monthly_limit)}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 py-4 text-center">
                  Starter categories will auto-populate on initial setup.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Savings Goals */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <PiggyBank className="w-4 h-4 text-purple-600" />
              <h3 className="font-bold text-slate-900 text-sm">Savings Goals (Priority Bucket)</h3>
            </div>
            <span className="text-xs text-slate-500 font-medium">Pay Yourself First</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(savingsGoals || []).length > 0 ? (
              savingsGoals?.map((g) => (
                <div
                  key={g.id}
                  className="p-3 rounded-xl border border-purple-100 bg-purple-50/40 text-xs flex items-center justify-between"
                >
                  <div>
                    <span className="font-bold text-slate-800 block">{g.name}</span>
                    <span className="text-[11px] text-slate-500">Target: {formatINR(g.target_amount)}</span>
                  </div>
                  <span className="text-[11px] font-semibold text-purple-700 bg-purple-100/70 px-2 py-0.5 rounded-md">
                    Priority
                  </span>
                </div>
              ))
            ) : (
              <div className="p-3 rounded-xl border border-dashed border-slate-200 text-xs text-slate-400 col-span-2 text-center">
                Emergency Fund & savings goals ready to configure.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

