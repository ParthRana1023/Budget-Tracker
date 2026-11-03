"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { 
  PiggyBank, 
  TrendingUp, 
  Calendar, 
  AlertCircle, 
  Plus, 
  Layers, 
  ArrowDownLeft, 
  Settings2, 
  Sparkles,
  Wallet,
  CheckCircle2,
  LogOut,
  Clock,
  ShieldAlert,
  Bell,
  PartyPopper
} from "lucide-react";
import FastExpenseModal, { Category } from "./FastExpenseModal";
import IncomeModal from "./IncomeModal";
import CategoryManagementModal from "./CategoryManagementModal";
import TransactionList from "./TransactionList";
import EditTransactionModal, { TransactionItem } from "./EditTransactionModal";
import CategoryProgress from "./CategoryProgress";
import BurnRateCard from "./BurnRateCard";
import AlertBanner from "./AlertBanner";
import SavingsGoalsSection, { SavingsGoal } from "./SavingsGoalsSection";
import WindfallAllocationModal from "./WindfallAllocationModal";
import { 
  getPeriodRange, 
  computeCategoryBudgets, 
  computeBurnRate, 
  formatINR 
} from "@/lib/budgetUtils";
import { getCategoryLimitAlerts, getSavingsTargetAlert, BudgetAlert } from "@/lib/alertUtils";

interface DashboardClientProps {
  initialUser: { id: string; email?: string };
  initialSettings: { currency: string; month_start_day: number } | null;
  initialCategories: Category[];
  initialTransactions: TransactionItem[];
  initialIncomeSources: any[];
  initialSavingsGoals: any[];
  initialContributions: Array<{ goal_id: string; amount: number; date?: string }>;
}

