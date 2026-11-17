"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, AlertTriangle, CheckCircle2, Gauge, TrendingUp } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrAxisProps, inrTooltipProps, legendProps } from "./ChartCard";
import { formatINR } from "@/lib/budgetUtils";
import { formatShortDate } from "@/lib/recurrence.mjs";
import { CHROME, SERIES } from "@/lib/chartTheme.mjs";
import type { computeSpendingPace } from "@/lib/spendingPace.mjs";

type Pace = ReturnType<typeof computeSpendingPace>;

const STATUS: Record<Pace["status"], { label: string; icon: React.ReactNode; className: string }> = {
  on_track: { label: "On track", icon: <CheckCircle2 className="w-3.5 h-3.5" />, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  faster: { label: "Spending faster than planned", icon: <TrendingUp className="w-3.5 h-3.5" />, className: "bg-amber-50 text-amber-700 border-amber-200" },
  at_risk: { label: "Budget at risk", icon: <AlertTriangle className="w-3.5 h-3.5" />, className: "bg-orange-50 text-orange-700 border-orange-200" },
  exceeded: { label: "Budget exceeded", icon: <AlertCircle className="w-3.5 h-3.5" />, className: "bg-rose-50 text-rose-700 border-rose-200" },
  no_budget: { label: "No flexible budget set", icon: <Gauge className="w-3.5 h-3.5" />, className: "bg-slate-50 text-slate-600 border-slate-200" },
};

/** C. Am I spending faster or slower than planned this cycle, and where will I end up? */
export default function SpendingPaceChart({ pace, periodLabel }: { pace: Pace; periodLabel: string }) {
  const s = STATUS[pace.status];
  const data = pace.points.map((p) => ({ ...p, label: formatShortDate(p.date) }));
  const today = pace.points.filter((p) => p.actual !== null).at(-1);

  return (
    <ChartCard
      title="Spending Pace"
      question={`Cumulative flexible spending this cycle (${periodLabel}) against the even pace your limits allow.`}
      icon={<Gauge className="w-4 h-4" />}
      state={pace.status === "no_budget" && pace.flexibleSpent === 0 ? "empty" : "ready"}
      emptyMessage="Set limits on your flexible categories to compare spending with a plan."
      actions={
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[11px] font-semibold ${s.className}`}>
          {s.icon}
          {s.label}
        </span>
      }
      table={
        <ChartTable
          headers={["", "Amount"]}
          rows={[
            ["Spent so far", formatINR(pace.flexibleSpent)],
            ["Planned by today", formatINR(pace.burnRate.expectedSpentByNow)],
            ["Flexible budget", formatINR(pace.flexibleBudget)],
            ["Projected at cycle end", formatINR(pace.projectedEnd)],
            ["Projected overspend", formatINR(pace.projectedOverspend)],
            ["Actual daily rate", formatINR(pace.burnRate.actualDailyRate)],
            ["Planned daily rate", formatINR(pace.burnRate.expectedDailyRate)],
          ]}
        />
      }
      footer={
        <p className="text-[11px] text-slate-500">
          Spent <strong className="text-slate-700">{formatINR(pace.flexibleSpent)}</strong> vs{" "}
          <strong className="text-slate-700">{formatINR(pace.burnRate.expectedSpentByNow)}</strong> planned by today.
          {pace.flexibleBudget > 0 && (
            <>
              {" "}At this pace the cycle ends at <strong className="text-slate-700">{formatINR(pace.projectedEnd)}</strong>
              {pace.projectedOverspend > 0 ? <> — {formatINR(pace.projectedOverspend)} over budget.</> : <> — within budget.</>}
            </>
          )}
        </p>
      }
    >
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="label" {...axisProps} minTickGap={24} />
        <YAxis {...inrAxisProps} />
        <Tooltip {...inrTooltipProps} />
        <Legend {...legendProps} />
        {pace.flexibleBudget > 0 && (
          <ReferenceLine y={pace.flexibleBudget} stroke={CHROME.ink} strokeDasharray="2 3" label={{ value: "Budget", fill: CHROME.muted, fontSize: 10, position: "insideTopLeft" }} />
        )}
        {today && <ReferenceLine x={formatShortDate(today.date)} stroke={CHROME.axis} />}
        {pace.flexibleBudget > 0 && (
          <Line dataKey="expected" name="Planned pace" type="linear" stroke={CHROME.muted} strokeDasharray="6 4" strokeWidth={2} dot={false} />
        )}
        <Line dataKey="projected" name="Projected" type="linear" stroke={SERIES[1]} strokeDasharray="4 3" strokeWidth={2} dot={false} connectNulls={false} />
        <Line dataKey="actual" name="Actual" type="stepAfter" stroke={SERIES[0]} strokeWidth={2} dot={false} connectNulls={false} />
      </LineChart>
    </ChartCard>
  );
}
