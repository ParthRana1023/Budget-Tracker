"use client";

// Multicurrency controls (design handoff v3, Currency): the currency chip at the end of an
// amount row, the searchable currency list it opens inline, and the rate line under the amount.

import { useMemo, useState, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import { Check, ChevronDown, Loader, TriangleAlert } from "lucide-react";
import { baseCurrency, CURRENCIES, currencySymbol, formatExact, formatMoney, inr, toMinor } from "@/lib/money.mjs";
import { convert } from "@/lib/fx.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import type { useForeign } from "./parts";

type Fx = ReturnType<typeof useForeign>;

const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "currency" });
  } catch {
    return null;
  }
})();
/** "US Dollar" for "USD". @param {string} code */
export const currencyName = (code: string) => names?.of(code) ?? code;

/** Suggested first (design handoff: base, USD, EUR, GBP, AED), keeping only supported ones. */
const suggested = () =>
  [...new Set([baseCurrency(), "USD", "EUR", "GBP", "AED"])].filter((c) => CURRENCIES.includes(c));

/** Code + chevron pill; lime when foreign. 40px beside the big amount, 48px beside a field. */
export function CurrencyChip({
  currency,
  open,
  onToggle,
  size = 40,
  label,
}: {
  currency: string;
  open: boolean;
  onToggle: () => void;
  size?: 40 | 48;
  /** Accessible name, e.g. "Currency" or "Groceries currency". */
  label?: string;
}) {
  const foreign = currency !== baseCurrency();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={`${label ?? "Currency"}: ${currency}`}
      className={clsx(
        "flex flex-none cursor-pointer items-center gap-1.5 border px-3.5 text-sm font-bold transition-colors duration-200",
        size === 40 ? "h-10 rounded-full" : "h-12 rounded-xl",
      )}
      style={{
        borderColor: foreign ? "var(--lime)" : "var(--line-2)",
        background: foreign ? "var(--lime-soft)" : "transparent",
      }}
    >
      {currency}
      <ChevronDown
        size={15}
        aria-hidden
        className="transition-transform duration-200"
        style={{ transform: open ? "rotate(180deg)" : undefined }}
      />
    </button>
  );
}

/** The list a chip opens: search by code, name or symbol; Enter picks the first match, Esc closes. */
export function CurrencyList({
  value,
  onPick,
  onClose,
  maxHeight = 252,
}: {
  value: string;
  onPick: (code: string) => void;
  onClose: () => void;
  maxHeight?: number;
}) {
  const [q, setQ] = useState("");
  const qq = q.trim().toLowerCase();
  const match = (c: string) =>
    !qq ||
    c.toLowerCase().includes(qq) ||
    currencyName(c).toLowerCase().includes(qq) ||
    currencySymbol(c).toLowerCase().includes(qq);
  const groups = useMemo(() => {
    const top = suggested().filter(match);
    const rest = CURRENCIES.filter((c: string) => match(c) && (qq || !top.includes(c)));
    return qq ? [["Matches", rest] as const] : [["Suggested", top] as const, ["All currencies", rest] as const];
  }, [qq]);
  const first = groups.flatMap(([, list]) => list)[0];
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // closes the list, not the popup
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (first) onPick(first);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-tile-2">
      <input
        type="search"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="Search by code, name or symbol"
        aria-label="Search currencies"
        className="h-12 border-0 border-b border-line bg-transparent px-4 text-[15px] text-ink outline-none focus-visible:outline-none"
      />
      <div
        role="listbox"
        aria-label="Currencies"
        className="flex flex-col overflow-y-auto overscroll-contain"
        style={{ maxHeight }}
      >
        {groups.map(([title, list]) =>
          list.length ? (
            <div key={title} className="flex flex-col">
              <span className="eyebrow px-4 pt-3 pb-1">{title}</span>
              {list.map((c: string) => {
                const on = c === value;
                return (
                  <button
                    key={c}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => onPick(c)}
                    className="flex min-h-12 cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left hover:bg-tile"
                  >
                    <span className="w-11 flex-none text-sm font-bold">{c}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-2">{currencyName(c)}</span>
                    <span className="tabular text-[13px] text-muted">
                      {formatMoney(toMinor(1234.5, c), undefined, c)}
                    </span>
                    <Check size={15} aria-hidden className={clsx("flex-none text-lime-text", !on && "invisible")} />
                  </button>
                );
              })}
            </div>
          ) : null,
        )}
        {!groups.some(([, list]) => list.length) && (
          <span className="px-4 py-4 text-sm text-muted">No currency matches “{q.trim()}”.</span>
        )}
      </div>
    </div>
  );
}

/**
 * How a rate reads: "₹83.70", or per 100 units when below 1 ("₹55.71 per ¥100").
 * @param rate base units per 1 unit of `code`
 */
