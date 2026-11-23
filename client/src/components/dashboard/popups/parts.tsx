"use client";

// Building blocks shared by the dashboard popups (design handoff, Popups).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Repeat, Trash2, TriangleAlert } from "lucide-react";
import {
  baseCurrency,
  cleanTyped,
  CURRENCIES,
  currencySymbol,
  inr,
  showTyped,
  toMajor,
  toMinor,
} from "@/lib/money.mjs";
import { convert, fetchRate } from "@/lib/fx.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/paymentMethods.mjs";

export const FIELD =
  "h-12 w-full min-w-0 rounded-xl border border-line-2 bg-tile-2 px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";
export const SAVE_FAILED = "Couldn’t save. Check your connection and try again. Nothing was changed.";
export const OFFLINE = "You’re offline, so this wasn’t saved. Reconnect and try again.";

/** An amount typed into a field -> minor units of the base currency (0 when blank or invalid). */
export const paise = (v: string) => toMinor(parseFloat(v.replace(/[^\d.]/g, "")) || 0);
/** What was typed (in the user's number format) -> "1234.5". Show it back with showTyped. */
export const cleanAmount = (v: string) => cleanTyped(v);
/** Day-of-month field: digits only, up to 2. */
export const cleanDay = (v: string) => v.replace(/\D/g, "").slice(0, 2);
/** Minor units -> the plain string a field shows ("1200", "99.5"). */
export const toField = (p: number) => String(toMajor(Math.round(p)));

/** Form state for a popup: values, dirty flag, inline error and the busy save. */
export function usePopupForm<T extends object>(initial: T) {
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<T>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setError(null);
  };
  /** Runs a write; on failure shows the handoff's inline error and keeps the popup open. */
  const save = async (
    write: () => PromiseLike<{ error: unknown; data?: unknown }>,
    done: (data: unknown) => void | Promise<void>,
  ) => {
    if (!navigator.onLine) return setError(OFFLINE);
    setBusy(true);
    const { error, data } = await write();
    setBusy(false);
    if (error) {
      reportClientError("popup_save_failed", { source: "usePopupForm", ...errorFields(error) });
      return setError(SAVE_FAILED);
    }
    await done(data);
  };
  return { form, set, dirty, error, setError, busy, save };
}

export function Labeled({
  id,
  label,
  optional,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <label htmlFor={id} className="eyebrow">
        {label}
        {optional && <span className="font-normal tracking-normal normal-case"> · optional</span>}
      </label>
      {children}
    </div>
  );
}

/** The big amount input at the top of a popup. */
export function AmountField({
  id,
  value,
  onChange,
  currency,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** Typed in this currency (symbol and decimals); defaults to the base currency. */
  currency?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="eyebrow">
        Amount
      </label>
      <div className="flex items-baseline gap-1.5 border-b-[1.5px] border-line-2 pb-1.5 transition-colors duration-200 focus-within:border-lime">
        <span className="font-serif text-[44px] leading-none text-muted">{currencySymbol(currency)}</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0"
          value={showTyped(value)}
          onChange={(e) => onChange(cleanTyped(e.target.value, undefined, currency))}
          className="tabular w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-[clamp(48px,13vw,64px)] leading-[1.05] tracking-[-0.02em] text-ink outline-none focus-visible:outline-none"
        />
      </div>
      {children}
    </div>
  );
}

/** On/off switch row ("Repeat every month", "Pay from annual bills reserve"). */
type Original = {
  original_amount: number | null;
  original_currency: string | null;
  fx_rate: number | null;
  fx_date: string | null;
};
const PLAIN: Original = { original_amount: null, original_currency: null, fx_rate: null, fx_date: null };

/**
 * The currency an amount is typed in and, when it isn't the base currency, the rate for the
 * cycle starting `cycleStart` (fetched once, editable when the rates service is down).
 * `initial` is a saved foreign row: its rate is kept, not fetched again.
 */
