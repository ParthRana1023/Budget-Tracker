"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { Calendar } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrAxisProps, inrTooltipProps } from "./ChartCard";
import { formatINR } from "@/lib/budgetUtils";
import { CHROME, SERIES } from "@/lib/chartTheme.mjs";
import type { YearlySummary } from "@/lib/reportsUtils";

/** F. How did the year's income turn into spending, savings and surplus? Waterfall with variable pay as its own step. */
export default function YearlySummaryChart({ summary }: { summary: YearlySummary }) {
  // `short` keeps x-axis labels from colliding; the full name shows in the tooltip and table.
  const steps: Array<{ name: string; short: string; delta: number; color: string }> = [
    { name: "Regular income", short: "Regular", delta: summary.totalRegularIncome, color: SERIES[0] },
    { name: "Variable income", short: "Variable", delta: summary.totalVariableIncome, color: SERIES[1] },
    { name: "Fixed expenses", short: "Fixed", delta: -summary.totalFixedExpenses, color: SERIES[2] },
    { name: "Flexible expenses", short: "Flexible", delta: -summary.totalFlexibleExpenses, color: SERIES[3] },
    { name: "Savings", short: "Savings", delta: -summary.totalSavings, color: SERIES[4] },
  ];

  // Range bars: each step spans from the running total before it to the one after it.
  let running = 0;
  const data = steps.map((s) => {
    const start = running;
    running += s.delta;
    return { name: s.name, short: s.short, range: [Math.min(start, running), Math.max(start, running)], amount: s.delta, color: s.color };
  });
  data.push({
    name: "Net surplus",
    short: "Surplus",
    range: [Math.min(0, summary.netSurplus), Math.max(0, summary.netSurplus)],
    amount: summary.netSurplus,
    color: CHROME.ink,
  });

  const hasData = summary.combinedIncome + summary.totalExpenses + summary.totalSavings > 0;
  const signed = (v: number) => `${v < 0 ? "− " : v > 0 ? "+ " : ""}${formatINR(Math.abs(v))}`;

  return (
    <ChartCard
      title={`${summary.year} Yearly Summary`}
      question="How the year's income became spending, savings and surplus. Variable pay is shown as its own step."
      icon={<Calendar className="w-4 h-4" />}
      state={hasData ? "ready" : "empty"}
      emptyMessage={`No income, expenses or savings recorded in ${summary.year}.`}
      height={280}
      table={
        <ChartTable
          headers={["Line", "Amount"]}
          rows={[
            ...steps.map((s) => [s.name, signed(s.delta)]),
            ["Net surplus", formatINR(summary.netSurplus)],
            ["Monthly average income", formatINR(summary.monthlyAverages.income)],
            ["Monthly average expenses", formatINR(summary.monthlyAverages.expenses)],
            ["Monthly average savings", formatINR(summary.monthlyAverages.savings)],
          ]}
        />
      }
      footer={
        <p className="text-[11px] text-slate-500">
          Baseline savings rate {Math.round(summary.baselineSavingsRate)}% of regular income. Net surplus = income − expenses − savings.
        </p>
      }
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="short" {...axisProps} interval={0} />
        <YAxis {...inrAxisProps} />
        <ReferenceLine y={0} stroke={CHROME.axis} />
        <Tooltip
          {...inrTooltipProps}
          labelFormatter={(_l, payload) => String(payload?.[0]?.payload?.name ?? "")}
          formatter={(_v: unknown, _n: unknown, item: { payload?: { amount: number } }) => [signed(item.payload?.amount ?? 0), "Amount"]}
        />
        <Bar dataKey="range" radius={[4, 4, 4, 4]}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}
