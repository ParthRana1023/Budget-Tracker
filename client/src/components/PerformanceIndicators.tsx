"use client";

import { Gauge } from "lucide-react";
import { formatINR } from "@/lib/budgetUtils";
import { computePerformance, comparePeriods } from "@/lib/performance.mjs";
import type { MonthSummary } from "@/lib/reportsUtils";

interface PerformanceIndicatorsProps {
  /** Completed months in the selected range (the current, partial month excluded). */
  months: MonthSummary[];
  /** The same number of completed months immediately before, for comparison. */
  previousMonths: MonthSummary[];
}

/** For spending, down is good; for savings, up is good. */
function Delta({ value, unit, goodWhenUp }: { value: number | null; unit: "%" | "pts"; goodWhenUp: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-slate-400">no earlier data</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className="text-slate-500">no change vs previous period</span>;
  const good = rounded > 0 === goodWhenUp;
  return (
    <span className={good ? "text-emerald-700" : "text-rose-600"}>
      {rounded > 0 ? "▲" : "▼"} {Math.abs(rounded)}
      {unit === "%" ? "%" : " pts"} vs previous period
    </span>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return (
    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
      <div className="text-[11px] text-slate-500 font-semibold">{label}</div>
      <div className="text-lg font-black text-slate-900 mt-0.5">{value}</div>
      <div className="text-[11px] mt-0.5">{note}</div>
    </div>
  );
}

/** G. Key performance indicators over completed months, compared with the period before. */
export default function PerformanceIndicators({ months, previousMonths }: PerformanceIndicatorsProps) {
  const perf = computePerformance(months);
  const cmp = comparePeriods(months, previousMonths);

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
          <Gauge className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Performance Indicators</h3>
          <p className="text-[11px] text-slate-500">
            Last {months.length} completed months, compared with the {previousMonths.length} before.
          </p>
        </div>
      </div>

      {!perf ? (
        <p className="py-6 text-center text-xs text-slate-500">Indicators appear once a full month of income or spending is recorded.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Tile
            label="Average monthly expenses"
            value={formatINR(perf.avgExpenses)}
            note={<Delta value={cmp?.expensesChangePct ?? null} unit="%" goodWhenUp={false} />}
          />
          <Tile
            label="Average monthly savings"
            value={formatINR(perf.avgSavings)}
            note={<Delta value={cmp?.savingsChangePct ?? null} unit="%" goodWhenUp />}
          />
          <Tile
            label="Average savings rate"
            value={perf.avgSavingsRate === null ? "—" : `${Math.round(perf.avgSavingsRate)}%`}
            note={
              perf.avgSavingsRate === null ? (
                <span className="text-slate-400">no regular income recorded</span>
              ) : (
                <Delta value={cmp?.savingsRateChangePts ?? null} unit="pts" goodWhenUp />
              )
            }
          />
          <Tile
            label="Flexible spending change"
            value={
              perf.flexibleChangePct === null
                ? "—"
                : `${perf.flexibleChangePct > 0 ? "+" : ""}${Math.round(perf.flexibleChangePct)}%`
            }
            note={
              perf.flexibleChangeFrom && perf.flexibleChangeTo && perf.flexibleChangePct !== null ? (
                <span className="text-slate-500">
                  {perf.flexibleChangeTo.monthLabel} vs {perf.flexibleChangeFrom.monthLabel}
                </span>
              ) : (
                <span className="text-slate-400">needs two months with flexible spending</span>
              )
            }
          />
          <Tile
            label="Highest spending month"
            value={perf.highestSpendMonth?.monthLabel ?? "—"}
            note={<span className="text-slate-500">{perf.highestSpendMonth ? formatINR(perf.highestSpendMonth.totalExpenses) : "no expenses"}</span>}
          />
          <Tile
            label="Best savings month"
            value={perf.bestSavingsMonth?.monthLabel ?? "—"}
            note={<span className="text-slate-500">{perf.bestSavingsMonth ? formatINR(perf.bestSavingsMonth.savingsContributions) : "no savings yet"}</span>}
          />
        </div>
      )}
    </section>
  );
}
