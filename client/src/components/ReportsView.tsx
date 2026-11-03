"use client";

import { useState, useMemo } from "react";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  PieChart, 
  Calendar, 
  ArrowUpRight, 
  ArrowDownLeft, 
  PiggyBank, 
  Wallet, 
  Layers, 
  Coins, 
  Sparkles,
  Info
} from "lucide-react";
import { formatINR } from "@/lib/budgetUtils";
import { 
  computeMonthlyTrends, 
  computeMonthlyCategoryBreakdown, 
  computeYearlySummary,
  MonthSummary
} from "@/lib/reportsUtils";

interface ReportsViewProps {
  transactions: any[];
  categories: any[];
  incomeSources: any[];
  contributions: any[];
}

export default function ReportsView({
  transactions,
  categories,
  incomeSources,
  contributions,
}: ReportsViewProps) {
  const currentYear = new Date().getFullYear();
  const [selectedMonthsCount, setSelectedMonthsCount] = useState<number>(6);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  // Compute 6-month trends
  const monthlyTrends = useMemo(() => {
    return computeMonthlyTrends(transactions, incomeSources, contributions, selectedMonthsCount);
  }, [transactions, incomeSources, contributions, selectedMonthsCount]);

  // Selected active month for category breakdown (defaults to latest month)
  const [activeMonthKey, setActiveMonthKey] = useState<string>(
    monthlyTrends[monthlyTrends.length - 1]?.monthKey || new Date().toISOString().slice(0, 7)
  );

  // Category breakdown for selected month
  const categoryBreakdown = useMemo(() => {
    return computeMonthlyCategoryBreakdown(transactions, categories, activeMonthKey);
  }, [transactions, categories, activeMonthKey]);

  // Yearly Summary with isolated variable pay
  const yearlySummary = useMemo(() => {
    return computeYearlySummary(transactions, incomeSources, contributions, selectedYear);
  }, [transactions, incomeSources, contributions, selectedYear]);

  // Average savings rate across the selected trend period
  const avgSavingsRate = useMemo(() => {
    const valid = monthlyTrends.filter((m) => m.regularIncome > 0);
    if (valid.length === 0) return 0;
    const sum = valid.reduce((s, m) => s + m.baselineSavingsRate, 0);
    return Math.round(sum / valid.length);
  }, [monthlyTrends]);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Controls & Time Range Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base sm:text-lg font-bold text-slate-900">Reports & Trend Analytics</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Evaluate your savings rate, monthly trends, and disciplined windfall allocations
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium hidden sm:inline">Range:</span>
          {[3, 6, 12].map((count) => (
            <button
              key={count}
              onClick={() => setSelectedMonthsCount(count)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                selectedMonthsCount === count
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {count}M
            </button>
          ))}
        </div>
      </div>

      {/* Top 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Card 1: Average Savings Rate */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-2">
              <span>Avg Baseline Savings Rate</span>
              <div className="w-7 h-7 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                <PiggyBank className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-slate-900 mb-1">
              {avgSavingsRate}%
            </div>
            <p className="text-[11px] text-slate-500">
              Computed strictly from confirmed regular take-home pay
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-purple-700 font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Savings-First Principle</span>
          </div>
        </div>

        {/* Card 2: Total Saved */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-2">
              <span>{selectedYear} Total Savings</span>
              <div className="w-7 h-7 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Coins className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black text-emerald-700 mb-1">
              {formatINR(yearlySummary.totalSavings)}
            </div>
            <p className="text-[11px] text-slate-500">
              Direct contributions towards active savings goals
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-emerald-700 font-semibold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Secured Future Buffer</span>
          </div>
        </div>

        {/* Card 3: Net Surplus */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-500 text-xs font-semibold mb-2">
              <span>{selectedYear} Net Surplus</span>
              <div className="w-7 h-7 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            <div className={`text-3xl font-black mb-1 ${yearlySummary.netSurplus >= 0 ? "text-slate-900" : "text-rose-600"}`}>
              {formatINR(yearlySummary.netSurplus)}
            </div>
            <p className="text-[11px] text-slate-500">
              Total Income − Total Expenses − Savings
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] text-slate-600 font-medium">
            <span>Positive Cash Flow</span>
          </div>
        </div>
      </div>

      {/* Month-over-Month Trend Section */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Month-over-Month Trend</h3>
            <p className="text-[11px] text-slate-500">
              Track how your income, spending, and savings rate evolve across cycles
            </p>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            Showing last {selectedMonthsCount} months
          </span>
        </div>

        {/* Visual Trend Bars */}
        <div className="space-y-4 pt-1">
          {monthlyTrends.map((month) => {
            const maxVal = Math.max(month.totalIncome, month.totalExpenses + month.savingsContributions, 1);
            const expenseWidth = Math.min(100, (month.totalExpenses / maxVal) * 100);
            const savingsWidth = Math.min(100, (month.savingsContributions / maxVal) * 100);

            return (
              <div
                key={month.monthKey}
                onClick={() => setActiveMonthKey(month.monthKey)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  activeMonthKey === month.monthKey
                    ? "bg-emerald-50/50 border-emerald-300 ring-2 ring-emerald-500/20"
                    : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-xs">{month.monthLabel}</span>
                    {month.variableIncome > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">
                        +{formatINR(month.variableIncome)} Windfall
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs font-medium">
                    <span className="text-slate-500">
                      Income: <strong className="text-slate-900">{formatINR(month.totalIncome)}</strong>
                    </span>
                    <span className="text-slate-500">
                      Savings: <strong className="text-purple-700">{formatINR(month.savingsContributions)}</strong> ({Math.round(month.baselineSavingsRate)}%)
                    </span>
                  </div>
                </div>

                {/* Progress / Ratio Bar */}
                <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden flex gap-0.5">
                  <div
                    style={{ width: `${expenseWidth}%` }}
                    className="bg-rose-500 h-full rounded-l-full"
                    title={`Expenses: ${formatINR(month.totalExpenses)}`}
                  />
                  <div
                    style={{ width: `${savingsWidth}%` }}
                    className="bg-purple-600 h-full rounded-r-full"
                    title={`Savings: ${formatINR(month.savingsContributions)}`}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1.5">
                  <span>Expenses: <strong className="text-slate-700">{formatINR(month.totalExpenses)}</strong> (Fixed: {formatINR(month.fixedExpenses)}, Flex: {formatINR(month.flexibleExpenses)})</span>
                  <span>Net Flow: <strong className={month.netCashFlow >= 0 ? "text-emerald-700" : "text-rose-600"}>{formatINR(month.netCashFlow)}</strong></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Two Column Section: Category Share & Yearly Windfall Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown for Active Month */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Monthly Category Breakdown</h3>
              <p className="text-[11px] text-slate-500">
                Spending share for <strong>{activeMonthKey}</strong> (Total: {formatINR(categoryBreakdown.totalSpent)})
              </p>
            </div>
            <PieChart className="w-4 h-4 text-emerald-600" />
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {categoryBreakdown.items.length > 0 ? (
              categoryBreakdown.items.map((item) => (
                <div key={item.categoryId} className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{item.categoryName}</span>
                      <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                        • {item.categoryType}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-slate-900">{formatINR(item.amount)}</span>
                      <span className="text-slate-400 text-[11px] ml-1">({Math.round(item.percentOfTotal)}%)</span>
                    </div>
                  </div>

                  <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${Math.min(100, item.percentOfTotal)}%` }}
                      className={`h-full rounded-full ${item.categoryType === "fixed" ? "bg-emerald-500" : "bg-blue-500"}`}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-slate-400 text-xs">
                No expense transactions recorded for {activeMonthKey}.
              </div>
            )}
          </div>
        </div>

        {/* Yearly View with Variable Pay as its Own Line */}
        <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{selectedYear} Yearly Summary</h3>
              <p className="text-[11px] text-slate-500">
                Variable pay is isolated on its own line to prevent savings rate distortion
              </p>
            </div>
            <Calendar className="w-4 h-4 text-amber-600" />
          </div>

          {/* Detailed Statement rows */}
          <div className="space-y-2 text-xs">
            {/* Regular Income */}
            <div className="p-3 rounded-xl bg-slate-50 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800 block">1. Regular Take-Home Income</span>
                <span className="text-[11px] text-slate-500">Base salary & guaranteed monthly earnings</span>
              </div>
              <span className="font-bold text-slate-900 text-sm">
                {formatINR(yearlySummary.totalRegularIncome)}
              </span>
            </div>

            {/* Variable Pay (Isolated as its own line) */}
            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-amber-950 block">2. Variable Pay & Windfalls</span>
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-200/80 text-amber-900 text-[10px] font-bold">
                    Isolated
                  </span>
                </div>
                <span className="text-[11px] text-amber-800">Performance incentives, annual bonuses</span>
              </div>
              <span className="font-extrabold text-amber-950 text-sm">
                + {formatINR(yearlySummary.totalVariableIncome)}
              </span>
            </div>

            {/* Combined Inflow */}
            <div className="px-3 py-1 flex items-center justify-between text-slate-400 text-[11px]">
              <span>Combined Total Inflow</span>
              <span>{formatINR(yearlySummary.combinedIncome)}</span>
            </div>

            {/* Fixed Expenses */}
            <div className="p-3 rounded-xl bg-slate-50 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800 block">3. Fixed Obligations & Bills</span>
                <span className="text-[11px] text-slate-500">Rent, utilities, EMIs, insurance, subscriptions</span>
              </div>
              <span className="font-bold text-rose-700 text-sm">
                − {formatINR(yearlySummary.totalFixedExpenses)}
              </span>
            </div>

            {/* Flexible Expenses */}
            <div className="p-3 rounded-xl bg-slate-50 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800 block">4. Flexible Day-to-Day Spending</span>
                <span className="text-[11px] text-slate-500">Groceries, food, fuel, shopping, entertainment</span>
              </div>
              <span className="font-bold text-rose-700 text-sm">
                − {formatINR(yearlySummary.totalFlexibleExpenses)}
              </span>
            </div>

            {/* Savings Goals Contributions */}
            <div className="p-3 rounded-xl bg-purple-50/80 border border-purple-100 flex items-center justify-between">
              <div>
                <span className="font-bold text-purple-950 block">5. Savings Goals Contributions</span>
                <span className="text-[11px] text-purple-800">
                  Secured into Emergency Fund & savings goals
                </span>
              </div>
              <span className="font-extrabold text-purple-950 text-sm">
                {formatINR(yearlySummary.totalSavings)}
              </span>
            </div>

            {/* Year-End Net Surplus */}
            <div className="p-3.5 rounded-2xl bg-emerald-800 text-white flex items-center justify-between mt-3">
              <div>
                <span className="font-bold block text-sm">Year-End Net Surplus</span>
                <span className="text-[11px] text-emerald-200">
                  Unallocated buffer after full savings discipline
                </span>
              </div>
              <span className="font-black text-lg">
                {formatINR(yearlySummary.netSurplus)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

