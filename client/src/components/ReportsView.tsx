"use client";

import { useState, useMemo } from "react";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
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
  computeYearlySummary,
} from "@/lib/reportsUtils";
import type { Insight } from "@/lib/insights.mjs";
import InsightsPanel from "./InsightsPanel";
import PerformanceIndicators from "./PerformanceIndicators";
import CashFlowChart from "./CashFlowChart";
import SavingsRateChart from "./SavingsRateChart";
import YearlySummaryChart from "./YearlySummaryChart";
import ExpenseDistributionChart from "./ExpenseDistributionChart";

interface ReportsViewProps {
  transactions: any[];
  categories: any[];
  incomeSources: any[];
  contributions: any[];
  insights: Insight[];
  /** Planned savings rate in percent, once a budget plan exists. */
  targetSavingsRate?: number | null;
}

export default function ReportsView({
  transactions,
  categories,
  incomeSources,
  contributions,
  insights,
  targetSavingsRate = null,
}: ReportsViewProps) {
  const currentYear = new Date().getFullYear();
  const [selectedMonthsCount, setSelectedMonthsCount] = useState<number>(6);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  // Compute 6-month trends
  const monthlyTrends = useMemo(() => {
    return computeMonthlyTrends(transactions, incomeSources, contributions, selectedMonthsCount);
  }, [transactions, incomeSources, contributions, selectedMonthsCount]);

  // Completed months only (the current month is partial), and the same span before it,
  // for the performance indicators and their period comparison.
  const { completedMonths, previousCompletedMonths } = useMemo(() => {
    const now = new Date();
    const lastFull = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const beforeThat = new Date(now.getFullYear(), now.getMonth() - 1 - selectedMonthsCount, 1);
    return {
      completedMonths: computeMonthlyTrends(transactions, incomeSources, contributions, selectedMonthsCount, lastFull),
      previousCompletedMonths: computeMonthlyTrends(transactions, incomeSources, contributions, selectedMonthsCount, beforeThat),
    };
  }, [transactions, incomeSources, contributions, selectedMonthsCount]);

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

      <InsightsPanel insights={insights} />

      <PerformanceIndicators months={completedMonths} previousMonths={previousCompletedMonths} />

      <CashFlowChart months={monthlyTrends} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SavingsRateChart months={monthlyTrends} targetRate={targetSavingsRate} />
        <YearlySummaryChart summary={yearlySummary} />
      </div>

      <ExpenseDistributionChart transactions={transactions} categories={categories} months={monthlyTrends} />
    </div>
  );
}

