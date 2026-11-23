"use client";

// Goals card and its popups (design handoff: Add to goal, New goal, Edit goal, Delete goal).

import { useState, type ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { cleanTyped, currencySymbol, inr, showTyped, toMajor, toMinor } from "@/lib/money.mjs";
import { monthLabel } from "@/lib/cycle.mjs";
import { analyzeGoal, goalTrack } from "@/lib/goalAnalytics.mjs";
import Dialog from "../ui/Dialog";
import Reveal from "../ui/Reveal";
import { useToast } from "../ui/Toast";
import { CARD_H2, LINK_BUTTON, type Contribution, type Goal } from "./types";
import { CurrencyFields, FIELD, SAVE_FAILED, cleanAmount, paise, useForeign } from "./popups/parts";

const thisMonth = (today: string) => today.slice(0, 7);
/** Months from this month to 'YYYY-MM' (the handoff's monthsTo). */
const monthsTo = (by: string, today: string) => {
  const [y, m] = by.split("-").map(Number),
    [ty, tm] = today.split("-").map(Number);
  return (y - ty) * 12 + (m - tm);
};

function Labeled({
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

type Mode = { kind: "add" | "edit" | "delete"; goal: Goal } | { kind: "new" } | null;

export default function Goals({
  goals,
  contributions,
  userId,
  today,
  cycleStart,
  onChanged,
}: {
  goals: Goal[];
  contributions: Contribution[];
  userId: string;
  today: string;
  cycleStart: string;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(null);
  const [form, setForm] = useState({ amount: "", date: today, name: "", target: "", by: "", saved: "" });
  // Target in any currency: it follows each cycle's rate (contributions are kept as saved).
  const fx = useForeign(cycleStart);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = new Date(`${today}T12:00:00`);

  const rows = goals.map((g) => {
    const a = analyzeGoal({
      targetAmount: Number(g.target_amount),
      targetDate: g.target_date,
      startingAmount: Number(g.saved_before ?? 0),
      contributions: contributions.filter((c) => c.goal_id === g.id),
      referenceDate: ref,
    });
    return { g, a, track: goalTrack(a) };
  });

  const open = (m: Mode) => {
    const g = m && "goal" in m ? m.goal : null;
    setForm({
      amount: "",
      date: today,
      name: g?.name ?? "",
      target: g
        ? String(
            g.original_currency
              ? toMajor(Number(g.original_amount), g.original_currency)
              : toMajor(Number(g.target_amount)),
          )
        : "",
      by: g?.target_date?.slice(0, 7) ?? "",
      saved: "",
    });
    fx.load(g?.original_currency ? { currency: g.original_currency, rate: Number(g.fx_rate) } : null);
    setDirty(false);
    setError(null);
    setMode(m);
  };
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
    setError(null);
  };
  const close = () => setMode(null);

  const run = async (write: () => PromiseLike<{ error: unknown }>, message: string) => {
    if (!navigator.onLine) return setError("You’re offline, so this wasn’t saved. Reconnect and try again.");
    setBusy(true);
    const { error } = await write();
    setBusy(false);
    if (error) return setError(SAVE_FAILED);
    close();
    await onChanged();
    toast(message);
  };

  const submit = () => {
    if (!mode) return;
    const supabase = createClient();
    if (mode.kind === "add") {
      const amount = paise(form.amount);
      if (amount <= 0) return setError(`Enter an amount above ${inr(0)}.`);
      if (form.date < cycleStart || form.date > today) return setError("Pick a date in this cycle, up to today.");
      return run(
        () =>
          supabase.rpc("record_goal_contribution", {
            p_goal_id: mode.goal.id,
            p_amount: amount,
            p_date: form.date,
            p_note: mode.goal.name,
          }),
        `Moved ${inr(amount)} to ${mode.goal.name}`,
      );
    }
    if (mode.kind === "delete") {
      return run(() => supabase.from("savings_goals").delete().eq("id", mode.goal.id), `Deleted ${mode.goal.name}`);
    }
    const name = form.name.trim(),
      { amount: target, original } = fx.toBase(form.target),
      saved = paise(form.saved);
    if (!name) return setError("Give the goal a name.");
    if (!fx.rateOk) return setError("Enter the exchange rate for this cycle.");
    if (target <= 0) return setError(`Enter a target above ${inr(0)}.`);
    if (form.by && monthsTo(form.by, today) < 1)
      return setError(`Pick a target month after ${monthLabel(`${thisMonth(today)}-01`)}.`);
    const target_date = form.by ? `${form.by}-01` : null;
    if (mode.kind === "new") {
      if (saved > target) return setError("Already saved can’t be more than the target.");
      return run(
        () =>
          supabase
            .from("savings_goals")
            .insert({ user_id: userId, name, target_amount: target, target_date, saved_before: saved, ...original }),
        `Created ${name}`,
      );
    }
    return run(
      () =>
        supabase
          .from("savings_goals")
          .update({ name, target_amount: target, target_date, ...original })
          .eq("id", mode.goal.id),
      "Goal updated",
    );
  };

  // Popup copy for the open mode.
  const current = mode && "goal" in mode ? rows.find((r) => r.g.id === mode.goal.id) : undefined;
  const amount = paise(form.amount);
  const dialog =
    mode?.kind === "add"
      ? {
          eyebrow: "Add to savings goal",
          title: mode.goal.name,
          submit: amount > 0 ? `Add ${inr(amount)}` : "Add to goal",
          size: "md" as const,
        }
      : mode?.kind === "new"
        ? {
            eyebrow: "Funded before anything is safe to spend",
            title: "New savings goal",
            submit: "Create goal",
            size: "md" as const,
          }
        : mode?.kind === "edit"
          ? {
              eyebrow: current ? `${inr(current.a.current)} saved so far` : "",
              title: "Edit goal",
              submit: "Save goal",
              size: "md" as const,
            }
          : mode?.kind === "delete"
            ? {
                eyebrow: "Savings goal",
                title: `Delete ${mode.goal.name}?`,
                submit: "Delete goal",
                size: "sm" as const,
              }
            : null;
  const quick: Array<[string, number]> = [];
  if (current && mode?.kind === "add") {
    if (current.a.hasTargetDate && current.a.monthsRemaining > 0)
      quick.push([`Monthly pace · ${inr(current.a.requiredMonthly)}`, current.a.requiredMonthly]);
    quick.push([`Finish it · ${inr(current.a.remaining)}`, current.a.remaining], [inr(toMinor(5000)), toMinor(5000)]);
  }

  return (
    <Reveal
      className="flex min-w-0 flex-[2_1_340px] flex-col rounded-[18px] border border-line bg-tile p-6"
      style={{ transitionDelay: ".08s" }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 pb-2.5">
        <h2 className={CARD_H2}>Goals</h2>
        <button type="button" onClick={() => open({ kind: "new" })} className={LINK_BUTTON}>
          New goal
        </button>
      </div>
      {rows.map(({ g, a, track }) => {
        const pct = a.targetAmount > 0 ? Math.min(1, a.current / a.targetAmount) : 0;
        const done = a.status === "completed";
        const foot = done
          ? "Goal reached"
          : !g.target_date
            ? "No target date"
            : a.isPastDeadline
              ? "Target date has passed"
              : `${inr(a.requiredMonthly)} a month to reach it by ${monthLabel(g.target_date)}`;
        const tagColor =
          track?.tag === "on_track" ? "var(--lime-text)" : track?.tag === "late" ? "var(--warn)" : "var(--muted)";
        return (
          <div
            key={g.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line py-3.5"
            data-testid="goal-row"
            data-name={g.name}
          >
            <div
              aria-hidden
              className="relative h-[58px] w-[58px] flex-none rounded-full"
              style={{ background: `conic-gradient(var(--lime) 0 ${(pct * 100).toFixed(2)}%, var(--track) 0)` }}
            >
              <div className="absolute inset-1.5 flex items-center justify-center rounded-full bg-tile font-serif text-[19px] [font-variant-numeric:lining-nums]">
                {Math.round(pct * 100)}%
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <button
                type="button"
                onClick={() => open({ kind: "edit", goal: g })}
                aria-label={`Edit ${g.name}`}
                className="flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left font-semibold hover:text-lime-text"
              >
                {g.name}
                <Pencil size={12} className="flex-none text-muted" />
              </button>
              <span className="tabular text-[13px] text-muted">
                {inr(a.current)} of {inr(a.targetAmount)}
              </span>
              <span
                className="text-[13px]"
                style={{ color: done ? "var(--lime-text)" : a.isPastDeadline ? "var(--warn)" : "var(--muted)" }}
              >
                {foot}
              </span>
              {track && (
                <div className="flex flex-col gap-1.5 self-stretch pt-2">
                  <div
                    role="img"
                    aria-label={`${g.name}: ${inr(a.current)} saved. At the recent pace it reaches ${inr(track.projected)} by ${monthLabel(g.target_date!)}.`}
                    className="relative h-2 overflow-hidden rounded-full bg-track"
                  >
                    <span
                      className="rv-bar absolute inset-y-0 left-0 opacity-45"
                      style={{
                        width: `${((track.projected / a.targetAmount) * 100).toFixed(2)}%`,
                        background: "repeating-linear-gradient(90deg, var(--lime) 0 4px, transparent 4px 7px)",
                        transitionDelay: ".5s",
                      }}
                    />
                    <span
                      className="rv-bar absolute inset-y-0 left-0 rounded-full bg-lime"
                      style={{ width: `${(pct * 100).toFixed(2)}%`, transitionDelay: ".3s" }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                    <span
                      className="rounded-full border px-2 py-px font-bold"
                      style={{ borderColor: tagColor, color: tagColor }}
                    >
                      {track.tag === "on_track"
                        ? "On track"
                        : track.tag === "nothing_yet"
                          ? "Nothing added yet"
                          : `About ${track.monthsLate} month${track.monthsLate === 1 ? "" : "s"} late`}
                    </span>
                    <span className="text-muted">
                      {a.monthlyPace > 0
                        ? `${inr(a.monthlyPace)} a month lately · ${inr(a.requiredMonthly)} needed`
                        : `${inr(a.requiredMonthly)} a month needed`}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-none gap-1.5">
              {!done && (
                <button
                  type="button"
                  onClick={() => open({ kind: "add", goal: g })}
                  aria-label={`Add money to ${g.name}`}
                  className="h-[34px] cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold transition-colors hover:border-lime hover:bg-lime-soft"
                >
                  Add
                </button>
              )}
              <button
                type="button"
                onClick={() => open({ kind: "delete", goal: g })}
                aria-label={`Delete ${g.name}`}
                title="Delete goal"
                className="flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-muted transition-colors hover:border-danger hover:text-danger"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
      {goals.length === 0 && (
        <p className="mt-[18px] mb-1 font-serif text-xl text-ink-2 italic">
          No goals yet. Start one and it’s funded before anything counts as safe to spend.
        </p>
      )}

      {dialog && (
        <Dialog
          open={!!mode}
          onClose={close}
          eyebrow={dialog.eyebrow}
          title={dialog.title}
          size={dialog.size}
          dirty={dirty}
          error={error}
          onSubmit={submit}
          submitLabel={busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : dialog.submit}
          submitTone={mode?.kind === "delete" ? "danger" : "primary"}
          busy={busy}
        >
          {mode?.kind === "add" && current && (
            <>
              <div className="flex flex-col gap-2">
                <div className="tabular flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px] text-muted">
                  <span>
                    {inr(current.a.current)} of {inr(current.a.targetAmount)} saved
                  </span>
                  <span>{inr(current.a.remaining)} to go</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-track">
                  <div
                    className="h-full rounded-full bg-lime"
                    style={{ width: `${Math.min(100, current.a.percent).toFixed(1)}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <label htmlFor="g-amt" className="eyebrow">
                  Amount
                </label>
                <div className="flex items-baseline gap-1.5 border-b-[1.5px] border-line-2 pb-1.5 transition-colors focus-within:border-lime">
                  <span className="font-serif text-[44px] leading-none text-muted">{currencySymbol()}</span>
                  <input
                    id="g-amt"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    autoFocus
                    placeholder="0"
                    value={showTyped(form.amount)}
                    onChange={(e) => set({ amount: cleanAmount(e.target.value) })}
                    className="tabular w-full min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-[clamp(48px,13vw,64px)] leading-[1.05] tracking-[-0.02em] text-ink outline-none focus-visible:outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {quick
                    .filter(([, v]) => v > 0)
                    .map(([text, v]) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => set({ amount: String(toMajor(v)) })}
                        className="tabular min-h-[34px] cursor-pointer rounded-full border border-line bg-transparent px-3 py-1 text-[13px] font-semibold text-ink-2 hover:border-ink-2 hover:text-ink"
                      >
                        {text}
                      </button>
                    ))}
                </div>
              </div>
              <Labeled id="g-date" label="Date">
                <input
                  id="g-date"
                  type="date"
                  min={cycleStart}
                  max={today}
                  value={form.date}
                  onChange={(e) => set({ date: e.target.value })}
                  className={`${FIELD} max-w-[240px]`}
                />
              </Labeled>
            </>
          )}
          {(mode?.kind === "new" || mode?.kind === "edit") && (
            <>
              <Labeled id="ng-name" label="Goal name">
                <input
                  id="ng-name"
                  type="text"
                  autoFocus
                  placeholder="Emergency fund, car, wedding"
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  className={FIELD}
                />
              </Labeled>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
                <Labeled id="ng-target" label="Target amount">
                  <input
                    id="ng-target"
                    type="text"
                    inputMode="decimal"
                    placeholder={fx.foreign ? "0" : inr(toMinor(100000))}
                    value={showTyped(form.target)}
                    onChange={(e) => set({ target: cleanTyped(e.target.value, undefined, fx.currency) })}
                    className={`${FIELD} tabular`}
                  />
                </Labeled>
                <CurrencyFields id="ng" fx={fx} />
                <Labeled id="ng-by" label="Target month" optional>
                  <input
                    id="ng-by"
                    type="month"
                    min={thisMonth(today)}
                    value={form.by}
                    onChange={(e) => set({ by: e.target.value })}
                    className={FIELD}
                  />
                </Labeled>
              </div>
              {mode.kind === "new" && (
                <Labeled id="ng-saved" label="Already saved" optional>
                  <input
                    id="ng-saved"
                    type="text"
                    inputMode="decimal"
                    placeholder={inr(0)}
                    value={showTyped(form.saved)}
                    onChange={(e) => set({ saved: cleanAmount(e.target.value) })}
                    className={`${FIELD} max-w-[240px]`}
                  />
                </Labeled>
              )}
            </>
          )}
          {mode?.kind === "delete" && current && (
            <p className="m-0 font-serif text-[22px] leading-[1.3] text-pretty text-ink-2">
              {mode.goal.name} and its {inr(current.a.current)} of progress will be removed from your goals. Past
              transfers stay in the ledger.
            </p>
          )}
        </Dialog>
      )}
    </Reveal>
  );
}