export function useForeign(cycleStart: string, initial?: { currency: string; rate: number } | null) {
  const [currency, setCurrency] = useState(initial?.currency ?? baseCurrency());
  const [rate, setRate] = useState(initial ? String(initial.rate) : "");
  const [note, setNote] = useState<string | null>(null);
  // A saved row's rate is kept while its own currency stays picked.
  const kept = useRef(initial ?? null);
  const foreign = currency !== baseCurrency();
  useEffect(() => {
    if (!foreign || currency === kept.current?.currency) return;
    let live = true;
    setRate("");
    setNote("Getting this cycle’s rate…");
    fetchRate(currency, cycleStart).then(
      (r) => {
        if (!live) return;
        setRate(String(r.rate));
        setNote(
          r.stale
            ? `The rates service is down, so this is the rate from ${shortDate(r.date)}. Change it if you need to.`
            : `The rate on ${shortDate(cycleStart)}, when this cycle started. It stays the same all cycle.`,
        );
      },
      (e: Error) => live && setNote(e.message),
    );
    return () => {
      live = false;
    };
  }, [currency, cycleStart]);

  const r = parseFloat(rate);
  /** What was typed -> the base amount to save, plus the original fields (all null when in base). */
  const toBase = (typed: string): { amount: number; original: Original } => {
    const minor = toMinor(parseFloat(typed) || 0, currency);
    if (!foreign) return { amount: minor, original: PLAIN };
    return {
      amount: r > 0 ? convert(minor, currency, r) : 0,
      original: { original_amount: minor, original_currency: currency, fx_rate: r, fx_date: cycleStart },
    };
  };
  /** Starts over from a saved row (or the base currency), for a form reused across rows. */
  const load = (saved?: { currency: string; rate: number } | null) => {
    kept.current = saved ?? null;
    setCurrency(saved?.currency ?? baseCurrency());
    setRate(saved ? String(saved.rate) : "");
    setNote(null);
  };
  return { currency, setCurrency, foreign, rate, setRate, rateOk: !foreign || r > 0, note, toBase, load };
}

/** Currency picker, and the rate when the currency is foreign. Lives in a popup's field grid. */
export function CurrencyFields({
  id,
  fx,
  onCurrency,
}: {
  id: string;
  fx: ReturnType<typeof useForeign>;
  /** Called after the currency changes (e.g. to clear a typed amount). */
  onCurrency?: () => void;
}) {
  return (
    <>
      <Labeled id={`${id}-cur`} label="Currency">
        <select
          id={`${id}-cur`}
          value={fx.currency}
          onChange={(e) => {
            fx.setCurrency(e.target.value);
            onCurrency?.();
          }}
          className={FIELD}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c === baseCurrency() ? `${c} · your currency` : c}
            </option>
          ))}
        </select>
      </Labeled>
      {fx.foreign && (
        <Labeled id={`${id}-rate`} label={`${currencySymbol()} for 1 ${fx.currency}`}>
          <input
            id={`${id}-rate`}
            type="text"
            inputMode="decimal"
            value={fx.rate}
            onChange={(e) => fx.setRate(e.target.value.replace(/[^\d.]/g, "").slice(0, 14))}
            className={`${FIELD} tabular`}
            aria-describedby={`${id}-rate-note`}
          />
          {fx.note && (
            <span id={`${id}-rate-note`} className="text-[13px] text-pretty text-muted">
              {fx.note}
            </span>
          )}
        </Labeled>
      )}
    </>
  );
}

/** "Paid with" picker for expenses (tracking only). Empty = not recorded. */
export function MethodSelect({
  id,
  value,
  onChange,
  label = "Paid with",
}: {
  id: string;
  value: PaymentMethod | null | undefined;
  onChange: (v: PaymentMethod | null) => void;
  label?: string;
}) {
  return (
    <Labeled id={id} label={label} optional>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as PaymentMethod | null)}
        className={FIELD}
      >
        <option value="">Not recorded</option>
        {PAYMENT_METHODS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </Labeled>
  );
}

export function SwitchRow({
  title,
  sub,
  on,
  onToggle,
  children,
}: {
  title: string;
  sub?: string;
  on: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-[14px] border border-line px-4 py-3.5">
      <div className="flex items-center gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{title}</span>
          {sub && <span className="text-[13px] text-muted">{sub}</span>}
        </div>
        <Switch on={on} onToggle={onToggle} label={title} />
      </div>
      {children && (
        <div
          className="grid transition-[grid-template-rows] duration-300 ease-soft"
          style={{ gridTemplateRows: on ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">{children}</div>
        </div>
      )}
    </div>
  );
}

export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className="relative h-[26px] w-11 flex-none cursor-pointer rounded-full border-0 transition-colors duration-200"
      style={{ background: on ? "var(--lime)" : "var(--line-2)" }}
    >
      <span
        className="absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-ink transition-transform duration-200 [transition-timing-function:cubic-bezier(.3,1.4,.5,1)]"
        style={{ transform: `translateX(${on ? 18 : 0}px)` }}
      />
    </button>
  );
}

/** "Due on day" field shown under "Repeat every month". */
export function DueDayField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3.5">
      <label htmlFor={id} className="text-sm text-ink-2">
        Due on day
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        maxLength={2}
        placeholder="1–28"
        value={value}
        onChange={(e) => onChange(cleanDay(e.target.value))}
        className="h-10 w-[76px] rounded-[10px] border border-line-2 bg-tile-2 px-3 text-center text-[15px] text-ink outline-none focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none"
      />
      <span className="basis-full text-[13px] text-pretty text-muted">
        Leave blank to only get it suggested. With a day set, it shows as due on that day. It’s only added when you tap
        Record.
      </span>
    </div>
  );
}

export type Note = { text: string; tone: "warn" | "danger" };
export type PreviewProps = {
  label: string;
  value: string;
  line: string;
  sub?: string;
  danger?: boolean;
  notes?: Note[];
};

