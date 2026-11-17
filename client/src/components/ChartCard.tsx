"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { ResponsiveContainer } from "recharts";
import { AlertCircle, BarChart3, Loader2, Table2 } from "lucide-react";
import { formatINR } from "@/lib/budgetUtils";
import { CHROME, formatINRCompact } from "@/lib/chartTheme.mjs";

export type ChartState = "loading" | "error" | "empty" | "ready";

interface ChartCardProps {
  title: string;
  /** The financial question this chart answers, shown under the title. */
  question: string;
  icon?: ReactNode;
  state?: ChartState;
  errorMessage?: string;
  emptyMessage?: string;
  /** Controls shown at the top right (range toggles, filters). */
  actions?: ReactNode;
  /** Plot height in px; width follows the card. */
  height?: number;
  /** Accessible table view of the same numbers. Some series colours are below 3:1 contrast, so every chart ships one. */
  table?: ReactNode;
  /** Content shown under the plot (status badges, notes). */
  footer?: ReactNode;
  /** A single Recharts chart element, e.g. <BarChart>. */
  children: ReactElement;
}

export default function ChartCard({
  title,
  question,
  icon,
  state = "ready",
  errorMessage = "This chart could not be loaded.",
  emptyMessage = "Not enough data yet.",
  actions,
  height = 260,
  table,
  footer,
  children,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
            {icon ?? <BarChart3 className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
            <p className="text-[11px] text-slate-500">{question}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {actions}
          {table && state === "ready" && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              aria-pressed={showTable}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Table2 className="w-3.5 h-3.5" />
              {showTable ? "Chart" : "Table"}
            </button>
          )}
        </div>
      </div>

      {state === "loading" && (
        <div style={{ height }} className="flex items-center justify-center text-slate-400 text-xs gap-2" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {state === "error" && (
        <div style={{ height }} className="flex items-center justify-center text-red-600 text-xs gap-2 text-center px-4" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" /> {errorMessage}
        </div>
      )}
      {state === "empty" && (
        <div style={{ height }} className="flex items-center justify-center text-slate-500 text-xs text-center px-4 rounded-2xl border border-dashed border-slate-200">
          {emptyMessage}
        </div>
      )}
      {state === "ready" &&
        (showTable && table ? (
          <div className="overflow-x-auto text-xs">{table}</div>
        ) : (
          <div style={{ height }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              {children}
            </ResponsiveContainer>
          </div>
        ))}

      {state === "ready" && footer}
    </section>
  );
}

/** Plain table for a chart's Table view. First column is left-aligned, the rest right-aligned. */
export function ChartTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-left">
      <thead>
        <tr className="text-slate-500 border-b border-slate-200">
          {headers.map((h, i) => (
            <th key={h} className={`py-1.5 px-2 font-semibold ${i ? "text-right" : ""}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="border-b border-slate-100 text-slate-700">
            {row.map((cell, i) => (
              <td key={i} className={`py-1.5 px-2 ${i ? "text-right tabular-nums" : "font-medium"}`}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shared tooltip styling + INR values. Spread onto <Tooltip {...inrTooltipProps} />. */
export const inrTooltipProps = {
  formatter: (value: unknown) => formatINR(Number(value)),
  contentStyle: {
    background: CHROME.surface,
    border: `1px solid ${CHROME.axis}`,
    borderRadius: 12,
    fontSize: 12,
    color: CHROME.ink,
  },
  labelStyle: { color: CHROME.ink, fontWeight: 600 },
  itemStyle: { color: CHROME.ink },
  cursor: { fill: CHROME.grid, opacity: 0.5 },
};

/** Shared axis styling. Spread onto <XAxis {...axisProps} /> / <YAxis {...axisProps} />. */
export const axisProps = {
  stroke: CHROME.axis,
  tick: { fill: CHROME.muted, fontSize: 11 },
  tickLine: false,
};

/** Y/X axis showing paise as compact INR (₹12.5k, ₹1.2L). */
export const inrAxisProps = { ...axisProps, tickFormatter: (v: number) => formatINRCompact(v), width: 56 };

/** Shared legend styling. Labels use text ink, not the series colour (light series fail text contrast). */
export const legendProps = {
  wrapperStyle: { fontSize: 11 },
  formatter: (value: unknown) => <span style={{ color: CHROME.muted }}>{String(value)}</span>,
};
