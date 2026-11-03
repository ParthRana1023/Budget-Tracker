"use client";

import { PeriodRange, BurnRateMetrics, formatINR } from "@/lib/budgetUtils";
import { Flame, Clock, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle } from "lucide-react";

interface BurnRateCardProps {
  period: PeriodRange;
  burnRate: BurnRateMetrics;
  safeToSpend: number;
  dailyAllowance: number;
}

export default function BurnRateCard({
  period,
  burnRate,
  safeToSpend,
  dailyAllowance,
}: BurnRateCardProps) {
  const percentPeriodPassed = Math.min(100, Math.round((period.daysElapsed / period.totalDays) * 100));

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
            <Flame className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Pacing & Burn Rate</h3>
            <p className="text-[11px] text-slate-500">
              Cycle: {period.periodLabel} (Day {period.daysElapsed} of {period.totalDays})
            </p>
          </div>
        </div>

        {/* Pacing Badge */}
        <div className="flex items-center gap-1.5">
          {burnRate.isOnTrack ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Pacing On Track</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Burning Fast</span>
            </span>
          )}
        </div>
      </div>

      {/* Cycle Progress Bar */}
      <div>
        <div className="flex justify-between text-[11px] text-slate-500 mb-1.5 font-medium">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-slate-400" />
            {period.daysRemaining} days left in cycle
          </span>
          <span>{percentPeriodPassed}% of cycle elapsed</span>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-slate-400 rounded-full transition-all duration-500"
            style={{ width: `${percentPeriodPassed}%` }}
          />
        </div>
      </div>

      {/* Burn Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
          <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">
            Allowed Daily Spend
          </span>
          <span className="text-base font-extrabold text-slate-900">
            {formatINR(dailyAllowance)}
            <span className="text-xs font-normal text-slate-500">/day</span>
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            For next {period.daysRemaining} days
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
          <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">
            Actual Daily Burn
          </span>
          <span className="text-base font-extrabold text-slate-900">
            {formatINR(burnRate.actualDailyRate)}
            <span className="text-xs font-normal text-slate-500">/day</span>
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Averaged so far
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 col-span-2 sm:col-span-1">
          <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">
            Month-End Projection
          </span>
          <span className={`text-base font-extrabold ${burnRate.isOnTrack ? "text-slate-900" : "text-amber-700"}`}>
            {formatINR(burnRate.projectedEndOfMonth)}
          </span>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            If current rate continues
          </span>
        </div>
      </div>
    </div>
  );
}

