"use client";

import { CalendarClock, CheckCircle2, Clock, HelpCircle } from "lucide-react";
import { formatINR } from "@/lib/budgetUtils";
import { formatShortDate } from "@/lib/recurrence.mjs";
import type { computeUpcomingObligations } from "@/lib/upcomingObligations.mjs";

type Obligations = ReturnType<typeof computeUpcomingObligations>;

const STATUS = {
  recorded: { label: "Recorded", icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />, row: "border-slate-200 bg-white" },
  due: { label: "Due — not recorded yet", icon: <Clock className="w-3.5 h-3.5 text-amber-600" />, row: "border-amber-200 bg-amber-50/60 border-dashed" },
  upcoming: { label: "Expected", icon: <Clock className="w-3.5 h-3.5 text-slate-400" />, row: "border-slate-200 bg-slate-50 border-dashed" },
  unscheduled: { label: "Expected, no fixed day", icon: <HelpCircle className="w-3.5 h-3.5 text-slate-400" />, row: "border-slate-200 bg-slate-50 border-dashed" },
} as const;

/** Recurring payments this cycle: what is still expected vs what has actually been recorded. */
export default function UpcomingObligations({ obligations, periodLabel }: { obligations: Obligations; periodLabel: string }) {
  const { items, totals } = obligations;

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
          <CalendarClock className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Upcoming Recurring Payments</h3>
          <p className="text-[11px] text-slate-500">
            {periodLabel}. Dashed rows are expected; solid rows are recorded transactions.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          No recurring payments set up. Mark an expense as recurring when you record it to see it here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              ["Monthly commitments", totals.monthlyCommitment],
              ["Fixed", totals.fixed],
              ["Flexible & other", totals.flexible + totals.uncategorized],
              ["Still expected", totals.stillExpected],
            ].map(([label, value]) => (
              <div key={label as string} className="p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="text-[11px] text-slate-500 font-semibold">{label}</div>
                <div className="font-black text-slate-900 text-sm mt-0.5">{formatINR(value as number)}</div>
              </div>
            ))}
          </div>

          <ol className="space-y-2">
            {items.map((i) => {
              const s = STATUS[i.status];
              return (
                <li key={i.id} className={`flex items-center gap-3 p-3 rounded-2xl border ${s.row}`}>
                  <div className="w-14 shrink-0 text-center">
                    <div className="text-xs font-bold text-slate-900">
                      {i.status === "recorded" && i.recordedDate ? formatShortDate(i.recordedDate) : i.dueDate ? formatShortDate(i.dueDate) : "—"}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-800 truncate">{i.name}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1">
                      {s.icon}
                      {s.label}
                      {i.categoryName && <> · {i.categoryName} ({i.categoryType ?? "uncategorised"})</>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-slate-900">{formatINR(i.recordedAmount ?? i.expectedAmount)}</div>
                    {i.recordedAmount !== null && i.recordedAmount !== i.expectedAmount && (
                      <div className="text-[10px] text-slate-400">expected {formatINR(i.expectedAmount)}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
