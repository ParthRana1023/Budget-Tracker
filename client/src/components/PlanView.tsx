"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Database, FlaskConical, Loader2, RotateCcw, Save, Upload } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { formatINR, getPeriodRange, type CategoryBudgetStatus, type PeriodRange } from "@/lib/budgetUtils";
import { computeMonthlyTrends } from "@/lib/reportsUtils";
import { buildPlanScenario, compareBudgets } from "@/lib/budgetSimulator.mjs";
import { computeForecast } from "@/lib/forecast.mjs";
import type { BudgetPlanRow } from "@/lib/budgetPlans";
import ForecastChart from "./ForecastChart";

interface PlanViewProps {
  categories: Array<{ id: string; name: string; type: string; monthly_limit: number }>;
  recurringItems: any[];
  incomeSources: any[];
  transactions: any[];
  contributions: any[];
  monthStartDay: number;
  /** Current cycle, for "actual so far" reference values. */
  period: PeriodRange;
  categoryBudgets: CategoryBudgetStatus[];
  actualIncomeThisCycle: number;
  recurringFixedTotal: number;
  plans: BudgetPlanRow[];
  plansAvailable: boolean;
  onChanged: () => Promise<void>;
}

type Scenario = ReturnType<typeof buildPlanScenario>;

const toPaise = (rupees: string) => {
  const n = Number(rupees);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

/** Rupee number input plus an optional slider. Values are paise. */
function MoneyInput({ label, value, onChange, max, changed }: { label: string; value: number; onChange: (paise: number) => void; max?: number; changed?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {max !== undefined && (
        <input
          type="range"
          min={0}
          max={max}
          step={10000}
          value={Math.min(value, max)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${label} slider`}
          className="flex-1 min-w-0 accent-emerald-600"
        />
      )}
      <div className="relative shrink-0">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">₹</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={100}
          value={Math.round(value / 100)}
          onChange={(e) => onChange(toPaise(e.target.value))}
          aria-label={label}
          className={`w-28 pl-5 pr-2 py-1.5 text-xs text-right rounded-xl border bg-white text-slate-900 ${changed ? "border-amber-400" : "border-slate-200"}`}
        />
      </div>
    </div>
  );
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatINR(Math.abs(v))}`;

/**
 * Budget Planner + What-if Simulator for the next cycle. Every edit is a simulation shown
 * against the original until the user confirms Save; Apply copies limits to live categories
 * only after a second confirmation. Nothing here writes transactions or income.
 */
function Planner({
  base,
  props,
  nextPeriod,
  savedPlan,
}: {
  base: Scenario;
  props: PlanViewProps;
  nextPeriod: PeriodRange;
  savedPlan: BudgetPlanRow | null;
}) {
  const [draft, setDraft] = useState<Scenario>(base);
  const [confirming, setConfirming] = useState<"save" | "apply" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cmp = useMemo(() => compareBudgets(base, draft), [base, draft]);
  const dirty =
    cmp.changedCategories.length > 0 ||
    draft.regularIncome !== base.regularIncome ||
    draft.plannedSavings !== base.plannedSavings ||
    draft.expectedVariableIncome !== base.expectedVariableIncome;

  const actualById = new Map(props.categoryBudgets.map((c) => [c.id, c]));
  const liveById = new Map(props.categories.map((c) => [c.id, Number(c.monthly_limit)]));
  const applyChanges = savedPlan
    ? draft.categories.filter((c) => (liveById.get(c.id) ?? 0) !== c.amount).map((c) => ({ ...c, live: liveById.get(c.id) ?? 0 }))
    : [];

  const setCategory = (id: string, amount: number) =>
    setDraft((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, amount } : c)) }));

  const run = async (action: "save" | "apply") => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } =
      action === "save"
        ? await supabase.rpc("save_budget_plan", {
            p_cycle_start: nextPeriod.startStr,
            p_expected_regular_income: draft.regularIncome,
            p_expected_variable_income: draft.expectedVariableIncome,
            p_planned_savings: draft.plannedSavings,
            p_limits: draft.categories.map((c) => ({ category_id: c.id, planned_limit: c.amount })),
          })
        : await supabase.rpc("apply_budget_plan", { p_plan_id: savedPlan!.id });
    setBusy(false);
    setConfirming(null);
    if (rpcError) {
      setError(`Could not ${action === "save" ? "save the plan" : "apply the limits"}: ${rpcError.message}`);
      return;
    }
    setNotice(action === "save" ? "Plan saved. Your current budget and records were not changed." : "Category limits updated from the plan.");
    await props.onChanged();
  };

  const metricRows: Array<[string, number | null, number | null, "money" | "pct"]> = [
    ["Expected regular income", cmp.base.regularIncome, cmp.proposed.regularIncome, "money"],
    ["Fixed obligations", cmp.base.fixed, cmp.proposed.fixed, "money"],
    ["Flexible spending limits", cmp.base.flexible, cmp.proposed.flexible, "money"],
    ["Total planned spending", cmp.base.totalSpending, cmp.proposed.totalSpending, "money"],
    ["Remaining after spending", cmp.base.remainingAfterSpending, cmp.proposed.remainingAfterSpending, "money"],
    ["Planned savings", cmp.base.plannedSavings, cmp.proposed.plannedSavings, "money"],
    ["Projected surplus", cmp.base.projectedSurplus, cmp.proposed.projectedSurplus, "money"],
    ["Savings rate", cmp.base.savingsRate, cmp.proposed.savingsRate, "pct"],
    // Safe-to-spend per day at cycle start (same formula as the dashboard): income − savings − fixed.
    ["Daily spending allowance", cmp.base.dailyAllowance, cmp.proposed.dailyAllowance, "money"],
    ["Planned flexible per day", cmp.base.plannedFlexiblePerDay, cmp.proposed.plannedFlexiblePerDay, "money"],
  ];
  const fmt = (v: number | null, kind: "money" | "pct") => (v === null ? "—" : kind === "pct" ? `${Math.round(v)}%` : formatINR(v));
  const fmtDelta = (a: number | null, b: number | null, kind: "money" | "pct") =>
    a === null || b === null || a === b ? "—" : kind === "pct" ? `${b - a > 0 ? "+" : ""}${Math.round(b - a)} pts` : signed(b - a);

  const groups: Array<["fixed" | "flexible", string]> = [["fixed", "Fixed obligations"], ["flexible", "Flexible spending limits"]];

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Budget Planner — next cycle</h3>
              <p className="text-[11px] text-slate-500">
                {nextPeriod.periodLabel}. Starting from {base.source === "plan" ? "your saved plan" : "your current limits"}.
              </p>
            </div>
          </div>
          <span className="self-start sm:self-auto px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-semibold">
            Planned amounts — not actual transactions
          </span>
        </div>

        {/* Income & savings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <label className="space-y-1.5">
            <span className="font-semibold text-slate-700 block">Expected regular income</span>
            <MoneyInput label="Expected regular income" value={draft.regularIncome} changed={draft.regularIncome !== base.regularIncome} onChange={(v) => setDraft((d) => ({ ...d, regularIncome: v }))} />
            <span className="text-[11px] text-slate-500 block">Actual received this cycle: {formatINR(props.actualIncomeThisCycle)}</span>
          </label>
          <label className="space-y-1.5">
            <span className="font-semibold text-slate-700 block">Expected variable income</span>
            <MoneyInput label="Expected variable income" value={draft.expectedVariableIncome} changed={draft.expectedVariableIncome !== base.expectedVariableIncome} onChange={(v) => setDraft((d) => ({ ...d, expectedVariableIncome: v }))} />
            <span className="text-[11px] text-slate-500 block">Kept apart: not counted until it is received.</span>
          </label>
          <label className="space-y-1.5">
            <span className="font-semibold text-slate-700 block">Planned savings</span>
            <MoneyInput label="Planned savings" value={draft.plannedSavings} changed={draft.plannedSavings !== base.plannedSavings} onChange={(v) => setDraft((d) => ({ ...d, plannedSavings: v }))} />
            <span className="text-[11px] text-slate-500 block">Set aside first, before flexible spending.</span>
          </label>
        </div>

        {/* Category limits */}
        {groups.map(([type, title]) => {
          const rows = draft.categories.filter((c) => c.type === type);
          if (!rows.length) return null;
          return (
            <div key={type} className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <h4 className="font-bold text-slate-800">{title}</h4>
                {type === "fixed" && props.recurringFixedTotal > 0 && (
                  <span className="text-[11px] text-slate-500">Known recurring fixed payments: {formatINR(props.recurringFixedTotal)}</span>
                )}
              </div>
              <ul className="space-y-2">
                {rows.map((c) => {
                  const original = base.categories.find((b) => b.id === c.id)?.amount ?? 0;
                  const actual = actualById.get(c.id);
                  return (
                    <li key={c.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2 items-center p-3 rounded-2xl bg-slate-50 border border-slate-100">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">{c.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Actual this cycle: {formatINR(actual?.spent ?? 0)}
                          {actual?.hasLimit ? ` of ${formatINR(actual.monthlyLimit)}` : " (no limit)"}
                          {c.amount !== original && <> · <span className="text-amber-700 font-semibold">{signed(c.amount - original)} vs original</span></>}
                        </div>
                      </div>
                      <MoneyInput
                        label={`${c.name} planned limit`}
                        value={c.amount}
                        changed={c.amount !== original}
                        max={Math.max(original * 2, c.amount, (actual?.spent ?? 0) * 2, 500000)}
                        onChange={(v) => setCategory(c.id, v)}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      {/* What-if comparison */}
      <section className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <FlaskConical className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">What-if Simulator</h3>
              <p className="text-[11px] text-slate-500">Change any amount above to see the effect. Nothing is saved until you confirm.</p>
            </div>
          </div>
          {dirty && (
            <span className="self-start sm:self-auto px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-800 text-[11px] font-semibold">
              Simulated — not saved
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-200">
                <th className="py-1.5 px-2 text-left font-semibold">Metric</th>
                <th className="py-1.5 px-2 text-right font-semibold">Original</th>
                <th className="py-1.5 px-2 text-right font-semibold">{dirty ? "Proposed (simulated)" : "Proposed"}</th>
                <th className="py-1.5 px-2 text-right font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {metricRows.map(([label, a, b, kind]) => (
                <tr key={label} className="border-b border-slate-100 text-slate-700">
                  <td className="py-1.5 px-2 font-medium">{label}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmt(a, kind)}</td>
                  <td className={`py-1.5 px-2 text-right tabular-nums ${a !== b ? "font-bold text-slate-900" : ""}`}>{fmt(b, kind)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtDelta(a, b, kind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {cmp.proposed.projectedSurplus < 0 && (
          <p className="flex items-center gap-1.5 text-[11px] text-rose-700">
            <AlertTriangle className="w-3.5 h-3.5" /> This plan spends and saves {formatINR(-cmp.proposed.projectedSurplus)} more than the expected regular income.
          </p>
        )}
        {error && <p className="text-[11px] text-rose-700" role="alert">{error}</p>}
        {notice && !dirty && <p className="text-[11px] text-emerald-700" role="status">{notice}</p>}

        {confirming ? (
          <div className="p-3.5 rounded-2xl border border-amber-300 bg-amber-50 space-y-2 text-xs" role="alertdialog" aria-label="Confirm">
            {confirming === "save" ? (
              <p className="text-slate-800">
                Save this as your plan for <strong>{nextPeriod.periodLabel}</strong>? Your current budget, transactions and income stay as they are.
              </p>
            ) : (
              <div className="text-slate-800 space-y-1">
                <p>Replace these live category limits with the plan&apos;s limits now? This changes your current budget.</p>
                <ul className="list-disc pl-5">
                  {applyChanges.map((c) => (
                    <li key={c.id}>{c.name}: {formatINR(c.live)} → {formatINR(c.amount)}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => run(confirming)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-60">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Confirm
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-semibold">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" disabled={!dirty} onClick={() => { setDraft(base); setNotice(null); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-semibold disabled:opacity-50">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
            <button
              type="button"
              disabled={!props.plansAvailable || (!dirty && base.source === "plan")}
              onClick={() => { setNotice(null); setConfirming("save"); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-semibold disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Save plan
            </button>
            {savedPlan && !dirty && applyChanges.length > 0 && (
              <button type="button" onClick={() => { setNotice(null); setConfirming("apply"); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 text-slate-700 font-semibold">
                <Upload className="w-3.5 h-3.5" /> Apply limits to my categories now
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default function PlanView(props: PlanViewProps) {
  const { categories, recurringItems, incomeSources, transactions, contributions, monthStartDay, period, plans } = props;

  const nextPeriod = useMemo(() => {
    const end = period.endDate;
    return getPeriodRange(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, 12), monthStartDay);
  }, [period, monthStartDay]);
  const savedPlan = plans.find((p) => p.cycle_start === nextPeriod.startStr) ?? null;

  const history = useMemo(() => {
    const now = new Date();
    return computeMonthlyTrends(transactions, incomeSources, contributions, 6, new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }, [transactions, incomeSources, contributions]);

  const base = useMemo(() => {
    const expectedVariableInCycle = incomeSources
      .filter((s) => s.type === "variable" && s.status === "expected" && s.expected_date >= nextPeriod.startStr && s.expected_date <= nextPeriod.endStr)
      .reduce((sum, s) => sum + Number(s.amount), 0);
    return buildPlanScenario({ plan: savedPlan, categories, recurringItems, history, expectedVariableInCycle, totalDays: nextPeriod.totalDays });
  }, [savedPlan, categories, recurringItems, history, incomeSources, nextPeriod]);

  const forecast = useMemo(
    () => computeForecast({ cycles: 6, monthStartDay, categories, recurringItems, incomeSources, history, plans }),
    [monthStartDay, categories, recurringItems, incomeSources, history, plans]
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {!props.plansAvailable && (
        <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50 text-xs text-amber-900 flex gap-2">
          <Database className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            Saving plans needs a one-time database update. Run <code className="break-all">supabase/migrations/20261117000000_budget_plans.sql</code> in the
            Supabase SQL Editor. Until then you can still simulate changes; they just cannot be saved.
          </p>
        </div>
      )}

      {/* Re-mount when the starting point changes (e.g. after saving) so the draft resets to it. */}
      <Planner key={JSON.stringify(base)} base={base} props={props} nextPeriod={nextPeriod} savedPlan={savedPlan} />

      <ForecastChart actualMonths={history.slice(-2)} forecast={forecast} />
    </div>
  );
}
