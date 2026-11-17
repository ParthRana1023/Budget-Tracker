"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
  PartyPopper,
  BarChart3,
  LayoutDashboard,
  Download,
  ClipboardList
} from "lucide-react";
import PlanView from "./PlanView";
import { BUDGET_PLAN_SELECT, type BudgetPlanRow } from "@/lib/budgetPlans";
import ThemeToggle from "./ThemeToggle";
import FastExpenseModal, { Category } from "./FastExpenseModal";
import IncomeModal from "./IncomeModal";
import CategoryManagementModal from "./CategoryManagementModal";
import TransactionList from "./TransactionList";
import EditTransactionModal, { TransactionItem } from "./EditTransactionModal";
import BurnRateCard from "./BurnRateCard";
import AlertBanner from "./AlertBanner";
import SavingsGoalsSection, { SavingsGoal } from "./SavingsGoalsSection";
import WindfallAllocationModal from "./WindfallAllocationModal";
import ReportsView from "./ReportsView";
import RecurringAutoRecordedAlert from "./RecurringAutoRecordedAlert";
import { toLocalDateString, msUntilNextLocalMidnight } from "@/lib/periods.mjs";
import { mergeAutoRecorded } from "@/lib/recurrence.mjs";
import { calculateSafeToSpend, computeCycleBudgetInputs } from "@/lib/safeToSpend.mjs";
import type { AutoRecordedEntry, RecurringItem } from "@/lib/recurringTypes";
import { 
  getPeriodRange, 
  computeCategoryBudgets, 
  formatINR
} from "@/lib/budgetUtils";
import { computeMonthlyTrends } from "@/lib/reportsUtils";
import { computeSpendingPace } from "@/lib/spendingPace.mjs";
import { computeUpcomingObligations } from "@/lib/upcomingObligations.mjs";
import SpendingPaceChart from "./SpendingPaceChart";
import BudgetVsActualChart from "./BudgetVsActualChart";
import UpcomingObligations from "./UpcomingObligations";
import { generateInsights } from "@/lib/insights.mjs";
import { getCategoryLimitAlerts, getSavingsTargetAlert, BudgetAlert } from "@/lib/alertUtils";
import { transactionsToCsv } from "@/lib/csvExport.mjs";

interface DashboardClientProps {
  initialUser: { id: string; email?: string };
  initialSettings: { currency: string; month_start_day: number } | null;
  initialCategories: Category[];
  initialTransactions: TransactionItem[];
  initialIncomeSources: any[];
  initialSavingsGoals: any[];
  initialContributions: Array<{ goal_id: string; amount: number; date?: string }>;
  initialRecurringItems: any[];
  initialPlans: BudgetPlanRow[];
  /** False until the budget_plans migration has been run. */
  plansAvailable: boolean;
}

