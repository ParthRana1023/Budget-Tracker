"use client";

// Ledger (design handoff): this cycle's entries grouped by day; collapsible, state remembered.
// Payment-method filter (design handoff v3, Payment): multi-select chips with this cycle's counts,
// kept in the URL (?method=cash,none) so it survives a refresh and can be shared.

import { useEffect, useState } from "react";
import { Banknote, Check, ChevronDown, CircleEllipsis, CreditCard, ListFilter, Smartphone } from "lucide-react";
import { formatExact, inr } from "@/lib/money.mjs";
import { dayLabel, shortDate } from "@/lib/cycle.mjs";
import { methodLabel, methodShort, NOT_SET, parseMethodFilter, PAYMENT_METHODS } from "@/lib/paymentMethods.mjs";
import Reveal from "../ui/Reveal";
import { rateText } from "./popups/currency";
import { useDragScroll } from "../ui/useDragScroll";
import { CARD_H2, LINK_BUTTON, PILL_LIME, PILL_LINE, type Category, type Tx } from "./types";

const OPEN_KEY = "sf-ledger-open";
const METHOD_ICON = {
  upi: Smartphone,
  debit_card: CreditCard,
  credit_card: CreditCard,
  cash: Banknote,
  other: CircleEllipsis,
};
const nameOf = (k: string) => (k === "none" ? NOT_SET : methodLabel(k));

