"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, TrendingUp } from "lucide-react";
import { formatINR } from "@/lib/budgetUtils";
import { formatShortDate } from "@/lib/recurrence.mjs";
import { simulateGoalCompletion, type analyzeGoal } from "@/lib/goalAnalytics.mjs";

type Analytics = ReturnType<typeof analyzeGoal>;

const STATUS: Record<Analytics["status"], { label: string; icon: React.ReactNode; className: string }> = {
  completed: { label: "Completed", icon: <CheckCircle2 className="w-3 h-3" />, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  on_track: { label: "On track", icon: <TrendingUp className="w-3 h-3" />, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  behind: { label: "Behind schedule", icon: <AlertTriangle className="w-3 h-3" />, className: "bg-amber-50 text-amber-800 border-amber-200" },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-xs font-bold text-slate-900">{value}</div>
    </div>
  );
}

/** Progress analytics + a read-only contribution simulator for one savings goal. */
export default function GoalAnalytics({ analytics }: { analytics: Analytics }) {
  const a = analytics;
  const s = STATUS[a.status];
  const defaultMonthly = a.monthlyPace || a.requiredMonthly;
  const [monthly, setMonthly] = useState(defaultMonthly);

  const sim = simulateGoalCompletion(a.remaining, monthly);
  const targetMonth = a.targetDate?.slice(0, 7) ?? null;
  const meetsTarget = sim && targetMonth ? sim.completionMonthKey <= targetMonth : null;
  const sliderMax = Math.max(a.requiredMonthly * 2, a.monthlyPace * 2, 500000);
  const pacePct = a.requiredMonthly > 0 ? Math.round((a.monthlyPace / a.requiredMonthly) * 100) : null;

  return (
    <div className="mt-3 space-y-3">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${s.className}`}>
        {s.icon}
        {s.label}
      </span>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Stat label="Remaining" value={formatINR(a.remaining)} />
        <Stat label="Target date" value={a.targetDate ? formatShortDate(a.targetDate) + " " + a.targetDate.slice(0, 4) : "Not set"} />
        <Stat
          label={a.hasTargetDate ? "Required per month" : "Per month to finish in a year"}
          value={a.status === "completed" ? "—" : a.isPastDeadline ? `${formatINR(a.requiredMonthly)} (deadline passed)` : formatINR(a.requiredMonthly)}
        />
        <Stat label="Current pace (last 90 days)" value={`${formatINR(a.monthlyPace)}/mo`} />
        <Stat
          label="Estimated completion"
          value={a.status === "completed" ? "Done" : a.estimatedCompletion ? a.estimatedCompletion.completionLabel : "No recent contributions"}
        />
        <Stat label="Pace vs required" value={pacePct === null || a.status === "completed" ? "—" : `${pacePct}%`} />
      </div>

      {a.status !== "completed" && a.remaining > 0 && (
        <details className="group rounded-xl border border-slate-200 bg-white/60 p-2.5">
          <summary className="cursor-pointer text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
            <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
            Contribution simulator
          </summary>
          <div className="mt-2 space-y-2 text-[11px]">
            <p className="text-slate-500">Simulation only — no contribution is recorded.</p>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={sliderMax}
                step={10000}
                value={Math.min(monthly, sliderMax)}
                onChange={(e) => setMonthly(Number(e.target.value))}
                aria-label="Simulated monthly contribution"
                className="flex-1 min-w-0 accent-purple-600"
              />
              <span className="font-bold text-slate-900 w-20 text-right">{formatINR(monthly)}/mo</span>
            </div>
            <p className="text-slate-700">
              {sim ? (
                <>
                  Completes around <strong>{sim.completionLabel}</strong> ({sim.monthsToGo} month{sim.monthsToGo === 1 ? "" : "s"})
                  {meetsTarget === true && <span className="text-emerald-700"> — meets your target date.</span>}
                  {meetsTarget === false && <span className="text-amber-700"> — after your target date.</span>}
                </>
              ) : (
                "With no monthly contribution this goal is never reached."
              )}
            </p>
            {monthly !== defaultMonthly && (
              <button type="button" onClick={() => setMonthly(defaultMonthly)} className="text-purple-700 font-semibold hover:underline">
                Reset to current pace
              </button>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
