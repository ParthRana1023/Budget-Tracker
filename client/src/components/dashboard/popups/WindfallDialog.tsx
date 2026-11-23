"use client";

// Bonus split / "Allocate windfall" (design handoff, Popups): an expected payment arrives
// and is split across a savings goal, the annual bills reserve and this cycle's spending.

import { createClient } from "@/utils/supabase/client";
import { currencySymbol, inr, showTyped } from "@/lib/money.mjs";
import { dayLabel } from "@/lib/cycle.mjs";
import Dialog from "../../ui/Dialog";
import type { PopupContext } from "./context";
import { Preview, SAVE_FAILED, cleanAmount, paise, toField, usePopupForm } from "./parts";

const PRESETS: Array<[number, number, number, string, string]> = [
  [0.5, 0.3, 0.2, "50 / 30 / 20", "Save, bills, spend"],
  [0.8, 0.1, 0.1, "80% savings", "Grow savings fast"],
  [1, 0, 0, "All to savings", "Nothing to spend"],
];
const AMOUNT_INPUT =
  "tabular h-[42px] w-[130px] rounded-[10px] border border-line-2 bg-tile-2 px-3 text-right text-[15px] font-semibold text-ink outline-none focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";

export default function WindfallDialog({
  ctx,
  incomeId,
  onClose,
}: {
  ctx: PopupContext;
  incomeId: string;
  onClose: () => void;
}) {
  const { model, today, period } = ctx;
  const openGoals = ctx.goals; // the select lists every goal; finished ones are marked
  const split = (total: number, [a, b]: [number, number]) => {
    const s = Math.round(total * a),
      r = Math.round(total * b);
    return { s: toField(s), a: toField(r), d: toField(total - s - r) };
  };
  const first = ctx.held.find((h) => h.id === incomeId) ?? ctx.held[0];
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    id: first?.id ?? "",
    goalId: openGoals[0]?.id ?? "",
    ...split(Number(first?.amount ?? 0), [0.5, 0.3]),
  });
  const h = ctx.held.find((x) => x.id === form.id);
  if (!h) return null;
  const total = Number(h.amount);
  const S = paise(form.s),
    A = paise(form.a),
    D = paise(form.d),
    rem = total - S - A - D;
  const pct = (v: number) => `${(total ? Math.min(100, (v / total) * 100) : 0).toFixed(2)}%`;

  const submit = () => {
    if (rem !== 0) return setError(`The three amounts need to add up to ${inr(total)}.`);
    if (S > 0 && !form.goalId) return setError("Pick a goal for the savings part.");
    save(
      () =>
        createClient().rpc("allocate_windfall", {
          p_income_id: h.id,
          p_goal_id: S > 0 ? form.goalId : null,
          p_savings: S,
          p_total: total,
          p_date: today,
          p_note: h.name,
          p_reserve: A,
        }),
      async () => {
        onClose();
        await ctx.saved(`Allocated ${inr(total)} · ${inr(D)} added to safe to spend`);
      },
    );
  };

  const after = model.safe + D;
  const row = (dot: string, title: string, sub: string, value: string, onChange: (v: string) => void, aria: string) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span
        className="h-2.5 w-2.5 flex-none rounded-full"
        style={{
          background: dot === "dashed" ? "transparent" : dot,
          border: dot === "dashed" ? "1.5px dashed var(--ink-2)" : undefined,
        }}
      />
      <span className="flex flex-[1_1_140px] flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-[13px] text-muted">{sub}</span>
      </span>
      <span className="flex flex-none items-center gap-1.5">
        <span className="text-muted">{currencySymbol()}</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={aria}
          value={showTyped(value)}
          onChange={(e) => onChange(cleanAmount(e.target.value))}
          className={AMOUNT_INPUT}
        />
      </span>
    </div>
  );

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`${h.name} · ${inr(total)}`}
      title="Allocate windfall"
      size="lg"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : "Confirm & allocate"}
    >
      {ctx.held.length > 1 && (
        <div className="flex flex-col gap-2.5">
          <span className="eyebrow">Which payment arrived?</span>
          {ctx.held.map((x) => {
            const sel = x.id === form.id;
            return (
              <button
                key={x.id}
                type="button"
                aria-pressed={sel}
                onClick={() => set({ id: x.id, ...split(Number(x.amount), [0.5, 0.3]) })}
                className="flex cursor-pointer flex-wrap justify-between gap-x-3 gap-y-1 rounded-xl border px-3.5 py-3 text-left"
                style={{
                  borderColor: sel ? "var(--lime)" : "var(--line)",
                  background: sel ? "var(--lime-soft)" : "transparent",
                }}
              >
                <span className="font-semibold">{x.name}</span>
                <span className="tabular text-[13px] text-muted">
                  {inr(x.amount)}
                  {x.expected_date ? ` · expected ${dayLabel(x.expected_date, today)}` : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">Quick split</span>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-1.5">
          {PRESETS.map(([a, b, c, label, sub]) => {
            const sel =
              S === Math.round(total * a) &&
              A === Math.round(total * b) &&
              D === total - Math.round(total * a) - Math.round(total * b) &&
              c >= 0;
            return (
              <button
                key={label}
                type="button"
                onClick={() => set(split(total, [a, b]))}
                className="flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3.5 py-3 text-left transition-colors duration-200 active:scale-[.97]"
                style={{
                  borderColor: sel ? "var(--lime)" : "var(--line)",
                  background: sel ? "var(--lime-soft)" : "transparent",
                  boxShadow: sel ? "inset 0 0 0 1px var(--lime)" : "none",
                }}
              >
                <span className="font-serif text-[22px] leading-[1.1]">{label}</span>
                <span className="text-xs text-muted">{sub}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col rounded-[14px] border border-line">
        <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3.5">
          {row(
            "var(--lime)",
            "Savings goal",
            "Moves straight to a goal",
            form.s,
            (v) => set({ s: v }),
            "Amount to savings",
          )}
          <select
            aria-label="Goal to credit"
            value={form.goalId}
            onChange={(e) => set({ goalId: e.target.value })}
            className="h-[42px] w-full min-w-0 rounded-xl border border-line-2 bg-tile-2 px-3.5 text-[15px] text-ink outline-none focus:border-lime"
          >
            {openGoals.length === 0 && <option value="">No goals yet</option>}
            {openGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="border-b border-line px-4 py-3.5">
          {row(
            "var(--fixed)",
            "Annual & irregular bills",
            "Insurance premiums, taxes, car service",
            form.a,
            (v) => set({ a: v }),
            "Amount to annual bills",
          )}
        </div>
        <div className="px-4 py-3.5">
          {row(
            "dashed",
            "Spend this cycle",
            "Added to safe to spend",
            form.d,
            (v) => set({ d: v }),
            "Amount to spend this cycle",
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div aria-hidden className="flex h-3 gap-[3px] overflow-hidden rounded-md bg-track">
          <span
            className="rounded transition-[width] duration-500 ease-soft"
            style={{ width: pct(S), background: "var(--lime)" }}
          />
          <span
            className="rounded transition-[width] duration-500 ease-soft"
            style={{ width: pct(A), background: "var(--fixed)" }}
          />
          <span
            className="rounded transition-[width] duration-500 ease-soft"
            style={{ width: pct(D), background: "var(--ink-2)" }}
          />
        </div>
        <span
          className="tabular text-[13px] font-semibold"
          style={{ color: rem === 0 ? "var(--lime-text)" : "var(--warn)" }}
        >
          {inr(S + A + D)} of {inr(total)} allocated
        </span>
      </div>
      <Preview
        label="Safe to spend after"
        value={inr(after)}
        line={`${inr(Math.max(0, after) / period.daysRemaining)} a day for ${period.daysRemaining} days`}
        sub={`+${inr(D)} from this windfall`}
        notes={
          rem
            ? [{ text: rem > 0 ? `${inr(rem)} still to allocate.` : `Over-allocated by ${inr(-rem)}.`, tone: "warn" }]
            : []
        }
      />
    </Dialog>
  );
}