export default function DashboardClient({
  initialUser,
  initialSettings,
  initialCategories,
  initialTransactions,
  initialIncomeSources,
  initialSavingsGoals,
  initialContributions,
}: DashboardClientProps) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [transactions, setTransactions] = useState<TransactionItem[]>(initialTransactions);
  const [incomeSources, setIncomeSources] = useState<any[]>(initialIncomeSources);
  const [savingsGoals, setSavingsGoals] = useState<any[]>(initialSavingsGoals);
  const [contributions, setContributions] = useState<any[]>(initialContributions);
  const [settings] = useState(initialSettings);

  // Modals state
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<TransactionItem | null>(null);
  const [windfallToAllocate, setWindfallToAllocate] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Current period computation based on month_start_day
  const period = useMemo(() => {
    return getPeriodRange(new Date(), settings?.month_start_day || 1);
  }, [settings?.month_start_day]);

  // Filter transactions within active billing cycle
  const currentPeriodTransactions = useMemo(() => {
    const startStr = period.startDate.toISOString().split("T")[0];
    const endStr = period.endDate.toISOString().split("T")[0];
    return transactions.filter((t) => t.date >= startStr && t.date <= endStr);
  }, [transactions, period]);

  // Function to refresh state from Supabase
  const refreshData = async () => {
    const supabase = createClient();

    const [catRes, txRes, incRes, goalRes, contribRes] = await Promise.all([
      supabase.from("categories").select("*").eq("user_id", initialUser.id).order("name"),
      supabase
        .from("transactions")
        .select("id, category_id, amount, type, date, note, category:categories(name, type)")
        .eq("user_id", initialUser.id)
        .order("date", { ascending: false }),
      supabase.from("income_sources").select("*").eq("user_id", initialUser.id),
      supabase.from("savings_goals").select("*").eq("user_id", initialUser.id),
      supabase.from("goal_contributions").select("goal_id, amount, date").eq("user_id", initialUser.id),
    ]);

    if (catRes.data) setCategories(catRes.data as any);
    if (txRes.data) setTransactions(txRes.data as any);
    if (incRes.data) setIncomeSources(incRes.data);
    if (goalRes.data) setSavingsGoals(goalRes.data);
    if (contribRes.data) setContributions(contribRes.data);
  };

  // Safe to spend math
  const confirmedIncome = incomeSources
    .filter((i) => i.status === "received")
    .reduce((sum, i) => sum + Number(i.amount), 0);

  // Expected Variable Pay items
  const expectedVariableSources = incomeSources.filter(
    (i) => i.type === "variable" && i.status === "expected"
  );
  const unreceivedVariable = expectedVariableSources.reduce(
    (sum, i) => sum + Number(i.amount),
    0
  );

  const fixedCategories = categories.filter((c) => c.type === "fixed");
  const flexibleCategories = categories.filter((c) => c.type === "flexible");

  const budgetedFixedBills = fixedCategories.reduce((sum, c) => sum + Number(c.monthly_limit), 0);

  // Current cycle spent figures
  const paidFixedBills = currentPeriodTransactions
    .filter((t) => t.type === "expense" && t.category?.type === "fixed")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const remainingFixedBills = Math.max(0, budgetedFixedBills - paidFixedBills);

  const flexibleSpent = currentPeriodTransactions
    .filter((t) => t.type === "expense" && t.category?.type === "flexible")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  // Total savings contributions made in this active cycle
  const startStr = period.startDate.toISOString().split("T")[0];
  const endStr = period.endDate.toISOString().split("T")[0];
  const cycleSavingsContributions = contributions
    .filter((c) => {
      const d = c.date || "";
      return d >= startStr && d <= endStr;
    })
    .reduce((sum, c) => sum + Number(c.amount), 0);

  // Default baseline savings target if no contributions yet, or actual cycle contributions
  const targetSavings = Math.max(
    cycleSavingsContributions,
    savingsGoals.length > 0 ? 1000000 : 0
  );

  // Core formula: Safe to spend = Confirmed Income − Target Savings − Remaining Unpaid Fixed Bills − Flexible Spent
  const safeToSpend = confirmedIncome - targetSavings - remainingFixedBills - flexibleSpent;
  const dailyAllowance = safeToSpend > 0 ? Math.floor(safeToSpend / period.daysRemaining) : 0;

  // Compute per-category progress
  const categoryBudgets = useMemo(() => {
    return computeCategoryBudgets(categories, currentPeriodTransactions);
  }, [categories, currentPeriodTransactions]);

  // Compute flexible budget burn rate metrics
  const totalFlexibleBudget = flexibleCategories.reduce((sum, c) => sum + Number(c.monthly_limit), 0);
  const burnRate = useMemo(() => {
    return computeBurnRate(totalFlexibleBudget, flexibleSpent, period);
  }, [totalFlexibleBudget, flexibleSpent, period]);

  // Compute active alerts
  const activeAlerts = useMemo(() => {
    const categoryAlerts = getCategoryLimitAlerts(categories, currentPeriodTransactions);
    const savingsAlert = getSavingsTargetAlert({
      confirmedIncome,
      targetSavings,
      budgetedFixedBills,
      paidFixedBills,
      flexibleSpent,
      projectedFlexibleTotal: burnRate.projectedEndOfMonth,
    });

    const allAlerts: BudgetAlert[] = [];
    if (savingsAlert) allAlerts.push(savingsAlert);
    allAlerts.push(...categoryAlerts);
    return allAlerts;
  }, [categories, currentPeriodTransactions, confirmedIncome, targetSavings, budgetedFixedBills, paidFixedBills, flexibleSpent, burnRate.projectedEndOfMonth]);

  const handleAlertTriggered = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 6000);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-24 sm:pb-12">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3.5 sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-xs">
            <PiggyBank className="w-5 h-5" />
          </div>
          <div>
            <span className="font-bold text-slate-900 text-sm tracking-tight block">SaveFirst Tracker</span>
            <span className="text-[10px] text-slate-500 hidden sm:block">Savings-First Engine</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600 hidden md:inline truncate max-w-xs font-medium">
            {initialUser.email}
          </span>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 bg-slate-100 hover:bg-rose-50 rounded-lg transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </form>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 space-y-6">
        {/* Instant Toast Notification */}
        {toastMessage && (
          <div className="fixed top-16 right-4 sm:right-8 z-50 max-w-md p-4 rounded-2xl bg-slate-900 text-white text-xs shadow-2xl border border-slate-700 flex items-start gap-3 animate-in slide-in-from-top-4 duration-200">
            <Bell className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 animate-bounce" />
            <div className="flex-1">
              <span className="font-bold block text-slate-100 mb-0.5">Budget Warning Triggered</span>
              <p className="text-slate-300 leading-relaxed">{toastMessage}</p>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Cycle Banner & Action Row */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-xs">
            <Calendar className="w-4 h-4 text-emerald-600" />
            <span>
              Active Cycle: <strong>{period.periodLabel}</strong> ({period.daysRemaining} days left)
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              id="open-fast-expense-btn"
              onClick={() => setIsExpenseOpen(true)}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all transform hover:-translate-y-0.5"
            >
              <Plus className="w-4 h-4" />
              <span>3-Tap Expense</span>
            </button>
            <button
              id="open-income-btn"
              onClick={() => setIsIncomeOpen(true)}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm shadow-md shadow-blue-600/25 flex items-center justify-center gap-2 transition-all"
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>Record Income</span>
            </button>
            <button
              onClick={() => setIsCategoryOpen(true)}
              className="p-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors shadow-xs"
              title="Manage Categories"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active Alerts Banner */}
        {activeAlerts.length > 0 && (
          <AlertBanner alerts={activeAlerts} />
        )}

        {/* Hero Safe-To-Spend Card */}
        <div className="bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 text-white rounded-3xl p-6 sm:p-8 shadow-xl shadow-emerald-950/10 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-emerald-200 text-xs font-semibold uppercase tracking-wider">
                Safe To Spend Remaining
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-600/40 text-emerald-100 text-[11px] backdrop-blur-md border border-emerald-400/20">
                Savings Deducted First
              </span>
            </div>

            <div className="text-4xl sm:text-5xl font-black tracking-tight mb-2">
              {formatINR(safeToSpend)}
            </div>

            <p className="text-emerald-100/90 text-sm max-w-lg mb-6">
              Daily allowance: <strong className="text-white font-bold">{formatINR(dailyAllowance)} / day</strong> for the next {period.daysRemaining} days.
            </p>

            {/* Formula Breakdown */}
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

        {/* Variable Pay Holding Bucket Banner with Windfall Allocation trigger */}
        <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-slate-900 text-sm">
                  Variable Pay Holding Bucket (Not Counted Yet)
                </h4>
                <span className="font-bold text-amber-900 text-sm">{formatINR(unreceivedVariable)}</span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                Year-end bonuses and variable incentives stay isolated until received.
              </p>
            </div>
          </div>

          {expectedVariableSources.length > 0 && (
            <button
              onClick={() => setWindfallToAllocate(expectedVariableSources[0])}
              className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-colors shrink-0"
            >
              <PartyPopper className="w-3.5 h-3.5" />
              <span>Mark Received & Allocate</span>
            </button>
          )}
        </div>

        {/* Phase 5 Savings Goals Section */}
        <SavingsGoalsSection
          goals={savingsGoals}
          contributions={contributions}
          userId={initialUser.id}
          onGoalsUpdated={refreshData}
        />

        {/* Pacing & Burn Rate Card */}
        <BurnRateCard
          period={period}
          burnRate={burnRate}
          safeToSpend={safeToSpend}
          dailyAllowance={dailyAllowance}
        />

        {/* Category Progress Bars Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CategoryProgress categoryBudgets={categoryBudgets} type="flexible" />
          <CategoryProgress categoryBudgets={categoryBudgets} type="fixed" />
        </div>

        {/* Transaction History & Filters */}
        <TransactionList
          transactions={transactions}
          categories={categories}
          onEditTransaction={(item) => setEditingTransaction(item)}
          onOpenFastExpense={() => setIsExpenseOpen(true)}
        />
      </main>

      {/* Floating Action Button (FAB) for fast mobile access */}
      <div className="fixed bottom-6 right-6 sm:hidden z-30">
        <button
          onClick={() => setIsExpenseOpen(true)}
          className="w-14 h-14 rounded-full bg-emerald-600 text-white shadow-xl shadow-emerald-700/40 flex items-center justify-center transition-transform active:scale-95"
        >
          <Plus className="w-7 h-7" />
        </button>
      </div>

      {/* Modals */}
      <FastExpenseModal
        isOpen={isExpenseOpen}
        onClose={() => setIsExpenseOpen(false)}
        categories={categories}
        userId={initialUser.id}
        onExpenseAdded={refreshData}
        currentSafeToSpend={safeToSpend}
        recentTransactions={currentPeriodTransactions}
        onAlertTriggered={handleAlertTriggered}
      />

      <IncomeModal
        isOpen={isIncomeOpen}
        onClose={() => setIsIncomeOpen(false)}
        userId={initialUser.id}
        onIncomeAdded={refreshData}
      />

      <CategoryManagementModal
        isOpen={isCategoryOpen}
        onClose={() => setIsCategoryOpen(false)}
        categories={categories}
        userId={initialUser.id}
        onCategoriesUpdated={refreshData}
      />

      <EditTransactionModal
        isOpen={!!editingTransaction}
        onClose={() => setEditingTransaction(null)}
        transaction={editingTransaction}
        categories={categories}
        onTransactionUpdated={refreshData}
      />

      {/* Phase 5 Windfall Allocation Modal */}
      <WindfallAllocationModal
        isOpen={!!windfallToAllocate}
        onClose={() => setWindfallToAllocate(null)}
        incomeSource={windfallToAllocate}
        savingsGoals={savingsGoals}
        userId={initialUser.id}
        onAllocated={refreshData}
      />
    </div>
  );
}