export default function Ledger({
  entries,
  byId,
  today,
  onEdit,
  onExport,
  onIncome,
  onExpense,
  alwaysOpen = false,
}: {
  entries: Tx[];
  byId: Map<string, Category>;
  today: string;
  onEdit: (t: Tx) => void;
  onExport: () => void;
  onIncome: () => void;
  onExpense: () => void;
  /** The phone Ledger page: always expanded, no collapse button. */
  alwaysOpen?: boolean;
}) {
  const [savedOpen, setOpen] = useState(true);
  const open = alwaysOpen || savedOpen;
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) !== "0");
    } catch {}
  }, []);
  const toggle = () => {
    setOpen(!savedOpen);
    try {
      localStorage.setItem(OPEN_KEY, savedOpen ? "0" : "1");
    } catch {}
  };

  // [] = everything; otherwise expenses paid any of these ways ("none" = Not set).
  const [filter, setFilter] = useState<string[]>([]);
  useEffect(() => setFilter(parseMethodFilter(new URLSearchParams(window.location.search).get("method"))), []);
  const pick = (next: string[]) => {
    setFilter(next);
    const url = new URL(window.location.href);
    if (next.length) url.searchParams.set("method", next.join(","));
    else url.searchParams.delete("method");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  };
  const dragScroll = useDragScroll<HTMLDivElement>();
  const expenses = entries.filter((t) => t.type === "expense");
  const methodOf = (t: Tx) => t.payment_method ?? "none";
  const filtering = filter.length > 0;
  const shown = filtering ? expenses.filter((t) => filter.includes(methodOf(t))) : entries;
  const spent = shown.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const n = shown.length,
    word = n === 1 ? "entry" : "entries";
  const days = [...new Set(shown.map((t) => t.date))].sort().reverse();

  const row = (t: Tx) => {
    const cat = t.category_id ? byId.get(t.category_id) : undefined;
    if (t.type === "expense")
      return { cat: t.category?.name ?? cat?.name ?? "Uncategorised", amt: `− ${inr(t.amount)}`, color: "var(--ink)" };
    if (t.type === "income")
      return {
        cat: t.counts_from ? `Income · counts from ${shortDate(t.counts_from)}` : "Income",
        amt: `+ ${inr(t.amount)}`,
        color: "var(--lime-text)",
      };
    if (t.type === "savings_transfer") return { cat: "Savings", amt: `→ ${inr(t.amount)}`, color: "var(--lime-text)" };
    return { cat: "Reserved", amt: `→ ${inr(t.amount)}`, color: "var(--muted)" };
  };

  return (
    <Reveal className="flex flex-col rounded-[18px] border border-line bg-tile p-6" style={{ transitionDelay: ".04s" }}>
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b"
        style={{ paddingBottom: open ? 10 : 0, borderColor: open ? "var(--line-2)" : "transparent" }}
      >
        <h2 className={CARD_H2}>
          {alwaysOpen ? (
            "Ledger"
          ) : (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls="ledger-body"
              className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 [font:inherit] text-inherit hover:text-lime-text"
            >
              Ledger
              <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line-2 text-ink-2">
                <ChevronDown
                  size={14}
                  className="transition-transform duration-200"
                  style={{ transform: `rotate(${open ? 180 : 0}deg)` }}
                />
              </span>
            </button>
          )}
        </h2>
        <span className="flex flex-wrap items-center gap-x-1 text-[13px] text-muted">
          {open
            ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"} this cycle`
            : `${n} ${word} · ${inr(spent)} spent this cycle`}{" "}
          ·{" "}
          <button type="button" onClick={onExport} className={LINK_BUTTON}>
            Export CSV
          </button>
        </span>
      </div>
      {open && (
        <div id="ledger-body" className="flex flex-col">
          {expenses.length > 0 && (
            <div
              role="group"
              aria-label="Filter by payment method"
              {...dragScroll}
              className="-mx-0.5 flex items-center gap-1.5 overflow-x-auto px-0.5 pt-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <ListFilter size={16} aria-hidden className="flex-none text-muted" />
              {[["", "All"] as const, ...PAYMENT_METHODS, ["none", NOT_SET] as const].map(([k, label]) => {
                const on = k ? filter.includes(k) : !filtering;
                const count = k ? expenses.filter((t) => methodOf(t) === k).length : 0;
                return (
                  <button
                    key={k || "all"}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      pick(!k ? [] : on ? filter.filter((x) => x !== k) : parseMethodFilter([...filter, k].join(",")))
                    }
                    className="flex h-[34px] flex-none cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,transform] duration-[250ms] active:scale-95 max-[720px]:h-10"
                    style={{
                      borderColor: on ? "var(--lime)" : "var(--line)",
                      background: on ? "var(--lime-soft)" : "transparent",
                      color: on ? "var(--ink)" : "var(--ink-2)",
                    }}
                  >
                    <span
                      aria-hidden
                      className="flex overflow-hidden transition-[width,opacity] duration-200"
                      style={{ width: on && k ? 12 : 0, opacity: on && k ? 1 : 0 }}
                    >
                      <Check size={12} className="flex-none" />
                    </span>
                    {label}
                    {k && (
                      <span className="tabular font-medium" style={{ color: on ? "var(--ink-2)" : "var(--muted)" }}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          {/* Re-keyed on each filter change, so the rows fade in afresh. */}
          <div
            key={filter.join(",")}
            className="flex flex-col"
            style={{ animation: "sf-rise .3s var(--ease-out-soft) both" }}
          >
            {filtering && n > 0 && (
              <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1.5 text-[13px] text-muted">
                <span className="tabular">
                  {n} of {expenses.length} expenses · {filter.map(nameOf).join(", ")} · {inr(spent)}
                </span>
                <button type="button" onClick={() => pick([])} className={LINK_BUTTON}>
                  Show all
                </button>
              </div>
            )}
            {days.map((date) => (
              <div key={date} className="flex flex-wrap gap-x-4 border-b border-line py-1.5">
                <span className="flex-[0_0_96px] pt-2.5 font-serif text-lg text-ink-2 italic">
                  {dayLabel(date, today)}
                </span>
                <div className="flex min-w-0 flex-[1_1_260px] flex-col">
                  {shown
                    .filter((t) => t.date === date)
                    .map((t) => {
                      const r = row(t);
                      const note = t.note || r.cat;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onEdit(t)}
                          aria-label={`Edit ${note}, ${r.amt}`}
                          className="-mx-2.5 flex w-[calc(100%+20px)] cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] border-0 bg-transparent p-2.5 text-left text-[15px] transition-colors duration-150 hover:bg-tile-2"
                        >
                          <span className="flex min-w-0 flex-[1_1_120px] items-center gap-2">{note}</span>
                          <span className="rounded-full bg-tile-2 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ink-2">
                            {r.cat}
                          </span>
                          {t.payment_method && <MethodChip method={t.payment_method} />}
                          {/* The base amount leads; what was paid sits under it, with the rate on hover. */}
                          <span className="ml-auto flex min-w-20 flex-col items-end">
                            <span className="tabular font-semibold whitespace-nowrap" style={{ color: r.color }}>
                              {r.amt}
                            </span>
                            {t.original_currency && (
                              <span
                                title={`Rate used: ${rateText(Number(t.fx_rate), t.original_currency)}`}
                                className="tabular text-xs whitespace-nowrap text-muted"
                              >
                                {formatExact(Number(t.original_amount), t.original_currency)}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
            {n === 0 && filtering && (
              <p className="m-0 pt-3.5 pb-1.5 font-serif text-xl text-pretty text-ink-2 italic">
                Nothing paid with {filter.map(nameOf).join(" or ")} this cycle.
              </p>
            )}
            {n === 0 && !filtering && (
              <div className="flex flex-col items-start gap-3 pt-[22px] pb-1.5">
                <p className="m-0 font-serif text-[22px] text-pretty text-ink-2 italic">
                  No entries this cycle. Record your salary first, then log spending as it happens.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={onIncome} className={`${PILL_LINE} h-10 px-4`}>
                    Record income
                  </button>
                  <button type="button" onClick={onExpense} className={`${PILL_LIME} h-10 px-4`}>
                    Log expense
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Reveal>
  );
}

/** Outlined chip after the category chip: icon and short name (UPI, Debit, Credit, Cash, Other). */
function MethodChip({ method }: { method: keyof typeof METHOD_ICON }) {
  const Icon = METHOD_ICON[method];
  return (
    <span
      title={`Paid with ${methodLabel(method)}`}
      className="inline-flex items-center gap-1 rounded-full border border-line-2 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted"
    >
      <Icon size={11} aria-hidden />
      {methodShort(method)}
    </span>
  );
}
