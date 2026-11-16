"use client";

import { AlertCircle, AlertTriangle, Info, Lightbulb, TrendingUp } from "lucide-react";
import type { Insight } from "@/lib/insights.mjs";

const STYLE: Record<Insight["severity"], { icon: React.ReactNode; label: string; className: string }> = {
  critical: { icon: <AlertCircle className="w-4 h-4" />, label: "Action needed", className: "bg-rose-50 border-rose-200 text-rose-700" },
  warning: { icon: <AlertTriangle className="w-4 h-4" />, label: "Watch", className: "bg-amber-50 border-amber-200 text-amber-700" },
  info: { icon: <Info className="w-4 h-4" />, label: "Opportunity", className: "bg-blue-50 border-blue-200 text-blue-700" },
  positive: { icon: <TrendingUp className="w-4 h-4" />, label: "Going well", className: "bg-emerald-50 border-emerald-200 text-emerald-700" },
};

/** Deterministic insights from lib/insights.mjs: each shows the calculation behind it. */
export default function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
          <Lightbulb className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Financial Insights</h3>
          <p className="text-[11px] text-slate-500">Calculated from your own records. Each one shows why it appears.</p>
        </div>
      </div>

      {insights.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          Nothing needs your attention right now. Insights appear as your budget and history build up.
        </p>
      ) : (
        <ul className="space-y-3">
          {insights.map((i) => {
            const s = STYLE[i.severity];
            return (
              <li key={i.id} className={`p-3.5 rounded-2xl border ${s.className}`}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{s.icon}</span>
                  <div className="space-y-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900">
                      <span className="sr-only">{s.label}: </span>
                      {i.message}
                    </p>
                    <p className="text-[11px] text-slate-600">
                      <strong>Why:</strong> {i.why}
                    </p>
                    {i.action && (
                      <p className="text-[11px] text-slate-700">
                        <strong>Suggested:</strong> {i.action}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
