"use client";

// Ledger (design handoff): this cycle's entries grouped by day; collapsible, state remembered.

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatExact, inr } from "@/lib/money.mjs";
import { dayLabel, shortDate } from "@/lib/cycle.mjs";
import { methodLabel, NOT_RECORDED, PAYMENT_METHODS } from "@/lib/paymentMethods.mjs";
import Reveal from "../ui/Reveal";
import { CARD_H2, LINK_BUTTON, PILL_LIME, PILL_LINE, type Category, type Tx } from "./types";

const OPEN_KEY = "sf-ledger-open";

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

  // "" = everything; "none" = expenses with no method; otherwise expenses paid that way.
  const [method, setMethod] = useState("");
  const shown = method
    ? entries.filter((t) => t.type === "expense" && (t.payment_method ?? "none") === method)
    : entries;
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
          {open && entries.some((t) => t.type === "expense") && (
            <select
              aria-label="Show expenses paid with"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="mr-2 h-[34px] cursor-pointer rounded-full border border-line-2 bg-transparent px-3 text-[13px] font-semibold text-ink"
            >
              <option value="">All entries</option>
              {PAYMENT_METHODS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
              <option value="none">{NOT_RECORDED}</option>
            </select>
          )}
          {open
            ? `${n} ${word}${method ? ` · ${inr(spent)}` : ""} this cycle`
            : `${n} ${word} · ${inr(spent)} spent this cycle`}{" "}
          ·{" "}
          <button type="button" onClick={onExport} className={LINK_BUTTON}>
            Export CSV
          </button>
        </span>
      </div>
      {open && (
        <div id="ledger-body" className="flex flex-col">
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
                        {t.original_currency && (
                          <span className="tabular text-xs whitespace-nowrap text-muted">
                            {formatExact(Number(t.original_amount), t.original_currency)}
                          </span>
                        )}
                        {t.payment_method && (
                          <span className="rounded-full border border-line-2 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted">
                            {methodLabel(t.payment_method)}
                          </span>
                        )}
                        <span
                          className="tabular ml-auto min-w-20 text-right font-semibold whitespace-nowrap"
                          style={{ color: r.color }}
                        >
                          {r.amt}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          {n === 0 && method && (
            <p className="m-0 pt-[22px] pb-1.5 font-serif text-[22px] text-ink-2 italic">
              No expenses {method === "none" ? "without a payment method" : `paid with ${methodLabel(method)}`} this
              cycle.
            </p>
          )}
          {n === 0 && !method && (
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
      )}
    </Reveal>
  );
}
