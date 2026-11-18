"use client";

// Building blocks shared by the dashboard popups (design handoff, Popups).

import { useState, type ReactNode } from "react";
import { Repeat, Trash2, TriangleAlert } from "lucide-react";
import { inr } from "@/lib/money.mjs";

export const FIELD =
  "h-12 w-full min-w-0 rounded-xl border border-line-2 bg-tile-2 px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";
export const SAVE_FAILED = "Couldn’t save. Check your connection and try again. Nothing was changed.";
export const OFFLINE = "You’re offline, so this wasn’t saved. Reconnect and try again.";

/** Rupees typed into a field -> paise (0 when blank or invalid). */
export const paise = (v: string) => Math.round((parseFloat(v.replace(/[^\d.]/g, "")) || 0) * 100);
/** Keep digits and one decimal point with at most 2 decimals. */
export const cleanAmount = (v: string) => {
  let x = v.replace(/[^\d.]/g, "");
  const i = x.indexOf(".");
  if (i >= 0)
    x =
      x.slice(0, i + 1) +
      x
        .slice(i + 1)
        .replace(/\./g, "")
        .slice(0, 2);
  return x.slice(0, 9);
};
/** Day-of-month field: digits only, up to 2. */
export const cleanDay = (v: string) => v.replace(/\D/g, "").slice(0, 2);
/** Paise -> the plain rupee string a field shows ("1200", "99.5"). */
export const toField = (p: number) => String(Math.round(p) / 100);

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
    if (error) return setError(SAVE_FAILED);
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

/** The big ₹ amount input at the top of a popup. */
export function AmountField({
  id,
  value,
  onChange,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="eyebrow">
        Amount
      </label>
      <div className="flex items-baseline gap-1.5 border-b-[1.5px] border-line-2 pb-1.5 transition-colors duration-200 focus-within:border-lime">
        <span className="font-serif text-[44px] leading-none text-muted">₹</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          placeholder="0"
          value={value}
          onChange={(e) => onChange(cleanAmount(e.target.value))}
          className="tabular w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-[clamp(48px,13vw,64px)] leading-[1.05] tracking-[-0.02em] text-ink outline-none focus-visible:outline-none"
        />
      </div>
      {children}
    </div>
  );
}

/** On/off switch row ("Repeat every month", "Pay from annual bills reserve"). */
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
