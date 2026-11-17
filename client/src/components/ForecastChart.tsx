"use client";

import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarRange } from "lucide-react";
import ChartCard, { ChartTable, axisProps, inrAxisProps, inrTooltipProps, legendProps } from "./ChartCard";
import { formatINR } from "@/lib/budgetUtils";
import { CHROME, SERIES } from "@/lib/chartTheme.mjs";
import { formatShortDate } from "@/lib/recurrence.mjs";
import type { computeForecast } from "@/lib/forecast.mjs";
import type { MonthSummary } from "@/lib/reportsUtils";

type Kind = "actual" | "planned" | "estimated";
type Forecast = NonNullable<ReturnType<typeof computeForecast>>;

interface ForecastChartProps {
  /** Recent completed months, shown first as actuals for context. */
  actualMonths: MonthSummary[];
  /** Forecast for 6 cycles (or null when there is no income basis); the toggle shows 3 or all 6. */
  forecast: Forecast | null;
}

// Actual = solid, planned = slightly lighter, estimated = faded with a dashed outline.
const OPACITY: Record<Kind, number> = { actual: 1, planned: 0.75, estimated: 0.35 };
const SUFFIX: Record<Kind, string> = { actual: "", planned: "", estimated: " (est.)" };

/** Forward-looking cash position: actual recent months, then planned/estimated cycles ahead. */
export default function ForecastChart({ actualMonths, forecast }: ForecastChartProps) {
  const [cycles, setCycles] = useState<3 | 6>(3);

  const rows = [
    ...actualMonths.map((m) => ({
      label: m.monthLabel,
      kind: "actual" as Kind,
      income: m.regularIncome + m.variableIncome,
      incomeKind: "actual" as Kind,
      fixed: m.fixedExpenses,
      fixedKind: "actual" as Kind,
      flexible: m.flexibleExpenses,
      flexibleKind: "actual" as Kind,
      savings: m.savingsContributions,
      savingsKind: "actual" as Kind,
      surplus: m.netCashFlow,
      unconfirmedVariable: 0,
    })),
    ...(forecast ?? []).slice(0, cycles).map((c) => ({
      label: `from ${formatShortDate(c.cycleStart)}`,
      kind: c.surplus.kind as Kind,
      income: c.income.amount,
      incomeKind: c.income.kind as Kind,
      fixed: c.fixed.amount,
      fixedKind: c.fixed.kind as Kind,
      flexible: c.flexible.amount,
      flexibleKind: c.flexible.kind as Kind,
      savings: c.savings.amount,
      savingsKind: c.savings.kind as Kind,
      surplus: c.surplus.amount,
      unconfirmedVariable: c.unconfirmedVariable,
    })),
  ];
  const firstFuture = rows.find((r) => r.kind !== "actual")?.label;
  const unconfirmed = (forecast ?? []).slice(0, cycles).reduce((s, c) => s + c.unconfirmedVariable, 0);
  const tag = (amount: number, kind: Kind) => `${formatINR(amount)}${kind === "actual" ? "" : kind === "planned" ? " (planned)" : " (est.)"}`;

  const cells = (key: "incomeKind" | "fixedKind" | "flexibleKind" | "savingsKind", color: string) =>
    rows.map((r, i) => (
      <Cell
        key={i}
        fill={color}
        fillOpacity={OPACITY[r[key]]}
        stroke={r[key] === "estimated" ? color : undefined}
        strokeDasharray={r[key] === "estimated" ? "3 2" : undefined}
      />
    ));

  return (
    <ChartCard
      title="Cash Flow Forecast"
      question="Recent actual months, then the cycles ahead based on your plan, recurring items and limits."
      icon={<CalendarRange className="w-4 h-4" />}
      state={forecast ? "ready" : "empty"}
      emptyMessage="Not enough information to forecast yet. Save a budget plan, add a recurring salary, or record two months of regular income."
      height={300}
      actions={
        <div className="flex gap-1">
          {([3, 6] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCycles(n)}
              aria-pressed={cycles === n}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${cycles === n ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {n} cycles
            </button>
          ))}
        </div>
      }
      table={
        <ChartTable
          headers={["Period", "Income", "Fixed", "Flexible", "Savings", "Surplus"]}
          rows={rows.map((r) => [
            `${r.label}${r.kind === "actual" ? " (actual)" : ""}`,
            tag(r.income, r.incomeKind),
            tag(r.fixed, r.fixedKind),
            tag(r.flexible, r.flexibleKind),
            tag(r.savings, r.savingsKind),
            tag(r.surplus, r.kind),
          ])}
        />
      }
      footer={
        <p className="text-[11px] text-slate-500">
          Solid bars are actual months; lighter bars are planned; faded, dashed bars are estimated from recent averages.
          {unconfirmed > 0 && <> Expected variable income of {formatINR(unconfirmed)} is not counted until it is received.</>}
        </p>
      }
    >
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={CHROME.grid} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...inrAxisProps} />
        <Tooltip
          {...inrTooltipProps}
          formatter={(v: unknown, name: unknown, item: { dataKey?: unknown; payload?: Record<string, unknown> }) => {
            const key = `${String(item.dataKey)}Kind`;
            const kind = (item.payload?.[key] ?? item.payload?.kind ?? "actual") as Kind;
            return [`${formatINR(Number(v))}${SUFFIX[kind]}`, String(name)];
          }}
        />
        <Legend {...legendProps} />
        <ReferenceLine y={0} stroke={CHROME.axis} />
        {firstFuture && <ReferenceLine x={firstFuture} stroke={CHROME.muted} strokeDasharray="4 4" label={{ value: "Forecast →", fill: CHROME.muted, fontSize: 10, position: "insideTopLeft" }} />}
        <Bar dataKey="income" name="Income" stackId="in" fill={SERIES[0]}>{cells("incomeKind", SERIES[0])}</Bar>
        <Bar dataKey="fixed" name="Fixed" stackId="out" fill={SERIES[2]}>{cells("fixedKind", SERIES[2])}</Bar>
        <Bar dataKey="flexible" name="Flexible" stackId="out" fill={SERIES[3]}>{cells("flexibleKind", SERIES[3])}</Bar>
        <Bar dataKey="savings" name="Savings" stackId="out" fill={SERIES[4]}>{cells("savingsKind", SERIES[4])}</Bar>
        <Line dataKey="surplus" name="Surplus / deficit" type="linear" stroke={CHROME.ink} strokeWidth={2} dot={{ r: 4, fill: CHROME.ink }} />
      </ComposedChart>
    </ChartCard>
  );
}
