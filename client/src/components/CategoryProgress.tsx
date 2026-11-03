"use client";

import { CategoryBudgetStatus, formatINR } from "@/lib/budgetUtils";
import { AlertTriangle, CheckCircle2, ShieldAlert, TrendingUp, Layers } from "lucide-react";

interface CategoryProgressProps {
  categoryBudgets: CategoryBudgetStatus[];
  type: "fixed" | "flexible";
}

const statusColors = {
  safe: { bar: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  warning: { bar: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
  danger: { bar: "bg-orange-500", bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200" },
  exceeded: { bar: "bg-rose-500", bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200" },
};

const statusIcons = {
  safe: <CheckCircle2 className="w-3 h-3" />,
  warning: <AlertTriangle className="w-3 h-3" />,
  danger: <ShieldAlert className="w-3 h-3" />,
  exceeded: <ShieldAlert className="w-3 h-3" />,
};

const statusLabels = {
  safe: "On Track",
  warning: "75%+ Used",
  danger: "90%+ Used",
  exceeded: "Over Budget",
};

export default function CategoryProgress({ categoryBudgets, type }: CategoryProgressProps) {
  const items = categoryBudgets.filter((c) => c.type === type);

  if (items.length === 0) return null;

  const totalBudget = items.reduce((s, c) => s + c.monthlyLimit, 0);
  const totalSpent = items.reduce((s, c) => s + c.spent, 0);
  const totalPercent = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;

  const isFixed = type === "fixed";
  const Icon = isFixed ? Layers : TrendingUp;
  const label = isFixed ? "Fixed Obligations" : "Flexible Spending";
  const accentColor = isFixed ? "emerald" : "blue";

  // Count alerts
  const alertCount = items.filter((c) => c.status === "danger" || c.status === "exceeded").length;
  const warningCount = items.filter((c) => c.status === "warning").length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Section Header with aggregate progress */}
      <div className="p-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 text-${accentColor}-600`} />
            <h3 className="font-bold text-slate-900 text-sm">{label}</h3>
          </div>
          <div className="flex items-center gap-2">
            {alertCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold">
                {alertCount} over
              </span>
            )}
            {warningCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                {warningCount} warning
              </span>
            )}
            <span className="text-xs text-slate-500 font-medium">{items.length} categories</span>
          </div>
        </div>

        {/* Aggregate bar */}
        <div className="flex items-center gap-3 mb-1">
          <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                totalPercent >= 100 ? "bg-rose-500" : totalPercent >= 80 ? "bg-amber-500" : `bg-${accentColor}-500`
              }`}
              style={{ width: `${Math.min(totalPercent, 100)}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-700 tabular-nums w-10 text-right">
            {Math.round(totalPercent)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Spent: <strong className="text-slate-700">{formatINR(totalSpent)}</strong></span>
          <span>Budget: <strong className="text-slate-700">{formatINR(totalBudget)}</strong></span>
        </div>
      </div>

      {/* Per-category rows */}
      <div className="border-t border-slate-100 divide-y divide-slate-50">
        {items.map((cat) => {
          const colors = statusColors[cat.status];
          const clampedPercent = Math.min(cat.percentUsed, 100);

          return (
            <div
              key={cat.id}
              className={`px-5 py-3 flex flex-col gap-1.5 transition-colors ${
                cat.status === "exceeded" ? "bg-rose-50/40" : ""
              }`}
            >
              {/* Category name + status badge + amounts */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-800">{cat.name}</span>
                  {cat.status !== "safe" && (
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${colors.bg} ${colors.text} ${colors.border} border`}
                    >
                      {statusIcons[cat.status]}
                      {statusLabels[cat.status]}
                    </span>
                  )}
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-800 tabular-nums">
                    {formatINR(cat.spent)}
                  </span>
                  <span className="text-[11px] text-slate-400"> / {formatINR(cat.monthlyLimit)}</span>
                </div>
              </div>

              {/* Progress bar */}
              {cat.monthlyLimit > 0 && (
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${colors.bar}`}
                    style={{ width: `${clampedPercent}%` }}
                  />
                </div>
              )}

              {/* Remaining or overspent */}
              <div className="text-[11px] text-slate-500">
                {cat.remaining >= 0 ? (
                  <span>{formatINR(cat.remaining)} remaining</span>
                ) : (
                  <span className="text-rose-600 font-semibold">
                    {formatINR(Math.abs(cat.remaining))} over budget
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

