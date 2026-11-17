"use client";

import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, AlertTriangle, CheckCircle2, ListChecks, TrendingUp } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrAxisProps, inrTooltipProps, legendProps } from "./ChartCard";
import { formatINR, type CategoryBudgetStatus } from "@/lib/budgetUtils";
import { CHROME, SERIES, STATUS } from "@/lib/chartTheme.mjs";

// computeCategoryBudgets statuses: warning >= 75%, danger >= 90%, exceeded = spent more than the limit.
const STATUS_LABEL: Record<CategoryBudgetStatus["status"], { label: string; icon: React.ReactNode }> = {
  safe: { label: "Within budget", icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> },
  warning: { label: "Approaching limit", icon: <TrendingUp className="w-3.5 h-3.5 text-amber-600" /> },
  danger: { label: "At risk of overspending", icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-600" /> },
  exceeded: { label: "Over budget", icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> },
};

interface BudgetVsActualChartProps {
  categoryBudgets: CategoryBudgetStatus[];
  /** Called with a category id to inspect its transactions. */
  onSelectCategory: (categoryId: string) => void;
}

/** B. Which categories are within budget, close to the limit, or over it this cycle? */
export default function BudgetVsActualChart({ categoryBudgets, onSelectCategory }: BudgetVsActualChartProps) {
  const limited = categoryBudgets
    .filter((c) => c.hasLimit)
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .map((c) => ({
      ...c,
      label: `${c.name} · ${Math.round(c.percentUsed)}%`,
      // Stacked so the bar length is the limit, plus any overspend sticking out past it.
      withinLimit: Math.min(c.spent, c.monthlyLimit),
      left: Math.max(0, c.monthlyLimit - c.spent),
      over: Math.max(0, c.spent - c.monthlyLimit),
    }));
  const unlimited = categoryBudgets.filter((c) => !c.hasLimit && c.spent > 0);

  const select = (entry: unknown) => {
    const id = (entry as { payload?: { id?: string }; id?: string })?.payload?.id ?? (entry as { id?: string })?.id;
    if (id) onSelectCategory(id);
  };

  return (
    <ChartCard
      title="Budget vs Actual"
      question="Spending against each category limit this cycle. Select a category to see its transactions."
      icon={<ListChecks className="w-4 h-4" />}
      state={limited.length ? "ready" : "empty"}
      emptyMessage="No category limits set yet. Add limits under Categories to compare spending with your budget."
      height={Math.max(140, limited.length * 36 + 50)}
      table={
        <ChartTable
          headers={["Category", "Budget", "Spent", "Remaining", "Used", "Status"]}
          rows={limited.map((c) => [
            <button key={c.id} type="button" onClick={() => onSelectCategory(c.id)} className="underline decoration-dotted text-left">
              {c.name}
            </button>,
            formatINR(c.monthlyLimit),
            formatINR(c.spent),
            formatINR(c.remaining),
            `${Math.round(c.percentUsed)}%`,
            <span key="s" className="inline-flex items-center gap-1 justify-end">
              {STATUS_LABEL[c.status].icon}
              {STATUS_LABEL[c.status].label}
            </span>,
          ])}
        />
      }
      footer={
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
            {Object.values(STATUS_LABEL).map((s) => (
              <span key={s.label} className="inline-flex items-center gap-1">{s.icon}{s.label}</span>
            ))}
          </div>
          {unlimited.length > 0 && (
            <div className="text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">No limit set:</span>{" "}
              {unlimited.map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <button type="button" onClick={() => onSelectCategory(c.id)} className="underline decoration-dotted">
                    {c.name}
                  </button>{" "}
                  ({formatINR(c.spent)})
                </span>
              ))}
            </div>
          )}
        </div>
      }
    >
      <BarChart data={limited} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={CHROME.grid} />
        <XAxis type="number" {...inrAxisProps} />
        <YAxis type="category" dataKey="label" {...axisProps} width={150} />
        <Tooltip
          {...inrTooltipProps}
          labelFormatter={(_l, payload) => {
            const c = payload?.[0]?.payload as (typeof limited)[number] | undefined;
            return c ? `${c.name}: ${formatINR(c.spent)} of ${formatINR(c.monthlyLimit)} · ${STATUS_LABEL[c.status].label}` : "";
          }}
        />
        <Legend {...legendProps} />
        <Bar dataKey="withinLimit" name="Spent" stackId="b" fill={SERIES[0]} cursor="pointer" onClick={select} />
        <Bar dataKey="left" name="Remaining" stackId="b" fill={CHROME.axis} cursor="pointer" onClick={select} />
        <Bar dataKey="over" name="Over limit" stackId="b" fill={STATUS.critical} cursor="pointer" onClick={select} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartCard>
  );
}
