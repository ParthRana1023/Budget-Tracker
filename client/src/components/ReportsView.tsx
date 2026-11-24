"use client";

// Reports (design handoff, Reports): Overview, Spending habits, Categories, Plan ahead.
// Most figures open a side panel listing the entries behind them.

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatExact, inr } from "@/lib/money.mjs";
import { addDaysStr, dayLabel, shortDate } from "@/lib/cycle.mjs";
import { cycleFor, paySchedule } from "@/lib/periods.mjs";
import { planFor } from "@/lib/plan.mjs";
import {
  cycleHistory,
  flexByDay,
  forecastNext,
  reportSchedule,
  suggestLimits,
  topPayees,
  weekdayAverages,
  type Grouping,
} from "@/lib/reports.mjs";
import { spendByMethod } from "@/lib/paymentMethods.mjs";
import { Info } from "lucide-react";
import Drawer from "./ui/Drawer";
import { useToast } from "./ui/Toast";
import { CARD_H2, type Category, type RecurringItem, type Settings, type Tx } from "./dashboard/types";

/** Spend by payment method colours (design handoff v3): Not set is striped and always last. */
const METHOD_COLOR: Record<string, string> = {
  upi: "var(--lime)",
  debit_card: "var(--flex)",
  credit_card: "var(--ink-2)",
  cash: "var(--fixed)",
  other: "var(--muted)",
  none: "repeating-linear-gradient(135deg, var(--line-2) 0 3px, transparent 3px 6px)",
};

type Cycle = ReturnType<typeof cycleHistory>[number];
type Tab = "overview" | "habits" | "categories" | "plan";
type DrillRow = { a: string; b: string; amt: number };

const TABS: Array<[Tab, string]> = [
  ["overview", "Overview"],
  ["habits", "Spending habits"],
  ["categories", "Categories"],
  ["plan", "Plan ahead"],
];
const EMPTY: Record<Tab, [string, string]> = {
  overview: [
    "Your first report arrives after a few entries.",
    "Log what you spend for a week or two. Month-over-month charts and your savings rate need one full cycle.",
  ],
  habits: [
    "Patterns need a few weeks of entries.",
    "The pace chart, calendar and weekday averages fill in as you log flexible spending.",
  ],
  categories: [
    "No month to compare yet.",
    "Once a cycle closes, each category is checked against its limit and your average.",
  ],
  plan: [
    "Forecasts start after your first cycle.",
    "Next month’s forecast and suggested limits are built from what you actually spent.",
  ],
};
const CARD = "min-w-0 flex flex-col gap-4 rounded-[18px] border border-line bg-tile p-[clamp(20px,4vw,26px)]";
const SUB = "text-[13px] text-muted";
const ROW_BTN =
  "flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1.5 border-0 border-b border-line bg-transparent py-2.5 text-left";