/** "Safe to spend after" panel at the bottom of a popup. */
export function Preview({ label, value, line, sub, danger, notes = [] }: PreviewProps) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3 rounded-2xl bg-tile-2 px-5 py-[18px]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="eyebrow">{label}</span>
        {sub && <span className="tabular text-[13px] text-muted">{sub}</span>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <span
          className="tabular font-serif text-[44px] leading-none transition-colors duration-300"
          style={{ color: danger ? "var(--danger)" : "var(--ink)" }}
        >
          {value}
        </span>
        <span className="font-serif text-[19px] text-ink-2">{line}</span>
      </div>
      {notes.map((n) => (
        <div
          key={n.text}
          className="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold"
          style={{ background: `var(--${n.tone}-soft)`, color: `var(--${n.tone})` }}
        >
          <TriangleAlert size={14} className="mt-0.5 flex-none" />
          <span className="text-pretty">{n.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Preview of safe to spend after a change, with the handoff's wording. */
export function safeAfterPreview(
  after: number,
  before: number,
  daysLeft: number,
  savingsTarget: number,
  label = "Safe to spend after",
): PreviewProps {
  return {
    label,
    value: inr(after),
    line: after > 0 ? `${inr(after / daysLeft)} a day for ${daysLeft} days` : "nothing left to spend this cycle",
    sub: `was ${inr(before)}`,
    danger: after < 0,
    notes:
      after < 0
        ? [{ text: `Dips ${inr(-after)} into your ${inr(savingsTarget)} savings target.`, tone: "danger" }]
        : [],
  };
}

export type Suggestion = { id: string; name: string; amount: number; when: string; recorded: boolean };

/** Recurring quick-picks at the top of Log expense / Record income, each with a Stop. */
export function Suggestions({
  items,
  selected,
  onPick,
  onStop,
  icon = false,
}: {
  items: Suggestion[];
  selected: string | null;
  onPick: (id: string) => void;
  onStop: (id: string) => void;
  icon?: boolean;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      <span className="eyebrow">Recurring</span>
      <div className="flex flex-col gap-1.5">
        {items.map((s) => (
          <div key={s.id} className="flex gap-1.5" data-testid="recurring-suggestion" data-name={s.name}>
            {asking === s.id ? (
              <div
                role="alertdialog"
                aria-label={`Stop repeating ${s.name}`}
                className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-danger bg-danger-soft px-3.5 py-2 text-[13px]"
              >
                <span className="flex-[1_1_180px]">Stop repeating {s.name}? Past entries are kept.</span>
                <button
                  type="button"
                  onClick={() => {
                    setAsking(null);
                    onStop(s.id);
                  }}
                  className="h-8 cursor-pointer rounded-full border-0 bg-danger px-3 text-[13px] font-bold text-danger-ink"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(null)}
                  className="h-8 cursor-pointer border-0 bg-transparent px-2.5 text-[13px] font-semibold text-ink-2"
                >
                  Keep
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  disabled={s.recorded}
                  onClick={() => onPick(s.id)}
                  aria-pressed={selected === s.id}
                  className="flex min-h-11 min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-xl border border-dashed px-3.5 py-1.5 text-left text-[13px] font-semibold transition-colors duration-200 disabled:cursor-default"
                  style={{
                    borderColor: selected === s.id ? "var(--lime)" : "var(--line-2)",
                    background: selected === s.id ? "var(--lime-soft)" : "transparent",
                    opacity: s.recorded ? 0.5 : 1,
                  }}
                >
                  {icon && <Repeat size={13} className="flex-none" />}
                  <span>{s.name}</span>
                  <span className="tabular">{inr(s.amount)}</span>
                  <span className="ml-auto font-serif text-[15px] font-normal text-muted italic">{s.when}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(s.id)}
                  aria-label={`Stop repeating ${s.name}`}
                  className="flex w-11 flex-none cursor-pointer items-center justify-center rounded-xl border border-line bg-transparent text-muted hover:border-danger hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Bottom-sheet header for Add (design handoff v3, Mobile): Expense | Income tabs replace the
 * title. Switching keeps the amount (the parent reopens the other popup with it).
 */
export function AddTabs({ current, onSwitch }: { current: "expense" | "income"; onSwitch: () => void }) {
  return (
    <div
      role="tablist"
      aria-label="Entry type"
      className="flex h-11 min-w-0 flex-1 gap-0.5 rounded-full border border-line p-[3px]"
    >
      {(
        [
          ["expense", "Expense"],
          ["income", "Income"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={current === k}
          onClick={() => k !== current && onSwitch()}
          className="min-w-0 flex-1 cursor-pointer rounded-full border-0 text-sm font-semibold transition-colors duration-200"
          style={{
            background: current === k ? "var(--ink)" : "transparent",
            color: current === k ? "var(--bg)" : "var(--muted)",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
