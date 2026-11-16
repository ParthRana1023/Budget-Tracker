"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrAxisProps, inrTooltipProps, legendProps } from "./ChartCard";
import { formatINR } from "@/lib/budgetUtils";
import { CHROME, SERIES } from "@/lib/chartTheme.mjs";
import type { MonthSummary } from "@/lib/reportsUtils";

/** A. Where did each month's money go, and was there a surplus? Variable pay is its own segment. */
export default function CashFlowChart({ months }: { months: MonthSummary[] }) {
  const hasData = months.some((m) => m.totalIncome + m.totalExpenses + m.savingsContributions > 0);

  return (
    <ChartCard
      title="Monthly Cash Flow"
      question="Money in (regular and variable kept apart) vs money out, and the surplus or deficit left each month."
      icon={<ArrowLeftRight className="w-4 h-4" />}
      state={hasData ? "ready" : "empty"}
      emptyMessage="Record income or expenses to see your monthly cash flow."
      height={300}
      table={
        <ChartTable
          headers={["Month", "Regular", "Variable", "Fixed", "Flexible", "Savings", "Surplus"]}
          rows={months.map((m) => [
            m.monthLabel,
            formatINR(m.regularIncome),
            formatINR(m.variableIncome),
            formatINR(m.fixedExpenses),
            formatINR(m.flexibleExpenses),
            formatINR(m.savingsContributions),
            formatINR(m.netCashFlow),
          ])}
        />
      }
    >
      <ComposedChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="monthLabel" {...axisProps} />
        <YAxis {...inrAxisProps} />
        <Tooltip {...inrTooltipProps} />
        <Legend {...legendProps} />
        <ReferenceLine y={0} stroke={CHROME.axis} />
        <Bar dataKey="regularIncome" name="Regular income" stackId="in" fill={SERIES[0]} stroke={CHROME.surface} />
        <Bar dataKey="variableIncome" name="Variable income" stackId="in" fill={SERIES[1]} stroke={CHROME.surface} radius={[4, 4, 0, 0]} />
        <Bar dataKey="fixedExpenses" name="Fixed expenses" stackId="out" fill={SERIES[2]} stroke={CHROME.surface} />
        <Bar dataKey="flexibleExpenses" name="Flexible expenses" stackId="out" fill={SERIES[3]} stroke={CHROME.surface} />
        <Bar dataKey="savingsContributions" name="Savings" stackId="out" fill={SERIES[4]} stroke={CHROME.surface} radius={[4, 4, 0, 0]} />
        <Line dataKey="netCashFlow" name="Surplus / deficit" type="linear" stroke={CHROME.ink} strokeWidth={2} dot={{ r: 4, fill: CHROME.ink }} />
      </ComposedChart>
    </ChartCard>
  );
}
