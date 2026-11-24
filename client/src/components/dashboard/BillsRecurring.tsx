"use client";

// Bills & recurring card (design handoff): calendar strip of the cycle, then each
// recurring item and each fixed bill that has no recurring item of its own.

import { formatExact, inr } from "@/lib/money.mjs";
import { addDaysStr, cycleDayOf, dayLabel, dueDateInCycle, shortDate } from "@/lib/cycle.mjs";
import { recurringStatus } from "@/lib/recurringStatus.mjs";
import Reveal from "../ui/Reveal";
import { CARD_H2, PILL_LIME, PILL_LINE, type Category, type RecurringItem, type Tx } from "./types";

type Period = { startStr: string; endStr: string; totalDays: number; daysElapsed: number };

const PILL_STATUS = "rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";
const ROW =
  "mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-xl border px-3.5 py-3 transition-opacity duration-200";

export default function BillsRecurring({
  items,
  fixed,
  byId,
  spentByCat,
  skippedCats,
  cycleTransactions,
  unpaidBills,
  period,
  today,
  onRecord,
  onToggle,
  onPayBill,
  onEdit,
  onManage,
}: {
  items: RecurringItem[];
  fixed: Category[];
  byId: Map<string, Category>;
  spentByCat: Map<string, number>;
  skippedCats: Set<string | null>;
  cycleTransactions: Tx[];
  unpaidBills: number;
  period: Period;
  today: string;
  onRecord: (item: RecurringItem) => void;
  onToggle: (item: RecurringItem) => void;
  onPayBill: (category: Category) => void;
  onEdit: (item: RecurringItem) => void;
  onManage: () => void;
}) {
  const ctx = { cycleTransactions, period, today };
  const rows = items.map((item) => ({ item, st: recurringStatus(item, ctx) }));
  const billCats = fixed.filter((c) => !items.some((r) => r.active && r.category_id === c.id));

  // Still to pay: unpaid fixed bills plus recurring expenses outside fixed categories that are due or coming up.
  const recurringDue = rows
    .filter(
      ({ item, st }) =>
        item.type === "expense" &&
        byId.get(item.category_id ?? "")?.type !== "fixed" &&
        (st.key === "due" || st.key === "upcoming"),
    )
    .reduce((s, { item }) => s + Number(item.amount), 0);
  const yearly =
    (items.filter((r) => r.type === "expense" && r.active).reduce((s, r) => s + Number(r.amount), 0) +
      billCats.reduce((s, c) => s + Number(c.monthly_limit), 0)) *
    12;

  // Calendar strip: one cell per cycle day, a dot where a scheduled item falls.
  const byDay = new Map<number, typeof rows>();
  rows
    .filter(({ item }) => item.active && item.day_of_month)
    .forEach((r) => {
      const k = cycleDayOf(dueDateInCycle(r.item.day_of_month!, period), period);
      byDay.set(k, [...(byDay.get(k) ?? []), r]);
    });

  const status = (key: string, dueDate: string | null, entryDate?: string) => {
    if (key === "recorded")
      return { label: `Recorded ${dayLabel(entryDate!, today)}`, color: "var(--muted)", border: "var(--line)" };
    if (key === "paused") return { label: "Stopped", color: "var(--muted)", border: "var(--line)" };
    if (key === "skipped")
      return { label: "Skipped this month · not counted", color: "var(--muted)", border: "var(--line)" };
    if (key === "due")
      return {
        label: dueDate === today ? "Due today" : "Due · not recorded",
        color: "var(--warn)",
        border: "var(--warn)",
      };
    if (key === "upcoming")
      return { label: `Due ${shortDate(dueDate!)}`, color: "var(--ink-2)", border: "var(--line-2)" };
    return { label: "Suggested when you log", color: "var(--muted)", border: "var(--line-2)" };
  };

  return (
    <Reveal aria-labelledby="rec-h" className="flex flex-col rounded-[18px] border border-line bg-tile p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 pb-2.5">
        <h2 id="rec-h" className={CARD_H2}>
          Bills &amp; recurring
        </h2>
        <span className="text-[13px] text-muted">
          {inr(unpaidBills + recurringDue)} still to pay this cycle · {inr(yearly)} a year · dashed rows aren’t paid yet
        </span>
      </div>

      {rows.length + billCats.length > 0 && (
        <div className="flex flex-col gap-2 pt-4 pb-1.5">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${period.totalDays}, minmax(0, 1fr))` }}>
            {Array.from({ length: period.totalDays }, (_, i) => {
              const k = i + 1,
                date = addDaysStr(period.startStr, i),
                dom = +date.slice(8),
                isToday = k === period.daysElapsed;
              const here = byDay.get(k) ?? [];
              const keys = here.map((r) => r.st.key);
              const st = keys.includes("due")
                ? "due"
                : keys.some((x) => x === "upcoming" || x === "suggested")
                  ? "up"
                  : keys.includes("recorded")
                    ? "done"
                    : here.length
                      ? "skip"
                      : "";
              const title = `${shortDate(date)}${isToday ? " (today)" : ""}${here.length ? ": " + here.map((r) => `${r.item.name} ${inr(r.item.amount)} (${r.st.key === "recorded" ? "recorded" : r.st.key === "due" ? "due" : r.st.key === "skipped" ? "skipped" : "coming up"})`).join(", ") : ""}`;
              return (
                <span
                  key={k}
                  title={title}
                  aria-label={title}
                  className="flex h-[46px] flex-col items-center justify-between rounded-md py-[5px]"
                  style={{ background: isToday ? "var(--tile-2)" : "transparent" }}
                >
                  <span
                    className="tabular text-[10px] leading-none"
                    style={{ color: isToday ? "var(--ink)" : "var(--muted)", fontWeight: isToday ? 700 : 400 }}
                  >
                    {k === 1 || dom % 5 === 0 || isToday ? dom : ""}
                  </span>
                  <span
                    className="h-2.5 w-2.5 rounded-full border-2"
                    style={{
                      opacity: !here.length ? 0 : st === "skip" ? 0.6 : 1,
                      borderStyle: st === "skip" ? "dashed" : "solid",
                      background: st === "done" ? "var(--lime)" : "transparent",
                      borderColor:
                        st === "done"
                          ? "var(--lime)"
                          : st === "due"
                            ? "var(--warn)"
                            : st === "skip"
                              ? "var(--muted)"
                              : "var(--line-2)",
                    }}
                  />
                </span>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {(
              [
                ["Recorded", "2px solid var(--lime)", "var(--lime)", 1],
                ["Due, not recorded", "2px solid var(--warn)", "transparent", 1],
                ["Coming up", "2px solid var(--line-2)", "transparent", 1],
                ["Skipped", "2px dashed var(--muted)", "transparent", 0.6],
              ] as const
            ).map(([text, border, bg, opacity]) => (
              <span key={text} className="flex items-center gap-1.5">
                <span className="h-[9px] w-[9px] rounded-full" style={{ border, background: bg, opacity }} />
                {text}
              </span>
            ))}
          </div>
        </div>
      )}

      {rows.map(({ item, st }) => {
        const s = status(st.key, st.dueDate, st.entry?.date);
        const cat = item.category_id ? byId.get(item.category_id) : undefined;
        return (
          <div
            key={item.id}
            className={ROW}
            style={{
              borderColor: "var(--line-2)",
              borderStyle: st.key === "recorded" ? "solid" : "dashed",
              opacity: item.active ? 1 : 0.55,
            }}
            data-testid="recurring-row"
            data-name={item.name}
          >
            <span className="flex min-w-0 flex-[1_1_180px] flex-col">
              <span className="font-semibold">{item.name}</span>
              <span className="text-[13px] text-muted">
                {item.type === "income" ? "Income" : (cat?.name ?? "Expense")} ·{" "}
                {item.day_of_month ? `day ${item.day_of_month}` : "no fixed day"}
                {item.original_currency ? " · rate changes each cycle" : ""}
              </span>
            </span>
            <span className={PILL_STATUS} style={{ borderColor: s.border, color: s.color }}>
              {s.label}
            </span>
            <span className="flex min-w-[90px] flex-col items-end">
              <span className="tabular font-semibold">
                {item.type === "income" ? "+ " : "− "}
                {inr(item.amount)}
              </span>
              {item.original_currency && (
                <span className="tabular text-xs text-muted">
                  {formatExact(Number(item.original_amount), item.original_currency)}
                </span>
              )}
            </span>
            <span className="flex gap-1.5">
              {item.active && (st.key === "due" || st.key === "suggested") && (
                <button
                  type="button"
                  onClick={() => onRecord(item)}
                  aria-label={`Record ${item.name} now`}
                  className={`${PILL_LIME} px-3`}
                >
                  Record
                </button>
              )}
              <button
                type="button"
                onClick={() => onEdit(item)}
                aria-label={`Edit ${item.name}`}
                className={`${PILL_LINE} px-3`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onToggle(item)}
                aria-label={item.active ? `Stop repeating ${item.name}` : `Resume ${item.name}`}
                className={`${PILL_LINE} min-w-[76px] px-3`}
              >
                {item.active ? "Stop" : "Resume"}
              </button>
            </span>
          </div>
        );
      })}

      {billCats.map((c) => {
        const spent = spentByCat.get(c.id) ?? 0,
          limit = Number(c.monthly_limit),
          paid = spent >= limit;
        const due = c.due_day ? dueDateInCycle(c.due_day, period) : null;
        const late = !paid && !!due && due < today;
        const label = skippedCats.has(c.id)
          ? "Skipped this month"
          : paid
            ? "Paid"
            : spent > 0
              ? `${inr(limit - spent)} left`
              : late
                ? "Due · not paid"
                : due
                  ? `Due ${shortDate(due)}`
                  : "Due";
        return (
          <div
            key={c.id}
            className={ROW}
            style={{ borderColor: "var(--line-2)", borderStyle: paid ? "solid" : "dashed" }}
            data-testid="bill-row"
            data-name={c.name}
          >
            <span className="flex min-w-0 flex-[1_1_180px] flex-col">
              <span className="font-semibold">{c.name}</span>
              <span className="text-[13px] text-muted">
                Fixed bill · {due ? `due ${shortDate(due)}` : "no due day"}
                {c.original_currency ? " · rate changes each cycle" : ""}
              </span>
            </span>
            <span
              className={PILL_STATUS}
              style={{
                borderColor: paid ? "var(--line)" : late ? "var(--warn)" : "var(--line-2)",
                color: paid ? "var(--muted)" : late ? "var(--warn)" : "var(--ink-2)",
              }}
            >
              {label}
            </span>
            <span className="flex min-w-[90px] flex-col items-end">
              <span className="tabular font-semibold">− {inr(limit)}</span>
              {c.original_currency && (
                <span className="tabular text-xs text-muted">
                  {formatExact(Number(c.original_amount), c.original_currency)}
                </span>
              )}
            </span>
            <span className="flex gap-1.5">
              {!paid && (
                <button
                  type="button"
                  onClick={() => onPayBill(c)}
                  aria-label={`Record ${c.name} payment`}
                  className={`${PILL_LIME} px-3`}
                >
                  Record
                </button>
              )}
              <button
                type="button"
                onClick={onManage}
                aria-label={`Edit ${c.name} in categories`}
                className={`${PILL_LINE} px-3`}
              >
                Edit
              </button>
            </span>
          </div>
        );
      })}

      {rows.length + billCats.length === 0 && (
        <p className="mt-[18px] mb-1 font-serif text-xl text-pretty text-ink-2 italic">
          No bills or recurring payments yet. Add rent or EMIs in Manage, or turn on “Repeat every month” when you log a
          subscription.
        </p>
      )}
    </Reveal>
  );
}
