"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { PieChart } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrAxisProps, inrTooltipProps, legendProps } from "./ChartCard";
import { formatINR } from "@/lib/budgetUtils";
import { computeMonthlyCategoryBreakdown, type MonthSummary } from "@/lib/reportsUtils";
import { pctChange } from "@/lib/performance.mjs";
import { CHROME, SERIES } from "@/lib/chartTheme.mjs";

interface ExpenseDistributionChartProps {
  transactions: Array<{ category_id: string | null; amount: number; type: string; date: string }>;
  categories: Array<{ id: string; name: string; type: string; monthly_limit: number }>;
  /** Months offered in the picker (latest last). */
  months: MonthSummary[];
}

const previousMonthKey = (monthKey: string) => {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** Spending per category including an "Uncategorised" remainder, keyed by name. */
function breakdown(
  transactions: ExpenseDistributionChartProps["transactions"],
  categories: ExpenseDistributionChartProps["categories"],
  monthKey: string
) {
  const { items, totalSpent } = computeMonthlyCategoryBreakdown(transactions, categories, monthKey);
  const byName = new Map(items.map((i) => [i.categoryName, i.amount]));
  const uncategorised = totalSpent - items.reduce((s, i) => s + i.amount, 0);
  if (uncategorised > 0) byName.set("Uncategorised", uncategorised);
  return { byName, totalSpent };
}

/** E. Where does my money go this month, and how does it compare with last month? */
export default function ExpenseDistributionChart({ transactions, categories, months }: ExpenseDistributionChartProps) {
  const latest = months[months.length - 1]?.monthKey ?? "";
  const [picked, setPicked] = useState<string | null>(null);
  const monthKey = picked && months.some((m) => m.monthKey === picked) ? picked : latest;
  const prevKey = monthKey ? previousMonthKey(monthKey) : "";

  const { rows, totalSpent } = useMemo(() => {
    if (!monthKey) return { rows: [], totalSpent: 0 };
    const cur = breakdown(transactions, categories, monthKey);
    const prev = breakdown(transactions, categories, prevKey);
    const names = new Set([...cur.byName.keys(), ...prev.byName.keys()]);
    const list = [...names]
      .map((name) => {
        const current = cur.byName.get(name) ?? 0;
        const previous = prev.byName.get(name) ?? 0;
        return {
          name,
          current,
          previous,
          share: cur.totalSpent > 0 ? (current / cur.totalSpent) * 100 : 0,
          change: pctChange(current, previous),
        };
      })
      .sort((a, b) => b.current - a.current || b.previous - a.previous);
    return { rows: list, totalSpent: cur.totalSpent };
  }, [transactions, categories, monthKey, prevKey]);

  const label = (key: string) => {
    const known = months.find((m) => m.monthKey === key)?.monthLabel;
    if (known || !key) return known ?? key;
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  };
  const changeText = (c: number | null) => (c === null ? "new" : `${c > 0 ? "+" : ""}${Math.round(c)}%`);

  return (
    <ChartCard
      title="Expense Distribution"
      question={`Where the money went in ${label(monthKey)} (${formatINR(totalSpent)}), compared with the month before.`}
      icon={<PieChart className="w-4 h-4" />}
      state={rows.some((r) => r.current > 0) ? "ready" : "empty"}
      emptyMessage={`No expenses recorded for ${label(monthKey)}.`}
      height={Math.max(160, rows.length * 34 + 50)}
      actions={
        <select
          value={monthKey}
          onChange={(e) => setPicked(e.target.value)}
          aria-label="Month"
          className="text-xs border border-slate-200 rounded-xl px-2 py-1 bg-white text-slate-700"
        >
          {[...months].reverse().map((m) => (
            <option key={m.monthKey} value={m.monthKey}>{m.monthLabel}</option>
          ))}
        </select>
      }
      table={
        <ChartTable
          headers={["Category", "Spent", "Share", "Previous month", "Change"]}
          rows={rows.map((r) => [r.name, formatINR(r.current), `${Math.round(r.share)}%`, formatINR(r.previous), changeText(r.change)])}
        />
      }
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke={CHROME.grid} />
        <XAxis type="number" {...inrAxisProps} />
        <YAxis type="category" dataKey="name" {...axisProps} width={110} />
        <Tooltip
          {...inrTooltipProps}
          labelFormatter={(name, payload) => {
            const row = payload?.[0]?.payload as (typeof rows)[number] | undefined;
            return row ? `${name} · ${Math.round(row.share)}% of spending · ${changeText(row.change)} vs previous` : String(name);
          }}
        />
        <Legend {...legendProps} />
        <Bar dataKey="current" name={label(monthKey)} fill={SERIES[0]} radius={[0, 4, 4, 0]} />
        <Bar dataKey="previous" name={label(prevKey)} fill={SERIES[1]} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartCard>
  );
}