export default function DashboardClient({
  initialUser,
  initialSettings,
  initialCategories,
  initialTransactions,
  initialIncomeSources,
  initialSavingsGoals,
  initialContributions,
  initialRecurringItems,
  initialPlans,
  plansAvailable,
}: DashboardClientProps) {
  const router = useRouter();

  // Navigation tab: 'dashboard' vs 'reports'
  const [activeTab, setActiveTab] = useState<"dashboard" | "reports" | "plan">("dashboard");
  const [plans, setPlans] = useState<BudgetPlanRow[]>(initialPlans);

  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [transactions, setTransactions] = useState<TransactionItem[]>(initialTransactions);
  const [incomeSources, setIncomeSources] = useState<any[]>(initialIncomeSources);
  const [savingsGoals, setSavingsGoals] = useState<any[]>(initialSavingsGoals);
  const [contributions, setContributions] = useState<any[]>(initialContributions);
  const [recurringItems, setRecurringItems] = useState<RecurringItem[]>(initialRecurringItems);
  const [settings] = useState(initialSettings);

  // Modals state
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<TransactionItem | null>(null);
  const [windfallToAllocate, setWindfallToAllocate] = useState<{ id: string; name: string; amount: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [autoRecorded, setAutoRecorded] = useState<AutoRecordedEntry[]>([]);

  // Current period computation based on month_start_day
  const period = useMemo(() => {
    return getPeriodRange(new Date(), settings?.month_start_day || 1);
  }, [settings?.month_start_day]);
  const { startStr, endStr } = period; // local YYYY-MM-DD, inclusive

  // Filter transactions within active billing cycle
  const currentPeriodTransactions = useMemo(
    () => transactions.filter((t) => t.date >= period.startStr && t.date <= period.endStr),
    [transactions, period]
  );

  // Function to refresh state from Supabase
  const refreshData = async () => {
    const supabase = createClient();

    const [catRes, txRes, incRes, goalRes, contribRes, recurringRes] = await Promise.all([
      supabase.from("categories").select("*").eq("user_id", initialUser.id).order("name"),
      supabase
        .from("transactions")
        .select("id, category_id, amount, type, date, note, external_id, category:categories(name, type)")
        .eq("user_id", initialUser.id)
        .order("date", { ascending: false }),
      supabase.from("income_sources").select("*").eq("user_id", initialUser.id),
      supabase.from("savings_goals").select("*").eq("user_id", initialUser.id),
      supabase.from("goal_contributions").select("goal_id, amount, date").eq("user_id", initialUser.id),
      supabase.from("recurring_items").select("*").eq("user_id", initialUser.id),
    ]);

    if (catRes.data) setCategories(catRes.data as any);
    if (txRes.data) setTransactions(txRes.data as any);
    if (incRes.data) setIncomeSources(incRes.data);
    if (goalRes.data) setSavingsGoals(goalRes.data);
    if (contribRes.data) setContributions(contribRes.data);
    if (recurringRes.data) setRecurringItems(recurringRes.data as RecurringItem[]);

    if (plansAvailable) {
      const plansRes = await supabase
        .from("budget_plans")
        .select(BUDGET_PLAN_SELECT)
        .eq("user_id", initialUser.id)
        .order("cycle_start", { ascending: true });
      if (plansRes.data) setPlans(plansRes.data as unknown as BudgetPlanRow[]);
    }
  };

  // ---- Recurring items: record occurrences whose day has ended -------------
  // The database does the recording (process_due_recurring); this just asks it, using the
  // user's LOCAL date, and shows an alert for whatever it recorded. It runs when the app
  // opens, when the tab becomes visible again, and at every local midnight (end of day)
  // while the app stays open. Calling it again is always safe: it never records twice.
  const refreshRef = useRef(refreshData);
  refreshRef.current = refreshData;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const processRecurring = async () => {
      const { data, error } = await createClient().rpc("process_due_recurring", { p_today: toLocalDateString() });
      if (cancelled) return;
      if (error) {
        console.error("process_due_recurring failed:", error.message);
        return;
      }
      if (data && data.length > 0) {
        setAutoRecorded((prev) => mergeAutoRecorded(prev, data));
        await refreshRef.current();
      }
    };

    const scheduleMidnight = () => {
      timer = setTimeout(async () => {
        await processRecurring();
        if (!cancelled) scheduleMidnight();
      }, msUntilNextLocalMidnight() + 1000);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") processRecurring();
    };

    processRecurring();
    scheduleMidnight();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Undo an automatic record: removes it and stops it coming back for that month.
  const undoAutoRecorded = async (entry: AutoRecordedEntry): Promise<string | null> => {
    const { error } = await createClient().rpc("undo_recurring_post", { p_transaction_id: entry.transactionId });
    if (error) return error.message;
    setAutoRecorded((prev) => prev.filter((e) => e.transactionId !== entry.transactionId));
    await refreshData();
    return null;
  };

  // Safe to spend math (shared with the planner/simulator via lib/safeToSpend.mjs)
  const {
    confirmedIncome,
    expectedVariableSources,
    unreceivedVariable,
    budgetedFixedBills,
    paidFixedBills,
    flexibleSpent,
    targetSavings,
  } = computeCycleBudgetInputs({ incomeSources, contributions, categories, cycleTransactions: currentPeriodTransactions, startStr, endStr });
  const flexibleCategories = categories.filter((c) => c.type === "flexible");

  // Core formula: Safe to spend = Confirmed Income − Target Savings − Remaining Unpaid Fixed Bills − Flexible Spent
  const { remainingFixedBills, safeToSpend, dailyAllowance } = calculateSafeToSpend({
    confirmedIncome,
    targetSavings,
    budgetedFixedBills,
    paidFixedBills,
    flexibleSpent,
    daysRemaining: period.daysRemaining,
  });

  // Compute per-category progress
  const categoryBudgets = useMemo(() => {
    return computeCategoryBudgets(categories, currentPeriodTransactions);
  }, [categories, currentPeriodTransactions]);

  // Compute flexible budget burn rate metrics
  const totalFlexibleBudget = flexibleCategories.reduce((sum, c) => sum + Number(c.monthly_limit), 0);
  // Cumulative pace for the cycle; its burnRate is the same computeBurnRate result the Pacing card uses.
  const pace = useMemo(
    () => computeSpendingPace({ flexibleBudget: totalFlexibleBudget, cycleTransactions: currentPeriodTransactions, period }),
    [totalFlexibleBudget, currentPeriodTransactions, period]
  );
  const burnRate = pace.burnRate;

  const obligations = useMemo(
    () =>
      computeUpcomingObligations({
        recurringItems,
        categories,
        transactions,
        period,
        today: toLocalDateString(),
      }),
    [recurringItems, categories, transactions, period]
  );

  // Target savings rate for Reports: the plan for the current cycle, else the next saved plan.
  const targetSavingsRate = useMemo(() => {
    const plan = plans.find((p) => p.cycle_start === startStr) ?? plans.find((p) => p.cycle_start > startStr);
    const income = Number(plan?.expected_regular_income ?? 0);
    return plan && income > 0 ? (Number(plan.planned_savings) / income) * 100 : null;
  }, [plans, startStr]);

  // Budget chart -> transaction list: filter to the category and bring the list into view.
  const [txCategoryFilter, setTxCategoryFilter] = useState<string>("all");
  const transactionListRef = useRef<HTMLDivElement>(null);
  const inspectCategory = (categoryId: string) => {
    setTxCategoryFilter(categoryId);
    transactionListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Deterministic insights: current cycle + the last 6 completed calendar months.
  const insights = useMemo(() => {
    const now = new Date();
    const completedMonths = computeMonthlyTrends(
      transactions, incomeSources, contributions, 6, new Date(now.getFullYear(), now.getMonth() - 1, 1)
    );
    return generateInsights({ categoryBudgets, period, pace, completedMonths });
  }, [transactions, incomeSources, contributions, categoryBudgets, period, pace]);

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

  const handleExportTransactions = () => {
    const csv = transactionsToCsv(transactions);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = url;
    download.download = "savefirst-transactions.csv";
    download.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-24 sm:pb-12">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-3 sticky top-0 z-40 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-xs">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-slate-900 text-sm tracking-tight block">SaveFirst Tracker</span>
              <span className="text-[10px] text-slate-500 hidden sm:block">Savings-First Engine</span>
            </div>
          </div>

          {/* Desktop Tab Switcher */}
          <nav className="hidden sm:flex items-center p-1 bg-slate-100 rounded-xl">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === "dashboard"
                  ? "bg-white text-emerald-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </button>
            <button
              onClick={() => setActiveTab("reports")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === "reports"
                  ? "bg-white text-emerald-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Reports & Trends</span>
            </button>
            <button
              onClick={() => setActiveTab("plan")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === "plan"
                  ? "bg-white text-emerald-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Plan</span>
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
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

      {/* Mobile Sub-Navigation Bar */}
      <div className="sm:hidden px-4 pt-3 flex border-b border-slate-200 bg-white">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex-1 py-2 text-xs font-semibold border-b-2 text-center transition-all ${
            activeTab === "dashboard"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab("reports")}
          className={`flex-1 py-2 text-xs font-semibold border-b-2 text-center transition-all ${
            activeTab === "reports"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Reports & Trends
        </button>
        <button
          onClick={() => setActiveTab("plan")}
          className={`flex-1 py-2 text-xs font-semibold border-b-2 text-center transition-all ${
            activeTab === "plan"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Plan
        </button>
      </div>

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

        {/* VIEW 1: ACTIVE DASHBOARD */}
        {activeTab === "dashboard" ? (
          <>
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
                <button
                  id="export-transactions-btn"
                  onClick={handleExportTransactions}
                  className="p-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors shadow-xs"
                  title="Export transactions as CSV"
                  aria-label="Export transactions as CSV"
                >
                  <Download className="w-4 h-4" />
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

            <SpendingPaceChart pace={pace} periodLabel={period.periodLabel} />

            <UpcomingObligations obligations={obligations} periodLabel={period.periodLabel} />

            <BudgetVsActualChart categoryBudgets={categoryBudgets} onSelectCategory={inspectCategory} />

            {/* Transaction History & Filters */}
            <div ref={transactionListRef} className="scroll-mt-20">
              <TransactionList
                transactions={transactions}
                categories={categories}
                onEditTransaction={(item) => setEditingTransaction(item)}
                onOpenFastExpense={() => setIsExpenseOpen(true)}
                selectedCategory={txCategoryFilter}
                onSelectedCategoryChange={setTxCategoryFilter}
              />
            </div>
          </>
        ) : activeTab === "reports" ? (
          /* VIEW 2: PHASE 6 REPORTS & TREND ANALYTICS */
          <ReportsView
            transactions={transactions}
            categories={categories}
            incomeSources={incomeSources}
            contributions={contributions}
            insights={insights}
            targetSavingsRate={targetSavingsRate}
          />
        ) : (
          /* VIEW 3: BUDGET PLANNER, WHAT-IF SIMULATOR & FORECAST */
          <PlanView
            categories={categories}
            recurringItems={recurringItems}
            incomeSources={incomeSources}
            transactions={transactions}
            contributions={contributions}
            monthStartDay={settings?.month_start_day || 1}
            period={period}
            categoryBudgets={categoryBudgets}
            actualIncomeThisCycle={confirmedIncome}
            recurringFixedTotal={obligations.totals.fixed}
            plans={plans}
            plansAvailable={plansAvailable}
            onChanged={refreshData}
          />
        )}
      </main>

      {/* Floating Action Button (FAB) for fast mobile access */}
      {activeTab === "dashboard" && (
        <div className="fixed bottom-6 right-6 sm:hidden z-30">
          <button
            onClick={() => setIsExpenseOpen(true)}
            className="w-14 h-14 rounded-full bg-emerald-600 text-white shadow-xl shadow-emerald-700/40 flex items-center justify-center transition-transform active:scale-95"
          >
            <Plus className="w-7 h-7" />
          </button>
        </div>
      )}

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
        recurringItems={recurringItems}
        allTransactions={transactions}
      />

      <IncomeModal
        isOpen={isIncomeOpen}
        onClose={() => setIsIncomeOpen(false)}
        userId={initialUser.id}
        onIncomeAdded={refreshData}
        recurringItems={recurringItems}
        allTransactions={transactions}
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

      {/* Windfall Allocation Modal */}
      <WindfallAllocationModal
        isOpen={!!windfallToAllocate}
        onClose={() => setWindfallToAllocate(null)}
        incomeSource={windfallToAllocate}
        savingsGoals={savingsGoals}
        userId={initialUser.id}
        onAllocated={refreshData}
      />

      <RecurringAutoRecordedAlert entries={autoRecorded} onUndo={undoAutoRecorded} onDismiss={() => setAutoRecorded([])} />
    </div>
  );
}
