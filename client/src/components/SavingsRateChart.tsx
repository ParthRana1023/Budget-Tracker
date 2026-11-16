"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { PiggyBank } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrTooltipProps } from "./ChartCard";
import { CHROME, SERIES } from "@/lib/chartTheme.mjs";
import type { MonthSummary } from "@/lib/reportsUtils";

interface SavingsRateChartProps {
  months: MonthSummary[];
  /** Optional target rate in percent (e.g. from the budget plan). */
  targetRate?: number | null;
}

/** D. Am I saving a steady share of my regular pay? Baseline excludes variable pay. */
export default function SavingsRateChart({ months, targetRate = null }: SavingsRateChartProps) {
  // A month without regular income has no baseline rate: leave a gap instead of plotting 0%.
  const data = months.map((m) => ({
    monthLabel: m.monthLabel,
    rate: m.regularIncome > 0 ? Math.round(m.baselineSavingsRate * 10) / 10 : null,
  }));
  const rated = data.filter((d) => d.rate !== null) as Array<{ monthLabel: string; rate: number }>;
  const average = rated.length ? rated.reduce((s, d) => s + d.rate, 0) / rated.length : null;
  const pct = (v: unknown) => `${Math.round(Number(v))}%`;

  return (
    <ChartCard
      title="Savings Rate Trend"
      question="Savings as a share of regular income each month. Bonuses are excluded so they do not inflate the rate."
      icon={<PiggyBank className="w-4 h-4" />}
      state={rated.length ? "ready" : "empty"}
      emptyMessage="Record received regular income to see your savings rate."
      table={
        <ChartTable
          headers={["Month", "Savings rate"]}
          rows={[
            ...data.map((d) => [d.monthLabel, d.rate === null ? "No regular income" : pct(d.rate)]),
            ...(average !== null ? [["Average", pct(average)]] : []),
            ...(targetRate !== null ? [["Target", pct(targetRate)]] : []),
          ]}
        />
      }
      footer={
        <p className="text-[11px] text-slate-500">
          {average !== null && <>Average {pct(average)} (dashed). </>}
          {targetRate !== null ? <>Target {pct(targetRate)} (dotted).</> : <>Set planned savings in the Budget Planner to show a target.</>}
        </p>
      }
    >
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="monthLabel" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={pct} width={40} domain={[0, (max: number) => Math.max(10, Math.ceil(max / 10) * 10)]} />
        <Tooltip {...inrTooltipProps} formatter={(v: unknown) => pct(v)} />
        {average !== null && <ReferenceLine y={average} stroke={CHROME.muted} strokeDasharray="6 4" />}
        {targetRate !== null && <ReferenceLine y={targetRate} stroke={CHROME.ink} strokeDasharray="2 3" />}
        <Line dataKey="rate" name="Savings rate" type="linear" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 4, fill: SERIES[0] }} connectNulls={false} />
      </LineChart>
    </ChartCard>
  );
}