export function rateText(rate: number, code: string) {
  return rate >= 1
    ? formatExact(toMinor(rate), baseCurrency())
    : `${formatExact(toMinor(rate * 100), baseCurrency())} per ${formatExact(toMinor(100, code), code)}`;
}

/**
 * The line under a foreign amount: loading, ready ("$12.00 = ₹1,004.00 at ₹83.70"), stale, error
 * (Try again / Enter rate) and, for entries, your own rate. `ownRate` is off for bills, budgets and
 * goals: their base figure is worked out again each cycle.
 */
export function RateLine({
  fx,
  typed,
  cycleStart,
  ownRate = false,
  id,
}: {
  fx: Fx;
  /** What was typed in the foreign currency, e.g. "12". */
  typed: string;
  cycleStart: string;
  ownRate?: boolean;
  id: string;
}) {
  if (!fx.foreign) return null;
  const cur = fx.currency;
  const r = parseFloat(fx.rate);
  const minor = toMinor(parseFloat(typed) || 0, cur);
  const shownOriginal = minor > 0 ? minor : toMinor(r >= 1 || !(r > 0) ? 1 : 100, cur);
  const sentence =
    r > 0 ? `${formatExact(shownOriginal, cur)} = ${inr(convert(shownOriginal, cur, r))} at ${rateText(r, cur)}` : "";
  const box = "flex flex-col gap-1.5 rounded-xl px-3.5 py-3";
  const link =
    "relative cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-ink-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:text-ink";

  if (fx.status === "loading")
    return (
      <div role="status" aria-live="polite" className={`${box} bg-tile-2`}>
        <span className="flex items-center gap-2 text-sm text-ink-2">
          <Loader size={14} aria-hidden className="animate-spin" />
          Getting this cycle’s rate…
        </span>
        <span aria-hidden className="h-1 overflow-hidden rounded-full bg-track">
          <span className="block h-full w-1/3 animate-pulse rounded-full bg-line-2" />
        </span>
      </div>
    );

  if (fx.status === "error")
    return (
      <div role="status" aria-live="polite" className={`${box} bg-warn-soft`}>
        <span className="flex items-center gap-2 text-sm font-semibold text-warn">
          <TriangleAlert size={14} aria-hidden />
          Couldn’t get this cycle’s rate.
        </span>
        <span className="text-[13px] text-ink-2">Try again, or enter the rate yourself. Saving waits for one.</span>
        <span className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={fx.retry}
            className="h-10 cursor-pointer rounded-full border border-line-2 bg-tile px-4 text-[13px] font-semibold hover:border-ink-2"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => fx.setManual(true)}
            className="h-10 cursor-pointer rounded-full border border-line-2 bg-tile px-4 text-[13px] font-semibold hover:border-ink-2"
          >
            Enter rate
          </button>
        </span>
      </div>
    );

  if (fx.status === "manual")
    return (
      <div aria-live="polite" className={`${box} bg-tile-2`}>
        {sentence && <span className="tabular text-sm font-semibold">{sentence}</span>}
        <label htmlFor={`${id}-rate`} className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          {formatExact(toMinor(1, cur), cur)} = {currencySymbol()}
          <input
            id={`${id}-rate`}
            type="text"
            inputMode="decimal"
            autoFocus
            aria-label={`${currencySymbol()} for 1 ${cur}`}
            value={fx.rate}
            onChange={(e) => fx.setRate(e.target.value.replace(/[^\d.]/g, "").slice(0, 14))}
            className="tabular h-11 w-32 rounded-xl border border-line-2 bg-tile px-3 text-[15px] text-ink outline-none focus:border-lime focus-visible:outline-none"
          />
        </label>
        <span className="text-[13px] text-muted">
          {ownRate ? "Your own rate, for this entry only." : "Used until the next cycle’s rate comes in."}
          {fx.cycleRate && (
            <>
              {" "}
              <button type="button" onClick={() => fx.setManual(false)} className={link}>
                Use this cycle’s rate
              </button>
            </>
          )}
        </span>
      </div>
    );

  // ready / stale
  return (
    <div role="status" aria-live="polite" className={`${box} bg-tile-2`}>
      <span className="tabular text-sm font-semibold">{sentence}</span>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
        {fx.status === "stale" ? (
          <span className="text-warn">
            Last known rate, from {shortDate(fx.rateDate ?? cycleStart)}. The rates service is down.
          </span>
        ) : (
          <span className="text-muted">
            {ownRate ? "Rate locked for this cycle" : "This cycle’s rate"}, from {shortDate(fx.rateDate ?? cycleStart)}
            {ownRate ? "" : ". Worked out again each cycle."}
          </span>
        )}
        {ownRate && (
          <button type="button" onClick={() => fx.setManual(true)} className={link}>
            Use my own rate
          </button>
        )}
      </span>
    </div>
  );
}