const ROMAN = ["i", "ii", "iii", "iv"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Head({ title, sub, children }: { title: ReactNode; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line-2 pb-2.5">
      <div className="flex flex-col gap-1">
        <h2 className={CARD_H2}>{title}</h2>
        {sub && <span className={SUB}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}
const Key = ({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) => (
  <span className="flex items-center gap-1.5 text-xs text-muted">
    <span
      className="h-2 w-2 rounded-full"
      style={dashed ? { border: `1.5px dashed ${color}` } : { background: color }}
    />
    {label}
  </span>
);
function Stats({ items }: { items: Array<{ label: string; value: string; note: string; color: string }> }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3 border-t border-line pt-3.5">
      {items.map((s) => (
        <div key={s.label} className="flex flex-col gap-0.5">
          <span className={SUB}>{s.label}</span>
          <span className="tabular font-serif text-[28px] leading-none">{s.value}</span>
          <span className="text-[13px] font-semibold" style={{ color: s.color }}>
            {s.note}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ReportsView({
  transactions,
  categories,
  settings,
  recurringItems,
  today,
  onChanged,
  grouping = "cycle",
}: {
  transactions: Tx[];
  categories: Category[];
  settings: Settings | null;
  recurringItems: RecurringItem[];
  today: string;
  onChanged: () => Promise<unknown>;
  /** Group every tab by pay-day cycle or by calendar month (no toggle yet: designed later). */
  grouping?: Grouping;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState(6);
  const [calPrev, setCalPrev] = useState(false);
  const [drill, setDrill] = useState<{ title: string; sub: string; rows: DrillRow[] } | null>(null);
  const [decided, setDecided] = useState<Record<string, "kept" | { from: number; to: number }>>({});
  const schedule = useMemo(() => paySchedule(settings), [settings]);

  const active = categories.filter((c) => c.is_active !== false);
  const flex = active.filter((c) => c.type === "flexible"),
    fixed = active.filter((c) => c.type === "fixed");
  const byId = new Map(categories.map((c) => [c.id, c]));
  const hist = useMemo(
    () => cycleHistory({ transactions, categories, schedule, today, count: 12, grouping }),
    [transactions, categories, schedule, today, grouping],
  );
  const cur = hist[hist.length - 1],
    prev: Cycle | undefined = hist[hist.length - 2];
  const done = hist.filter((c) => !c.partial && c.entries.length > 0);
  const shown = hist.slice(-range);
  const DAY = cur.period.daysElapsed,
    N = cur.period.totalDays;
  const budget = flex.reduce((s, c) => s + Number(c.monthly_limit), 0);
  const fixedTotal = fixed.reduce((s, c) => s + Number(c.monthly_limit), 0);
  // The plan in force for the current period (salary and save-first % can change per cycle).
  const curPlan = planFor(settings, cur.period.startStr);
  const target = Number(curPlan.savings_pct ?? 0);
  const prevName = prev?.labelLong ?? "Last month";

  const catName = (t: Tx) => byId.get(t.category_id ?? "")?.name;
  const rowsOf = (list: Tx[]): DrillRow[] =>
    [...list]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((t) => ({
        a: t.note || t.payee || catName(t) || "Entry",
        b: `${shortDate(t.date)} · ${catName(t) ?? (t.type === "income" ? "Income" : "Savings")}${
          t.original_currency ? ` · ${formatExact(Number(t.original_amount), t.original_currency)}` : ""
        }`,
        amt: Number(t.amount),
      }));
  const flexEntries = (cy: Cycle, filter: (t: Tx) => boolean = () => true) =>
    (cy.entries as Tx[]).filter(
      (t) => t.type === "expense" && !t.from_reserve && byId.get(t.category_id ?? "")?.type !== "fixed" && filter(t),
    );
  const open = (title: string, sub: string, rows: DrillRow[]) => setDrill({ title, sub, rows });
  const empty = tab === "habits" ? cur.flex + (prev?.flex ?? 0) === 0 : done.length === 0;

  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([k]) => k === tab);
    const next = ({ ArrowRight: (i + 1) % 4, ArrowLeft: (i + 3) % 4, Home: 0, End: 3 } as Record<string, number>)[
      e.key
    ];
    if (next === undefined) return;
    e.preventDefault();
    setTab(TABS[next][0]);
    document.getElementById(`rtab-${TABS[next][0]}`)?.focus();
  };

  // ------------------------------------------------------------------ Overview
  const overview = () => {
    const soFar = cur.flex,
      last3 = done.slice(-3);
    const avgSame = last3.length ? last3.reduce((s, c) => s + flexByDay(c, DAY), 0) / last3.length : 0;
    const prevSame = prev ? flexByDay(prev, DAY) : 0;
    const delta = (v: number) =>
      soFar <= v
        ? { note: `${inr(v - soFar)} less now`, color: "var(--lime-text)" }
        : { note: `${inr(soFar - v)} more now`, color: "var(--warn)" };
    const rated = shown.filter((c) => !c.partial && c.rate !== null);
    const avgRate = rated.length ? rated.reduce((s, c) => s + c.rate!, 0) / rated.length : 0;
    const months = Math.min(range, done.length);
    const worst = flex
      .filter((c) => Number(c.monthly_limit) > 0)
      .map((c) => ({
        c,
        n: done.slice(-range).filter((cy) => (cy.byCat.get(c.id) ?? 0) > Number(c.monthly_limit)).length,
      }))
      .sort((a, b) => b.n - a.n)[0];
    const weekendOf = (cy: Cycle) =>
      cy.daily.reduce(
        (s, v, i) => s + ([0, 6].includes(new Date(`${addDaysStr(cy.period.startStr, i)}T12:00:00`).getDay()) ? v : 0),
        0,
      );
    const insights = [
      soFar <= prevSame
        ? {
            text: `You’ve spent ${inr(prevSame - soFar)} less on flexible items than at this point in ${prevName}.`,
            color: "var(--lime-text)",
            go: () => setTab("habits"),
          }
        : {
            text: `You’ve spent ${inr(soFar - prevSame)} more on flexible items than at this point in ${prevName}.`,
            color: "var(--warn)",
            go: () => setTab("habits"),
          },
      worst && worst.n > 0
        ? {
            text: `${worst.c.name} went over its ${inr(Number(worst.c.monthly_limit))} limit in ${worst.n} of the last ${months} months.`,
            color: "var(--warn)",
            go: () => setTab("categories"),
          }
        : {
            text: `Every limit held across the last ${months} months.`,
            color: "var(--lime-text)",
            go: () => setTab("categories"),
          },
      prev && prev.flex > 0
        ? {
            text: `Weekends made up ${Math.round((weekendOf(prev) / prev.flex) * 100)}% of ${prevName}’s flexible spending.`,
            color: "var(--ink-2)",
            go: () => setTab("habits"),
          }
        : null,
      rated.length && target
        ? Math.round(avgRate) >= target
          ? {
              text: `Your savings rate averaged ${Math.round(avgRate)}%, ${Math.round(avgRate) === target ? "right on" : "above"} your ${target}% target.`,
              color: "var(--lime-text)",
              go: () => setTab("plan"),
            }
          : {
              text: `Your savings rate averaged ${Math.round(avgRate)}%, ${target - Math.round(avgRate)} points under your ${target}% target.`,
              color: "var(--warn)",
              go: () => setTab("plan"),
            }
        : null,
    ].filter((x): x is { text: string; color: string; go: () => void } => !!x);
    const top = Math.max(1, ...shown.map((c) => Math.max(c.income, c.fixed + c.flex + c.saved + c.extraSaved)));
    const year = hist.filter((c) => c.entries.length);
    const sum = (f: (c: Cycle) => number) => year.reduce((s, c) => s + f(c), 0);
    const yIncome = sum((c) => c.income),
      ySaved = sum((c) => c.saved + c.extraSaved),
      yFixed = sum((c) => c.fixed),
      yFlex = sum((c) => c.flex);
    const fixShare = curPlan.take_home_pay
      ? (fixedTotal / Number(curPlan.take_home_pay)) * 100
      : yIncome
        ? (yFixed / yIncome) * 100
        : 0;
    const dist = flex
      .map((c) => ({ c, v: shown.reduce((s, cy) => s + (cy.byCat.get(c.id) ?? 0), 0) }))
      .filter((d) => d.v > 0)
      .sort((a, b) => b.v - a.v);
    const distTotal = dist.reduce((s, d) => s + d.v, 0);
    const palette = ["var(--lime)", "var(--flex)", "var(--warn)", "var(--fixed)", "var(--ink-2)", "var(--danger)"];
    const pts = shown.map((c, i) => [
      shown.length > 1 ? (i / (shown.length - 1)) * 600 : 300,
      200 - Math.min(100, Math.max(0, c.rate ?? 0)) * 2,
    ]);

    return (
      <>
        <div className="flex flex-wrap gap-3.5">
          <section className={`${CARD} sf-rise flex-[3_1_520px]`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="eyebrow">This month so far · flexible spending</span>
              <button
                type="button"
                onClick={() => open(`${cur.labelLong} so far`, "Flexible spending", rowsOf(flexEntries(cur)))}
                className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-lime-text hover:text-ink"
              >
                See transactions
              </button>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="tabular font-serif text-[clamp(56px,9vw,88px)] leading-[.9]" data-testid="so-far">
                {inr(soFar)}
              </span>
              <span className="font-serif text-xl text-ink-2">
                of {inr(budget)} budget ·{" "}
                <em>
                  {budget ? Math.round((soFar / budget) * 100) : 0}% used, {Math.round((DAY / N) * 100)}% of the cycle
                  gone
                </em>
              </span>
            </div>
            <Stats
              items={[
                { label: `${prevName}, by day ${DAY}`, value: inr(prevSame), ...delta(prevSame) },
                { label: `3-month average, by day ${DAY}`, value: inr(avgSame), ...delta(avgSame) },
                {
                  label: "Fixed bills paid",
                  value: inr(cur.fixed),
                  note: fixedTotal - cur.fixed > 0 ? `${inr(fixedTotal - cur.fixed)} still due` : "All paid",
                  color: "var(--muted)",
                },
              ]}
            />
          </section>
          <section className={`${CARD} sf-rise flex-[2_1_340px]`}>
            <Head title="What stands out" />
            {insights.slice(0, 4).map((x, i) => (
              <button
                key={x.text}
                type="button"
                onClick={x.go}
                className="flex cursor-pointer gap-3 rounded-xl border-0 bg-transparent p-2 text-left hover:bg-tile-2"
              >
                <span className="w-5 font-serif text-lg text-muted italic">{ROMAN[i]}</span>
                <span className="font-serif text-lg leading-[1.3] text-pretty" style={{ color: x.color }}>
                  {x.text}
                </span>
              </button>
            ))}
          </section>
        </div>

        <section className={`${CARD} sf-rise`}>
          <Head title="Month over month">
            <div className="flex flex-wrap gap-3">
              <Key color="var(--fixed)" label="Fixed" />
              <Key color="var(--flex)" label="Flexible" />
              <Key color="var(--lime)" label="Saved" />
              <Key color="var(--ink)" label="Income" dashed />
            </div>
          </Head>
          <div className="flex h-[220px] items-end gap-2.5 border-b border-line-2">
            {shown.map((c) => {
              const h = (v: number) => `${(v / top) * 100}%`;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() =>
                    open(
                      `${c.labelLong} ${c.year}`,
                      `${c.entries.length} entries`,
                      rowsOf((c.entries as Tx[]).filter((t) => t.type !== "income")),
                    )
                  }
                  aria-label={`${c.labelLong}: ${inr(c.fixed)} fixed, ${inr(c.flex)} flexible, ${inr(c.saved + c.extraSaved)} saved, ${inr(c.income)} income`}
                  className="relative flex h-full flex-1 cursor-pointer flex-col justify-end border-0 bg-transparent p-0 hover:opacity-80"
                >
                  {c.income > 0 && (
                    <span
                      className="absolute inset-x-0 border-t-2 border-dashed border-ink"
                      style={{ bottom: h(c.income) }}
                    />
                  )}
                  <span className="rounded-t-md bg-lime" style={{ height: h(c.saved + c.extraSaved) }} />
                  <span className="bg-flex" style={{ height: h(c.flex) }} />
                  <span className="bg-fixed" style={{ height: h(c.fixed) }} />
                </button>
              );
            })}
          </div>
          <div className="flex gap-2.5">
            {shown.map((c) => (
              <span key={c.key} className="flex-1 text-center font-serif text-[15px] text-muted italic">
                {c.label}
              </span>
            ))}
          </div>
          <span className={SUB}>
            Select a month to see where it went. {cur.labelLong} is partial (day {DAY}).
          </span>
        </section>

        <section className={`${CARD} sf-rise`}>
          <Head title="Savings rate" sub="From what reached your bank. Bonuses moved to savings count too.">
            <span className={SUB}>
              Target <strong className="text-ink">{target}%</strong>
            </span>
          </Head>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tabular font-serif text-[44px] leading-none">{Math.round(avgRate)}%</span>
            <span className={SUB}>average · last {range} months</span>
            <span
              className="text-[13px] font-semibold"
              style={{ color: avgRate >= target ? "var(--lime-text)" : "var(--warn)" }}
            >
              {Math.round(avgRate) === target
                ? "Right on target"
                : avgRate >= target
                  ? `${Math.round(avgRate - target)} points above target`
                  : `${Math.round(target - avgRate)} points below target`}
            </span>
          </div>
          <div className="relative h-[200px]">
            <span
              className="absolute inset-x-0 border-t border-dashed border-lime"
              style={{ top: `${100 - Math.min(100, target)}%` }}
            />
            <svg
              viewBox="0 0 600 200"
              preserveAspectRatio="none"
              aria-hidden
              className="absolute inset-0 h-full w-full overflow-visible"
            >
              <polyline
                points={pts.map((p) => p.join(",")).join(" ")}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {shown.map((c, i) => (
              <button
                key={c.key}
                type="button"
                onClick={() =>
                  open(
                    `${c.labelLong} savings`,
                    c.rate === null ? "No income recorded" : `${Math.round(c.rate)}% of income`,
                    rowsOf((c.entries as Tx[]).filter((t) => t.type === "savings_transfer")),
                  )
                }
                aria-label={`${c.labelLong}: ${c.rate === null ? "no income" : `${Math.round(c.rate)}% saved`}`}
                className="absolute -mt-1.5 -ml-1.5 h-3 w-3 cursor-pointer rounded-full border-2 border-tile bg-ink p-0"
                style={{ left: `${(pts[i][0] / 600) * 100}%`, top: `${(pts[i][1] / 200) * 100}%` }}
              />
            ))}
          </div>
        </section>

        <div className="flex flex-wrap gap-3.5">
          <section className={`${CARD} flex-[3_1_480px]`}>
            <Head title="Last 12 months" sub={`${hist[0].label} – ${cur.label} · ${cur.labelLong} in progress`} />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4">
              {[
                { label: "Income", value: inr(yIncome), note: "what reached your bank", c: "var(--ink)" },
                {
                  label: "Spent",
                  value: inr(yFixed + yFlex),
                  note: `${inr(yFixed)} fixed · ${inr(yFlex)} flexible`,
                  c: "var(--ink)",
                },
                {
                  label: "Saved",
                  value: inr(ySaved),
                  note: `${inr(ySaved / Math.max(1, year.length))} a month on average`,
                  c: "var(--lime-text)",
                },
                {
                  label: "Savings rate",
                  value: `${yIncome ? Math.round((ySaved / yIncome) * 100) : 0}%`,
                  note: `target ${target}%`,
                  c: yIncome && (ySaved / yIncome) * 100 >= target ? "var(--lime-text)" : "var(--warn)",
                },
                {
                  label: "Fixed bills",
                  value: `${Math.round(fixShare)}%`,
                  note: `of salary · ${fixShare <= 40 ? "healthy" : fixShare <= 50 ? "high" : "very high"}`,
                  c: fixShare <= 40 ? "var(--ink)" : "var(--warn)",
                },
              ].map((y) => (
                <div key={y.label} className="flex flex-col gap-0.5">
                  <span className="eyebrow">{y.label}</span>
                  <span className="tabular font-serif text-[32px] leading-none" style={{ color: y.c }}>
                    {y.value}
                  </span>
                  <span className="text-xs text-muted">{y.note}</span>
                </div>
              ))}
            </div>
          </section>
          <section className={`${CARD} flex-[2_1_320px]`}>
            <Head title="Where flexible money went" sub={`Last ${range} months · ${inr(distTotal)} total`} />
            <div aria-hidden className="flex h-3 gap-[3px] overflow-hidden rounded-md">
              {dist.map((d, i) => (
                <span
                  key={d.c.id}
                  style={{ width: `${(d.v / Math.max(1, distTotal)) * 100}%`, background: palette[i % palette.length] }}
                />
              ))}
            </div>
            <div className="flex flex-col">
              {dist.map((d, i) => (
                <button
                  key={d.c.id}
                  type="button"
                  onClick={() =>
                    open(
                      d.c.name,
                      `Last ${range} months`,
                      rowsOf(shown.flatMap((cy) => flexEntries(cy, (t) => t.category_id === d.c.id))),
                    )
                  }
                  aria-label={`${d.c.name}: ${inr(d.v)}`}
                  className="flex cursor-pointer items-center gap-2.5 border-0 border-b border-line bg-transparent py-2.5 text-left hover:text-lime-text"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: palette[i % palette.length] }} />
                  <span className="flex-1 font-medium">{d.c.name}</span>
                  <span className="tabular font-semibold">{inr(d.v)}</span>
                  <span className="tabular w-10 text-right text-[13px] text-muted">
                    {Math.round((d.v / distTotal) * 100)}%
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </>
    );
  };

  // ------------------------------------------------------------------ Spending habits
  const habits = () => {
    const cum = (cy: Cycle, upTo: number) => Array.from({ length: upTo + 1 }, (_, k) => flexByDay(cy, k));
    const curCum = cum(cur, DAY),
      prevCum = prev ? cum(prev, prev.period.totalDays) : [];
    const top = Math.max(1, budget, ...curCum, ...prevCum) * 1.05;
    const Y = (v: number) => 240 - (v / top) * 240;
    const pts = (arr: number[], n: number) =>
      arr.map((v, k) => `${((k / n) * 600).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const proj = DAY ? (cur.flex / DAY) * N : 0;
    const cal = calPrev && prev ? prev : cur;
    // Week start (Settings › Preferences): 1 Monday, 0 Sunday. Weekday indexes below are Mon=0..Sun=6.
    const weekStart = settings?.week_start ?? 1;
    const order = weekStart === 1 ? [0, 1, 2, 3, 4, 5, 6] : [6, 0, 1, 2, 3, 4, 5];
    const lead = (new Date(`${cal.period.startStr}T12:00:00`).getDay() - weekStart + 7) % 7;
    const maxD = Math.max(1, ...cal.daily);
    const wk = weekdayAverages([prev, cur].filter(Boolean) as Cycle[], today),
      wkMax = Math.max(1, ...wk);
    const weekday = (wk[0] + wk[1] + wk[2] + wk[3] + wk[4]) / 5,
      weekend = (wk[5] + wk[6]) / 2;
    const payees = topPayees(cur, prev),
      payMax = Math.max(1, ...payees.map((p) => Math.max(p.amount, p.previous ?? 0)));
    const methods = spendByMethod(cur.entries),
      methodTotal = methods.reduce((s, m) => s + m.amount, 0) || 1;
    const dayRows = (cy: Cycle, k: number) =>
      rowsOf(flexEntries(cy, (t) => t.date === addDaysStr(cy.period.startStr, k - 1)));

    return (
      <>
        <section className={`${CARD} sf-rise`}>
          <Head title="Spending pace" sub="Flexible spending added up day by day. Select a day for its entries.">
            <div className="flex flex-wrap gap-3">
              <Key color="var(--lime)" label={cur.labelLong} />
              <Key color="var(--ink-2)" label={prevName} />
              <Key color="var(--muted)" label="Budget pace" dashed />
            </div>
          </Head>
          <div className="relative h-[240px]">
            <svg
              viewBox="0 0 600 240"
              preserveAspectRatio="none"
              aria-hidden
              className="absolute inset-0 h-full w-full"
            >
              <polyline
                points={`0,240 600,${Y(budget)}`}
                fill="none"
                stroke="var(--muted)"
                strokeWidth="1.5"
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
              />
              {prev && (
                <polyline
                  points={pts(prevCum, prev.period.totalDays)}
                  fill="none"
                  stroke="var(--ink-2)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <polygon points={`0,240 ${pts(curCum, N)} ${((DAY / N) * 600).toFixed(1)},240`} fill="var(--lime-soft)" />
              <polyline
                points={pts(curCum, N)}
                fill="none"
                stroke="var(--lime)"
                strokeWidth="3"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <div className="absolute inset-0 flex">
              {Array.from({ length: N }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={i + 1 > DAY}
                  onClick={() =>
                    open(shortDate(addDaysStr(cur.period.startStr, i)), "Flexible spending", dayRows(cur, i + 1))
                  }
                  aria-label={`Day ${i + 1}: ${inr(cur.daily[i])}`}
                  className="flex-1 cursor-pointer border-0 bg-transparent p-0 hover:bg-tile-2/40 disabled:cursor-default disabled:hover:bg-transparent"
                />
              ))}
            </div>
          </div>
          <div className="flex justify-between text-xs text-muted">
            <span>Day 1</span>
            <span>Day 10</span>
            <span>Day 20</span>
            <span>Day {N}</span>
          </div>
          <Stats
            items={[
              {
                label: "Projected month-end",
                value: inr(proj),
                note:
                  proj <= budget
                    ? `${inr(budget - proj)} under budget at this pace`
                    : `${inr(proj - budget)} over budget at this pace`,
                color: proj <= budget ? "var(--lime-text)" : "var(--warn)",
              },
              {
                label: `${prevName} at day ${DAY}`,
                value: inr(prev ? flexByDay(prev, DAY) : 0),
                note: `Finished at ${inr(prev?.flex ?? 0)}`,
                color: "var(--muted)",
              },
              {
                label: "No-spend days",
                value: `${cur.daily.slice(0, DAY).filter((v) => !v).length} of ${DAY}`,
                note: `${prevName} had ${prev ? prev.daily.slice(0, DAY).filter((v) => !v).length : 0} by day ${DAY}`,
                color: "var(--muted)",
              },
            ]}
          />
        </section>

        <div className="flex flex-wrap gap-3.5">
          <section className={`${CARD} flex-[3_1_440px]`}>
            <Head title="Spending calendar">
              <div role="group" aria-label="Month" className="flex gap-0.5 rounded-full border border-line p-[3px]">
                {[false, true].map((p) => (
                  <button
                    key={String(p)}
                    type="button"
                    aria-pressed={calPrev === p}
                    onClick={() => setCalPrev(p)}
                    className="h-7 cursor-pointer rounded-full border-0 px-3 text-xs font-semibold"
                    style={{
                      background: calPrev === p ? "var(--tile-2)" : "transparent",
                      color: calPrev === p ? "var(--ink)" : "var(--muted)",
                    }}
                  >
                    {p ? prevName : cur.labelLong}
                  </button>
                ))}
              </div>
            </Head>
            <div className="grid grid-cols-7 gap-1">
              {order.map((i) => (
                <span key={i} className="text-center text-xs text-muted">
                  {"MTWTFSS"[i]}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {cal.daily.map((v, i) => {
                const date = addDaysStr(cal.period.startStr, i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={date > today}
                    onClick={() => open(dayLabel(date, today), "Flexible spending", dayRows(cal, i + 1))}
                    aria-label={`${shortDate(date)}: ${inr(v)}`}
                    className="flex aspect-square min-h-9 cursor-pointer flex-col items-start justify-between rounded-lg border border-line p-1.5 text-left disabled:cursor-default disabled:opacity-40"
                    style={{
                      background: v
                        ? `color-mix(in srgb, var(--lime) ${Math.round(15 + (v / maxD) * 70)}%, transparent)`
                        : "var(--track)",
                    }}
                  >
                    <span className="text-[10px] text-muted">{+date.slice(8)}</span>
                    {v > 0 && (
                      <span className="tabular text-[10px] font-semibold text-ink max-[480px]:hidden">{inr(v)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
          <section className={`${CARD} flex-[2_1_300px]`}>
            <Head title="By weekday" sub={`Average flexible spend, ${prev?.label ?? cur.label}–${cur.label}`} />
            {order.map((i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-9 text-[13px] text-muted">{WEEKDAYS[i]}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-track">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(wk[i] / wkMax) * 100}%`, background: i >= 5 ? "var(--warn)" : "var(--lime)" }}
                  />
                </div>
                <span className="tabular w-16 text-right text-[13px] font-semibold">{inr(wk[i])}</span>
              </div>
            ))}
            {weekday > 0 && (
              <span className={SUB}>
                A weekend day costs {Math.round(Math.abs(weekend / weekday - 1) * 100)}%{" "}
                {weekend >= weekday ? "more" : "less"} than a weekday on average.
              </span>
            )}
          </section>
        </div>

        <section className={CARD}>
          <Head title="Top payees" sub={`The biggest names in ${cur.labelLong} so far`}>
            <div className="flex gap-3">
              <Key color="var(--lime)" label={cur.labelLong} />
              <Key color="var(--ink-2)" label={prevName} />
            </div>
          </Head>
          {payees.map((p) => {
            const diff = p.previous === null ? null : p.amount - p.previous;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() =>
                  open(p.name, `${p.count} ${p.count === 1 ? "entry" : "entries"} this month`, rowsOf(p.entries))
                }
                aria-label={`${p.name}: ${inr(p.amount)}`}
                className={ROW_BTN}
              >
                <span className="flex min-w-[140px] flex-col">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-muted">
                    {p.count} {p.count === 1 ? "entry" : "entries"}
                  </span>
                </span>
                <span className="relative h-2.5 min-w-[120px] flex-1 rounded-full bg-track">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-lime"
                    style={{ width: `${(p.amount / payMax) * 100}%` }}
                  />
                  {p.previous !== null && (
                    <span
                      className="absolute -top-1 -bottom-1 w-0.5 rounded-sm bg-ink-2"
                      style={{ left: `${(p.previous / payMax) * 100}%` }}
                    />
                  )}
                </span>
                <span className="tabular w-20 text-right font-semibold">{inr(p.amount)}</span>
                <span
                  className="w-[150px] text-right text-xs"
                  style={{ color: diff === null ? "var(--muted)" : diff > 0 ? "var(--warn)" : "var(--lime-text)" }}
                >
                  {diff === null
                    ? "New this month"
                    : diff > 0
                      ? `${inr(diff)} more than ${prev?.label}`
                      : `${inr(-diff)} less than ${prev?.label}`}
                </span>
              </button>
            );
          })}
          {!payees.length && (
            <p className="m-0 font-serif text-xl text-ink-2 italic">No flexible spending logged this cycle yet.</p>
          )}
        </section>

        <section id="pm-card" className={CARD}>
          <Head
            title="Spend by payment method"
            sub={`${cur.partial ? `${cur.labelLong} so far` : cur.labelLong} · every expense, bills included · ${inr(methodTotal)}`}
          />
          {methods.some((m) => m.key) ? (
            <>
              <div
                role="img"
                aria-label={methods.map((m) => `${m.label} ${Math.round((m.amount / methodTotal) * 100)}%`).join(", ")}
                className="flex h-3.5 gap-[3px]"
              >
                {methods.map((m) => (
                  <span
                    key={m.label}
                    className="sf-grow rounded-md"
                    style={{
                      width: `${((m.amount / methodTotal) * 100).toFixed(2)}%`,
                      background: METHOD_COLOR[m.key ?? "none"],
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-col">
                {methods.map((m) => {
                  const pct = Math.round((m.amount / methodTotal) * 100);
                  return (
                    <button
                      key={m.label}
                      type="button"
                      onClick={() => open(m.label, `${cur.labelLong} · ${inr(m.amount)}`, rowsOf(m.entries))}
                      aria-label={`${m.label}: ${inr(m.amount)}, ${pct}%`}
                      className="-mx-2 flex cursor-pointer items-center gap-3 rounded-[10px] border-0 border-b border-line bg-transparent px-2 py-3 text-left transition-colors duration-150 hover:bg-tile-2"
                    >
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 flex-none rounded-full border"
                        style={{
                          background: METHOD_COLOR[m.key ?? "none"],
                          borderColor: m.key ? "transparent" : "var(--line-2)",
                        }}
                      />
                      <span className="flex min-w-0 flex-auto flex-col">
                        <span className="font-semibold">{m.label}</span>
                        <span className="text-xs text-muted">
                          {m.count} {m.count === 1 ? "entry" : "entries"}
                          {m.key ? "" : " · edit an entry to add one"}
                        </span>
                      </span>
                      <span className="tabular font-serif text-2xl leading-none whitespace-nowrap">
                        {inr(m.amount)}
                      </span>
                      <span className="tabular w-12 flex-none text-right text-[13px] font-semibold text-ink-2">
                        {pct}%
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="flex items-center gap-2 text-xs text-muted">
                <Info size={13} aria-hidden className="flex-none" />
                Tracking only. Payment method never changes safe to spend or any total.
              </span>
            </>
          ) : (
            <>
              <div aria-hidden className="flex h-3.5 gap-[3px]">
                {[46, 24, 18, 12].map((w) => (
                  <span key={w} className="rounded-md bg-track" style={{ width: `${w}%` }} />
                ))}
              </div>
              <p className="m-0 mt-1.5 font-serif text-xl text-pretty text-ink-2 italic">No payment methods yet.</p>
              <span className="text-sm text-pretty text-ink-2">
                Pick UPI, card or cash when you log an expense and this fills in. Older entries stay “Not set” until you
                edit them.
              </span>
            </>
          )}
        </section>
      </>
    );
  };

  // ------------------------------------------------------------------ Categories
  const categoriesTab = () => {
    const last = done[done.length - 1],
      before = done[done.length - 2];
    const last3 = done.slice(-3),
      last6 = done.slice(-6);
    const cols = shown.filter((c) => !c.partial && c.entries.length);
    const limited = flex.filter((c) => Number(c.monthly_limit) > 0);
    const tone = (r: number) => (r > 1 ? "var(--danger)" : r >= 0.8 ? "var(--warn)" : "var(--lime)");
    return (
      <>
        <section className={`${CARD} sf-rise`}>
          <Head
            title={`${last.labelLong} against your averages`}
            sub="Last full month. Select a category for its history."
          />
          {flex.map((c) => {
            const v = last.byCat.get(c.id) ?? 0,
              avg = last3.reduce((s, cy) => s + (cy.byCat.get(c.id) ?? 0), 0) / last3.length;
            const lim = Number(c.monthly_limit),
              series = last6.map((cy) => cy.byCat.get(c.id) ?? 0);
            const top = Math.max(1, lim, v, avg, ...series) * 1.1;
            const sy = (s: number) => 30 - (s / top) * 28;
            const spark = series
              .map((s, i) => `${series.length > 1 ? (i / (series.length - 1)) * 96 : 48},${sy(s)}`)
              .join(" ");
            const rising = series.length > 1 && series[series.length - 1] > series[0];
            const diff = v - avg;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  open(
                    c.name,
                    "Last 6 months",
                    last6.map((cy) => ({
                      a: `${cy.labelLong} ${cy.year}`,
                      b: lim ? `limit ${inr(lim)}` : "no limit",
                      amt: cy.byCat.get(c.id) ?? 0,
                    })),
                  )
                }
                className={ROW_BTN}
              >
                <span className="flex min-w-[140px] flex-col">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-xs text-muted">{lim ? `limit ${inr(lim)}` : "no limit"}</span>
                </span>
                <span
                  role="img"
                  aria-label={`${c.name}, last 6 months: ${series.map((s) => inr(s)).join(", ")}`}
                  className="h-[30px] w-24"
                >
                  <svg
                    viewBox="0 0 96 30"
                    preserveAspectRatio="none"
                    aria-hidden
                    className="h-full w-full overflow-visible"
                  >
                    {lim > 0 && (
                      <line
                        x1="0"
                        x2="96"
                        y1={sy(lim)}
                        y2={sy(lim)}
                        stroke="var(--muted)"
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                    <polyline
                      points={spark}
                      fill="none"
                      stroke={rising ? "var(--warn)" : "var(--ink-2)"}
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </span>
                <span className="relative h-2.5 min-w-[100px] flex-1 rounded-full bg-track">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.min(100, (v / top) * 100)}%`,
                      background: lim ? tone(v / lim) : "var(--lime)",
                    }}
                  />
                  <span
                    title="3-month average"
                    className="absolute -top-1 -bottom-1 w-0.5 bg-ink"
                    style={{ left: `${Math.min(100, (avg / top) * 100)}%` }}
                  />
                  {before && (
                    <span
                      title={before.labelLong}
                      className="absolute -top-1 -bottom-1 w-0.5 bg-ink-2 opacity-60"
                      style={{ left: `${Math.min(100, ((before.byCat.get(c.id) ?? 0) / top) * 100)}%` }}
                    />
                  )}
                </span>
                <span className="tabular w-20 text-right font-semibold">{inr(v)}</span>
                <span
                  className="w-[130px] text-right text-xs"
                  style={{
                    color: Math.abs(diff) < 100 ? "var(--muted)" : diff > 0 ? "var(--warn)" : "var(--lime-text)",
                  }}
                >
                  {Math.abs(diff) < 100
                    ? "Same as usual"
                    : diff > 0
                      ? `${inr(diff)} above average`
                      : `${inr(-diff)} below average`}
                </span>
              </button>
            );
          })}
        </section>

        <section className={`${CARD} overflow-x-auto`}>
          <Head
            title="Category by month"
            sub="Shaded by how much of the limit was used. Select a cell for its detail."
          />
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `minmax(110px,1.4fr) repeat(${cols.length}, minmax(44px,1fr))` }}
          >
            <span />
            {cols.map((cy) => (
              <span key={cy.key} className="text-center font-serif text-sm text-muted italic">
                {cy.label}
              </span>
            ))}
            {flex.flatMap((c) => {
              const lim = Number(c.monthly_limit);
              return [
                <span key={c.id} className="truncate text-[13px] font-medium">
                  {c.name}
                </span>,
                ...cols.map((cy) => {
                  const v = cy.byCat.get(c.id) ?? 0,
                    r = lim ? v / lim : 0;
                  return (
                    <button
                      key={c.id + cy.key}
                      type="button"
                      onClick={() =>
                        open(
                          `${c.name} · ${cy.labelLong}`,
                          lim ? `${Math.round(r * 100)}% of ${inr(lim)}` : "No limit",
                          rowsOf(flexEntries(cy, (t) => t.category_id === c.id)),
                        )
                      }
                      aria-label={`${c.name}, ${cy.labelLong}: ${inr(v)}`}
                      className="tabular h-9 cursor-pointer rounded-md border-0 text-[11px] font-semibold text-ink"
                      style={{
                        background: !v
                          ? "var(--track)"
                          : lim
                            ? `color-mix(in srgb, ${tone(r)} ${Math.round(25 + Math.min(1.2, r) * 50)}%, transparent)`
                            : "var(--tile-2)",
                      }}
                    >
                      {v ? (lim ? `${Math.round(r * 100)}%` : inr(v)) : ""}
                    </button>
                  );
                }),
              ];
            })}
          </div>
        </section>

        <section className={CARD}>
          <Head title="Budget hit rate" sub={`How often each limit held over the last ${cols.length} months.`} />
          {limited.map((c) => {
            const lim = Number(c.monthly_limit),
              held = cols.filter((cy) => (cy.byCat.get(c.id) ?? 0) <= lim);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  open(
                    c.name,
                    `Limit ${inr(lim)}`,
                    cols.map((cy) => ({
                      a: `${cy.labelLong} ${cy.year}`,
                      b: (cy.byCat.get(c.id) ?? 0) <= lim ? "held" : "over",
                      amt: cy.byCat.get(c.id) ?? 0,
                    })),
                  )
                }
                className={ROW_BTN}
              >
                <span className="tabular w-14 font-serif text-[28px] leading-none">
                  {cols.length ? Math.round((held.length / cols.length) * 100) : 0}%
                </span>
                <span className="flex min-w-[140px] flex-1 flex-col">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-xs text-muted">
                    held {held.length} of {cols.length} months · limit {inr(lim)}
                  </span>
                </span>
                <span className="flex gap-1">
                  {cols.map((cy) => (
                    <span
                      key={cy.key}
                      title={cy.labelLong}
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: (cy.byCat.get(c.id) ?? 0) <= lim ? "var(--lime)" : "var(--danger)" }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
          {!limited.length && (
            <p className="m-0 font-serif text-xl text-ink-2 italic">No limits set yet. Add one in Budgets → Manage.</p>
          )}
        </section>
      </>
    );
  };

  // ------------------------------------------------------------------ Plan ahead
  const plan = () => {
    const next = cycleFor(new Date(`${addDaysStr(cur.period.endStr, 1)}T12:00:00`), reportSchedule(schedule, grouping));
    const nextName = new Date(`${next.startStr}T12:00:00`).toLocaleDateString("en-GB", { month: "long" });
    const f = forecastNext({
      settings: planFor(settings, next.startStr),
      fixed,
      recurringItems,
      flex,
      fullCycles: done,
      lastIncome: done[done.length - 1]?.income ?? 0,
    });
    const sugg = suggestLimits(flex, done);
    const fits = f.gap >= 0;
    const rows = [
      {
        label: "Take-home pay",
        sub: settings?.take_home_pay ? "From your setup" : "Your last full month",
        amount: f.income,
        color: "var(--ink-2)",
        go: () => setTab("overview"),
      },
      {
        label: "Savings",
        sub: `${target}% set aside first`,
        amount: -f.savings,
        color: "var(--lime)",
        go: () => setTab("overview"),
      },
      {
        label: "Fixed bills",
        sub: "Rent, EMIs, insurance, utilities",
        amount: -f.fixedTotal,
        color: "var(--fixed)",
        go: () =>
          open(
            `Fixed bills · ${nextName}`,
            "From your categories",
            fixed.map((c) => ({
              a: c.name,
              b: c.due_day ? `due day ${c.due_day}` : "no due day",
              amt: Number(c.monthly_limit),
            })),
          ),
      },
      {
        label: "Subscriptions & other recurring",
        sub: "From your recurring list",
        amount: -f.subsTotal,
        color: "var(--warn)",
        go: () =>
          open(
            `Recurring · ${nextName}`,
            "From your recurring list",
            f.subs.map((r) => ({
              a: r.name,
              b: r.day_of_month ? `day ${r.day_of_month}` : "no fixed day",
              amt: Number(r.amount),
            })),
          ),
      },
      {
        label: "Left for flexible spending",
        sub: "Groceries, dining, fuel and the rest",
        amount: f.left,
        color: "var(--flex)",
        go: () => setTab("categories"),
      },
    ];
    let cursor = f.income;
    const setLimit = async (s: (typeof sugg)[number], to: number, mark: "accept" | "undo") => {
      // A suggested limit is in the base currency, so it replaces a foreign one (or re-pricing would undo it).
      const { error } = await createClient()
        .from("categories")
        .update({ monthly_limit: to, original_amount: null, original_currency: null, fx_rate: null, fx_date: null })
        .eq("id", s.categoryId);
      if (error) return toast("Couldn’t save. Check your connection and try again.", { error: true });
      setDecided((d) => {
        const n = { ...d };
        if (mark === "accept") n[s.categoryId] = { from: s.from, to };
        else delete n[s.categoryId];
        return n;
      });
      await onChanged();
      if (mark === "accept") toast(`${s.name} limit is now ${inr(to)}`);
    };

    return (
      <>
        <section className={`${CARD} sf-rise`}>
          <Head
            title={`${nextName} forecast`}
            sub="Built from your recurring bills, savings target and planned limits."
          >
            <span
              className="rounded-full px-2.5 py-[3px] text-xs font-semibold"
              style={{
                background: fits ? "var(--lime-soft)" : "var(--warn-soft)",
                color: fits ? "var(--lime-text)" : "var(--warn)",
              }}
            >
              {fits ? "Fits your habits" : "Tight month"}
            </span>
          </Head>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
            <div className="flex flex-col gap-1">
              <span className="eyebrow">Projected safe to spend</span>
              <span className="tabular font-serif text-[clamp(48px,8vw,72px)] leading-[.9]">{inr(f.left)}</span>
              <span className="font-serif text-lg text-ink-2">
                About <em className="text-ink">{inr(Math.max(0, f.left) / next.totalDays)} a day</em> across{" "}
                {next.totalDays} days.
              </span>
            </div>
            <div className="flex flex-col gap-1 text-sm text-ink-2">
              <div className="flex justify-between gap-6">
                <span>Your flexible limits</span>
                <strong className="tabular text-ink">{inr(f.plan)}</strong>
              </div>
              <div className="flex justify-between gap-6">
                <span>You usually spend</span>
                <strong className="tabular text-ink">{inr(f.typical)}</strong>
              </div>
            </div>
          </div>
          <span className="text-sm font-semibold" style={{ color: fits ? "var(--lime-text)" : "var(--warn)" }}>
            {fits
              ? `Your usual spending fits with ${inr(f.gap)} to spare.`
              : `Your usual spending is ${inr(-f.gap)} more than ${nextName} allows. Accepting the suggestions below or trimming one category closes the gap.`}
          </span>
          <div className="flex flex-col">
            {rows.map((r, k) => {
              const base = Math.max(1, f.income);
              let left = 0;
              if (k > 0 && k < rows.length - 1) {
                cursor += r.amount;
                left = (cursor / base) * 100;
              }
              return (
                <button key={r.label} type="button" onClick={r.go} className={ROW_BTN}>
                  <span className="flex min-w-[200px] flex-col">
                    <span className="font-semibold">{r.label}</span>
                    <span className="text-xs text-muted">{r.sub}</span>
                  </span>
                  <span className="relative h-3 min-w-[120px] flex-1 rounded-md bg-track">
                    <span
                      className="absolute inset-y-0 rounded-md"
                      style={{
                        left: `${Math.max(0, left)}%`,
                        width: `${Math.max(0, Math.min(100, (Math.abs(r.amount) / base) * 100))}%`,
                        background: r.color,
                      }}
                    />
                  </span>
                  <span
                    className="tabular w-24 text-right font-semibold"
                    style={{ color: k === rows.length - 1 ? "var(--lime-text)" : "var(--ink)" }}
                  >
                    {r.amount < 0 ? `−${inr(-r.amount)}` : inr(r.amount)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={CARD}>
          <Head title="Suggested limits" sub="Based on your last three months. Nothing changes until you accept." />
          {sugg
            .filter((s) => decided[s.categoryId] !== "kept")
            .map((s) => {
              const dec = decided[s.categoryId];
              return (
                <article
                  key={s.categoryId}
                  className="flex flex-col gap-2 rounded-[14px] border border-line p-4"
                  data-testid="suggestion"
                  data-name={s.name}
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold">{s.name}</span>
                    <span className="rounded-full border border-line-2 px-2 py-px text-[11px] font-semibold text-ink-2">
                      {s.tag}
                    </span>
                    <span className="tabular ml-auto font-serif text-2xl">
                      <span className="text-muted">{s.from ? inr(s.from) : "No limit"}</span> → {inr(s.to)}
                    </span>
                  </div>
                  <p className="m-0 text-sm text-pretty text-ink-2">
                    {s.tag === "Raise"
                      ? `You’ve averaged ${inr(s.average)} and went over in ${s.overCount} of the last ${Math.min(3, done.length)} months. A realistic limit makes your daily number trustworthy.`
                      : s.tag === "Lower"
                        ? `You’ve averaged ${inr(s.average)}. Lowering it frees ${inr(s.from - s.to)} a month for savings or other categories.`
                        : `No limit yet. You’ve averaged ${inr(s.average)}, with a high of ${inr(s.high)}.`}
                  </p>
                  {dec && dec !== "kept" ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold text-lime-text">
                        Limit set to {inr(dec.to)} from now on.
                      </span>
                      <button
                        type="button"
                        onClick={() => setLimit(s, dec.from, "undo")}
                        className="h-[34px] cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold"
                      >
                        Undo
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setLimit(s, s.to, "accept")}
                        className="h-[34px] cursor-pointer rounded-full border-0 bg-lime px-3.5 text-[13px] font-bold text-lime-ink active:scale-[.97]"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecided((d) => ({ ...d, [s.categoryId]: "kept" }))}
                        className="h-[34px] cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold"
                      >
                        Keep {s.from ? inr(s.from) : "no limit"}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          {!sugg.length && (
            <p className="m-0 font-serif text-xl text-ink-2 italic">Your limits already match how you spend.</p>
          )}
        </section>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span className="eyebrow">
            Reports · day {DAY} of {N}
          </span>
          <h1 className="m-0 font-serif text-[clamp(40px,6vw,56px)] leading-none font-normal">
            Reports &amp; <em>analysis</em>
          </h1>
        </div>
        <div role="group" aria-label="Range" className="flex gap-0.5 rounded-full border border-line p-[3px]">
          {[3, 6, 12].map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className="h-[30px] cursor-pointer rounded-full border-0 px-3.5 text-[13px] font-semibold"
              style={{
                background: range === r ? "var(--tile-2)" : "transparent",
                color: range === r ? "var(--ink)" : "var(--muted)",
              }}
            >
              {r}M
            </button>
          ))}
        </div>
      </div>
      <nav role="tablist" aria-label="Report sections" className="flex flex-wrap gap-1.5 pb-1" onKeyDown={onTabKey}>
        {TABS.map(([k, label], i) => (
          <button
            key={k}
            id={`rtab-${k}`}
            type="button"
            role="tab"
            aria-selected={tab === k}
            aria-controls="rp-panel"
            tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors"
            style={{
              background: tab === k ? "var(--ink)" : "transparent",
              color: tab === k ? "var(--bg)" : "var(--ink-2)",
              borderColor: tab === k ? "var(--ink)" : "var(--line)",
            }}
          >
            <span className="font-serif italic opacity-70">{ROMAN[i]}</span>
            {label}
          </button>
        ))}
      </nav>

      <div id="rp-panel" role="tabpanel" aria-labelledby={`rtab-${tab}`} className="flex flex-col gap-3.5">
        {empty ? (
          <section className={`${CARD} sf-rise`}>
            <span className="eyebrow">{TABS.find(([k]) => k === tab)![1]}</span>
            <h2 className="m-0 font-serif text-[clamp(32px,5vw,44px)] leading-none font-normal text-pretty">
              {EMPTY[tab][0]}
            </h2>
            <p className="m-0 max-w-[520px] text-ink-2">{EMPTY[tab][1]}</p>
          </section>
        ) : tab === "overview" ? (
          overview()
        ) : tab === "habits" ? (
          habits()
        ) : tab === "categories" ? (
          categoriesTab()
        ) : (
          plan()
        )}
      </div>

      <Drawer
        open={!!drill}
        onClose={() => setDrill(null)}
        eyebrow={drill?.sub ?? ""}
        title={drill?.title ?? ""}
        footer={
          <>
            <span className="eyebrow">Total</span>
            <span className="tabular font-serif text-[32px] leading-none">
              {inr((drill?.rows ?? []).reduce((s, r) => s + r.amt, 0))}
            </span>
          </>
        }
      >
        {(drill?.rows ?? []).map((r, i) => (
          <div key={i} className="flex items-baseline gap-3 border-b border-line py-[13px]">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold [overflow-wrap:anywhere]">{r.a}</span>
              <span className="text-[13px] text-muted">{r.b}</span>
            </span>
            <span className="tabular font-semibold whitespace-nowrap">{inr(r.amt)}</span>
          </div>
        ))}
        {drill && !drill.rows.length && (
          <p className="my-6 font-serif text-xl text-ink-2 italic">Nothing spent on this day.</p>
        )}
      </Drawer>
    </div>
  );
}
