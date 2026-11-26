"use client";

// Goals card and its popups (design handoff: Add to goal, New goal, Edit goal, Delete goal; v4 §2:
// sub-goals, "No end date", the ⋯ menu, Split, and delete with Undo).

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, CornerDownRight, Ellipsis, Lock, Pencil, Split, Trash2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { cleanTyped, currencySymbol, formatExact, inr, showTyped, toMajor, toMinor } from "@/lib/money.mjs";
import { monthLabel } from "@/lib/cycle.mjs";
import { analyzeGoal, goalInputs, goalTrack } from "@/lib/goalAnalytics.mjs";
import { deleteGoal, restoreRows } from "@/lib/goalSplit.mjs";
import Dialog from "../ui/Dialog";
import Reveal from "../ui/Reveal";
import { useToast } from "../ui/Toast";
import { CARD_H2, LINK_BUTTON, type Contribution, type Goal } from "./types";
import { FIELD, SAVE_FAILED, cleanAmount, paise, useForeign } from "./popups/parts";
import { CurrencyChip, CurrencyList, RateLine } from "./popups/currency";
import SplitGoalDialog from "./popups/SplitGoalDialog";

const thisMonth = (today: string) => today.slice(0, 7);
/** Months from this month to 'YYYY-MM' (the handoff's monthsTo). */
const monthsTo = (by: string, today: string) => {
  const [y, m] = by.split("-").map(Number),
    [ty, tm] = today.split("-").map(Number);
  return (y - ty) * 12 + (m - tm);
};
const nextMonth = (today: string) => {
  const [y, m] = today.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, "0")}`;
};
const ROUND_BUTTON =
  "flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border bg-transparent text-ink-2 transition-colors hover:border-ink-2";
const ADD_BUTTON =
  "h-[34px] cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold transition-colors hover:border-lime hover:bg-lime-soft";

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

type MenuItem = { label: string; icon: ReactNode; why?: string; danger?: boolean; onPick: () => void };

/** The ⋯ menu on a goal (role="menu", arrow keys, Esc and a click outside close it). */
function GoalMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const list = () => Array.from(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    list()[0]?.focus();
    const away = (e: PointerEvent) => !box.current?.parentElement?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    const all = list(),
      i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    }
  };
  return (
    <div className="relative flex">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={ROUND_BUTTON}
        style={{
          borderColor: open ? "var(--ink-2)" : "var(--line)",
          background: open ? "var(--tile-2)" : "transparent",
        }}
      >
        <Ellipsis size={16} aria-hidden />
      </button>
      {open && (
        <div
          ref={box}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          className="absolute top-10 right-0 z-30 flex w-[264px] max-w-[calc(100vw-32px)] flex-col rounded-[14px] border border-line-2 bg-tile-2 p-1.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)]"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                close(false);
                it.onPick();
              }}
              className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[10px] border-0 bg-transparent p-2.5 text-left text-sm font-semibold hover:bg-tile focus-visible:bg-tile"
              style={{ color: it.danger ? "var(--danger)" : "var(--ink)" }}
            >
              <span className="flex pt-0.5" aria-hidden>
                {it.icon}
              </span>
              <span className="flex flex-col gap-0.5">
                {it.label}
                {it.why && <span className="text-xs font-normal text-pretty text-muted">{it.why}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Mode = { kind: "add" | "edit" | "delete" | "split"; goal: Goal } | { kind: "new"; parent?: Goal } | null;

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
  const [form, setForm] = useState({
    amount: "",
    date: today,
    name: "",
    target: "",
    dated: true,
    by: "",
    saved: "",
    delName: "",
  });
  /** Sub-goal lists the user folded away (open by default). */
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  // Target in any currency: it follows each cycle's rate (contributions are kept as saved).
  const fx = useForeign(cycleStart);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = new Date(`${today}T12:00:00`);

  const kidsOf = (id: string) => goals.filter((g) => g.parent_id === id);
  const info = new Map(
    goals.map((g) => {
      // A main goal adds up its sub-goals (lib/goalAnalytics.mjs goalInputs).
      const a = analyzeGoal({ ...goalInputs(g, goals, contributions), referenceDate: ref });
      return [g.id, { a, track: goalTrack(a) }];
    }),
  );
  const top = goals.filter((g) => !g.parent_id || !goals.some((x) => x.id === g.parent_id));
  const parentOf = (g: Goal) => (g.parent_id ? goals.find((x) => x.id === g.parent_id) : undefined);

  const open = (m: Mode) => {
    const g = m && "goal" in m ? m.goal : null;
    const par = m?.kind === "new" ? m.parent : undefined;
    // A sub-goal is set in its main goal's currency.
    const fxFrom = g ?? par;
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
      dated: g ? !!g.target_date : par ? !!par.target_date : true,
      by: (g ?? par)?.target_date?.slice(0, 7) ?? "",
      saved: "",
      delName: "",
    });
    fx.load(
      fxFrom?.original_currency
        ? { currency: fxFrom.original_currency, rate: Number(fxFrom.fx_rate), date: fxFrom.fx_date ?? null }
        : null,
    );
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

  /** Toast after a save, with Undo when given (it refreshes again once undone). */
  const done = async (message: string, undo?: () => PromiseLike<{ error: unknown }>) => {
    await onChanged();
    toast(
      message,
      undo && {
        undo: async () => {
          const r = await undo();
          if (r.error) throw r.error;
          await onChanged();
        },
      },
    );
  };
  const run = async (
    write: () => PromiseLike<{ error: unknown; data?: unknown }>,
    message: string,
    undo?: (data: unknown) => PromiseLike<{ error: unknown }>,
  ) => {
    if (!navigator.onLine) return setError("You’re offline, so this wasn’t saved. Reconnect and try again.");
    setBusy(true);
    const { error, data } = await write();
    setBusy(false);
    if (error) return setError(SAVE_FAILED);
    close();
    await done(message, undo && (() => undo(data)));
  };

  const kids = mode && "goal" in mode ? kidsOf(mode.goal.id) : [];
  const par = mode?.kind === "new" ? mode.parent : mode && "goal" in mode ? parentOf(mode.goal) : undefined;
  /** The target of a main goal with sub-goals is their total, so it can't be typed. */
  const locked = mode?.kind === "edit" && kids.length > 0;
  /** Sub-goals use their main goal's currency (and so does a main goal with sub-goals). */
  const fixedCurrency = !!par || locked;

  const submit = () => {
    if (!mode) return;
    const supabase = createClient();
    if (mode.kind === "split") return;
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
      const g = mode.goal;
      if (kids.length && form.delName.trim().toLowerCase() !== g.name.trim().toLowerCase())
        return setError(`Type “${g.name}” to confirm.`);
      return run(
        () => deleteGoal(supabase, g.id),
        kids.length
          ? `Deleted ${g.name} and ${kids.length} sub-goal${kids.length === 1 ? "" : "s"}`
          : `Deleted ${g.name}`,
        (snapshot) => restoreRows(supabase, snapshot),
      );
    }
    const name = form.name.trim(),
      { amount: target, original } = fx.toBase(form.target),
      saved = paise(form.saved),
      by = form.dated ? form.by : "";
    if (!name) return setError("Give the goal a name.");
    if (by && monthsTo(by, today) < 1)
      return setError(`Pick a target month after ${monthLabel(`${thisMonth(today)}-01`)}.`);
    const target_date = by ? `${by}-01` : null;
    if (locked) {
      return run(
        () => supabase.from("savings_goals").update({ name, target_date }).eq("id", mode.goal.id),
        "Goal updated",
      );
    }
    if (!fx.rateOk) return setError("Enter the exchange rate for this cycle.");
    if (target <= 0) return setError(`Enter a target above ${inr(0)}.`);
    if (mode.kind === "new") {
      if (saved > target) return setError("Already saved can’t be more than the target.");
      const p = mode.parent;
      if (p && kidsOf(p.id).some((x) => x.name.trim().toLowerCase() === name.toLowerCase()))
        return setError("That sub-goal already exists.");
      if (p) setFolded((f) => ({ ...f, [p.id]: false }));
      return run(
        () =>
          supabase.from("savings_goals").insert({
            user_id: userId,
            name,
            target_amount: target,
            target_date,
            saved_before: saved,
            ...original,
            ...(p && { parent_id: p.id }),
          }),
        p ? `Added ${name} to ${p.name}` : `Created ${name}`,
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

  const menuFor = (g: Goal, isSub: boolean): MenuItem[] => {
    const held = !kidsOf(g.id).length && (info.get(g.id)?.a.current ?? 0) > 0;
    const items: MenuItem[] = [
      {
        label: isSub ? "Edit sub-goal" : "Edit goal",
        icon: <Pencil size={15} />,
        onPick: () => open({ kind: "edit", goal: g }),
      },
    ];
    if (!isSub)
      items.push(
        held
          ? {
              label: "Split into sub-goals",
              icon: <Split size={15} />,
              why: `Share its ${inr(info.get(g.id)!.a.current)} across them. Nothing is lost.`,
              onPick: () => setMode({ kind: "split", goal: g }),
            }
          : {
              label: "Add sub-goal",
              icon: <CornerDownRight size={15} />,
              onPick: () => open({ kind: "new", parent: g }),
            },
      );
    items.push({
      label: isSub ? "Delete sub-goal" : "Delete goal",
      icon: <Trash2 size={15} />,
      danger: true,
      onPick: () => open({ kind: "delete", goal: g }),
    });
    return items;
  };

  // Popup copy for the open mode.
  const current = mode && "goal" in mode ? info.get(mode.goal.id) : undefined;
  const amount = paise(form.amount);
  const kidsSum = (id: string) => kidsOf(id).reduce((t, x) => t + Number(x.target_amount), 0);
  const delSaved = kids.length
    ? kids.reduce((t, x) => t + (info.get(x.id)?.a.current ?? 0), 0)
    : (current?.a.current ?? 0);
  const lastKid = mode?.kind === "delete" && par && kidsOf(par.id).length === 1;
  const dialog =
    mode?.kind === "add"
      ? {
          eyebrow: "Add to savings goal",
          title: mode.goal.name,
          submit: amount > 0 ? `Add ${inr(amount)}` : "Add to goal",
          size: "md" as const,
        }
      : mode?.kind === "new"
        ? mode.parent
          ? { eyebrow: mode.parent.name, title: "New sub-goal", submit: "Add sub-goal", size: "md" as const }
          : {
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
                eyebrow: par ? "Sub-goal" : "Savings goal",
                title: `Delete ${mode.goal.name}?`,
                submit: "Delete goal",
                size: kids.length ? ("md" as const) : ("sm" as const),
              }
            : null;
  const quick: Array<[string, number]> = [];
  if (current && mode?.kind === "add") {
    if (current.a.hasTargetDate && current.a.monthsRemaining > 0)
      quick.push([`Monthly pace · ${inr(current.a.requiredMonthly)}`, current.a.requiredMonthly]);
    quick.push([`Finish it · ${inr(current.a.remaining)}`, current.a.remaining], [inr(toMinor(5000)), toMinor(5000)]);
  }

  const goalRow = (g: Goal) => {
    const { a, track } = info.get(g.id)!;
    const subs = kidsOf(g.id),
      isParent = subs.length > 0,
      expanded = !folded[g.id];
    const pct = a.targetAmount > 0 ? Math.min(1, a.current / a.targetAmount) : 0;
    const reached = a.status === "completed";
    const foot = reached
      ? "Goal reached"
      : isParent
        ? `Total of ${subs.length} sub-goal${subs.length === 1 ? "" : "s"}${g.target_date ? ` · by ${monthLabel(g.target_date)}` : ""}`
        : !g.target_date
          ? "No end date · add money whenever you like"
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
            {g.original_currency &&
              !isParent &&
              ` · ${formatExact(Number(g.original_amount), g.original_currency)} target, rate changes each cycle`}
          </span>
          <span
            className="text-[13px]"
            style={{
              color: reached ? "var(--lime-text)" : a.isPastDeadline && !isParent ? "var(--warn)" : "var(--muted)",
            }}
          >
            {foot}
          </span>
          {track && !isParent && (
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
          {!reached && !isParent && (
            <button
              type="button"
              onClick={() => open({ kind: "add", goal: g })}
              aria-label={`Add money to ${g.name}`}
              className={ADD_BUTTON}
            >
              Add
            </button>
          )}
          <GoalMenu label={`${g.name} options`} items={menuFor(g, false)} />
        </div>
        {isParent && (
          <div className="flex basis-full flex-col pl-[clamp(0px,6vw,74px)]">
            <button
              type="button"
              onClick={() => setFolded((f) => ({ ...f, [g.id]: expanded }))}
              aria-expanded={expanded}
              aria-controls={`subs-${g.id}`}
              className="-ml-2 flex h-8 cursor-pointer items-center gap-1.5 self-start rounded-full border-0 bg-transparent pr-2.5 pl-2 text-[13px] font-semibold text-ink-2 hover:bg-tile-2"
            >
              <ChevronDown
                size={14}
                aria-hidden
                className="transition-transform duration-200"
                style={{ transform: `rotate(${expanded ? 180 : 0}deg)` }}
              />
              {expanded ? "Hide" : "Show"} {subs.length} sub-goal{subs.length === 1 ? "" : "s"}
            </button>
            {expanded && (
              <div id={`subs-${g.id}`} className="mt-1 flex flex-col">
                {subs.map((x) => {
                  const xa = info.get(x.id)!.a,
                    xDone = xa.status === "completed";
                  const when = xDone
                    ? "Reached"
                    : !x.target_date
                      ? "No end date"
                      : xa.isPastDeadline
                        ? "Target date has passed"
                        : `By ${monthLabel(x.target_date)} · ${inr(xa.requiredMonthly)} a month`;
                  return (
                    <div
                      key={x.id}
                      data-testid="sub-goal-row"
                      data-name={x.name}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-2 border-line-2 py-2.5 pl-3.5"
                    >
                      <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                          <button
                            type="button"
                            onClick={() => open({ kind: "edit", goal: x })}
                            aria-label={`Edit ${x.name}`}
                            className="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold hover:text-lime-text"
                          >
                            {x.name}
                          </button>
                          <span className="tabular text-[13px] text-muted">
                            {inr(xa.current)} of {inr(xa.targetAmount)}
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-track">
                          <div
                            className="h-full rounded-full bg-lime"
                            style={{
                              width: `${(xa.targetAmount ? Math.min(100, (xa.current / xa.targetAmount) * 100) : 0).toFixed(2)}%`,
                            }}
                          />
                        </div>
                        <span
                          className="text-xs"
                          style={{
                            color: xDone ? "var(--lime-text)" : xa.isPastDeadline ? "var(--warn)" : "var(--muted)",
                          }}
                        >
                          {when}
                        </span>
                      </div>
                      <div className="flex flex-none gap-1.5">
                        {!xDone && (
                          <button
                            type="button"
                            onClick={() => open({ kind: "add", goal: x })}
                            aria-label={`Add money to ${x.name}`}
                            className={ADD_BUTTON}
                          >
                            Add
                          </button>
                        )}
                        <GoalMenu label={`${x.name} options`} items={menuFor(x, true)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

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
      {top.map(goalRow)}
      {goals.length === 0 && (
        <div className="flex flex-col items-start gap-2.5 pt-[18px] pb-1">
          <p className="m-0 font-serif text-xl text-pretty text-ink-2 italic">
            No goals yet. Start one and it’s funded before anything counts as safe to spend.
          </p>
          <button
            type="button"
            onClick={() => open({ kind: "new" })}
            className="h-9 cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold hover:border-ink-2"
          >
            Start a goal
          </button>
        </div>
      )}

      {mode?.kind === "split" && (
        <SplitGoalDialog
          goal={mode.goal}
          contributions={contributions.filter((c) => c.goal_id === mode.goal.id)}
          minMonth={nextMonth(today)}
          onClose={close}
          onSaved={done}
        />
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
              {mode.kind === "new" && mode.parent && (
                <div className="flex items-start gap-3 rounded-xl bg-tile-2 px-3.5 py-3">
                  <CornerDownRight size={16} aria-hidden className="mt-0.5 flex-none text-lime-text" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-semibold">Part of {mode.parent.name}</span>
                    <span className="text-[13px] text-pretty text-muted">
                      {kidsOf(mode.parent.id).length
                        ? `${mode.parent.name}’s target becomes the total of its sub-goals, now ${inr(kidsSum(mode.parent.id))}.`
                        : `${mode.parent.name}’s own ${inr(Number(mode.parent.target_amount))} target is replaced by the total of its sub-goals.`}
                    </span>
                  </div>
                </div>
              )}
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
              <div
                className={
                  par
                    ? "flex flex-col gap-3.5"
                    : "grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5"
                }
              >
                {locked ? (
                  <div className="flex min-w-0 flex-col gap-2">
                    <span className="eyebrow">Target amount</span>
                    <div
                      aria-readonly="true"
                      className="tabular flex h-12 items-center gap-2 rounded-xl border border-dashed border-line-2 px-3.5 text-[15px] font-semibold"
                    >
                      <Lock size={14} aria-hidden className="text-muted" />
                      {inr(kids.reduce((t, x) => t + Number(x.target_amount), 0))}
                    </div>
                    <span className="text-xs text-pretty text-muted">
                      Total of {kids.length} sub-goal{kids.length === 1 ? "" : "s"}. Change it by editing them.
                    </span>
                  </div>
                ) : (
                  <Labeled id="ng-target" label="Target amount">
                    <div className="flex gap-2">
                      <input
                        id="ng-target"
                        type="text"
                        inputMode="decimal"
                        placeholder={fx.foreign ? "0" : inr(toMinor(100000))}
                        value={showTyped(form.target)}
                        onChange={(e) => set({ target: cleanTyped(e.target.value, undefined, fx.currency) })}
                        className={`${FIELD} tabular`}
                      />
                      {!fixedCurrency && (
                        <CurrencyChip
                          size={48}
                          currency={fx.currency}
                          open={fx.listOpen}
                          onToggle={() => fx.setListOpen(!fx.listOpen)}
                        />
                      )}
                    </div>
                  </Labeled>
                )}
                <div className="flex min-w-0 flex-col gap-2">
                  <span id="ng-by-l" className="eyebrow">
                    Target month
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="ng-by-l"
                    className="flex h-12 gap-0.5 rounded-xl border border-line-2 p-[3px]"
                  >
                    {(
                      [
                        ["By a month", true],
                        ["No end date", false],
                      ] as const
                    ).map(([label, v]) => (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={form.dated === v}
                        onClick={() => set({ dated: v })}
                        className="min-w-0 flex-1 cursor-pointer rounded-[9px] border-0 text-[13px] font-semibold whitespace-nowrap transition-[background,color] duration-200"
                        style={{
                          background: form.dated === v ? "var(--ink)" : "transparent",
                          color: form.dated === v ? "var(--bg)" : "var(--ink-2)",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {form.dated ? (
                <Labeled id="ng-by" label="Reach it by">
                  <input
                    id="ng-by"
                    type="month"
                    min={nextMonth(today)}
                    value={form.by}
                    onChange={(e) => set({ by: e.target.value })}
                    className={`${FIELD} block appearance-none`}
                  />
                </Labeled>
              ) : (
                <span className="text-[13px] text-muted">No monthly pace. Add money whenever you like.</span>
              )}
              {fx.listOpen && (
                <CurrencyList
                  value={fx.currency}
                  onPick={(c) => {
                    fx.setCurrency(c);
                    set({ target: "" });
                  }}
                  onClose={() => fx.setListOpen(false)}
                />
              )}
              {/* The target floats with each cycle's rate; money already saved never changes. */}
              {!locked && <RateLine fx={fx} typed={form.target} cycleStart={cycleStart} id="ng" />}
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
            <>
              <p className="m-0 font-serif text-[22px] leading-[1.3] text-pretty text-ink-2">
                {kids.length
                  ? `This also deletes its ${kids.length} sub-goal${kids.length === 1 ? "" : "s"} and their ${inr(delSaved)} of progress. Past transfers stay in the ledger.`
                  : lastKid && par
                    ? `${mode.goal.name} and its ${inr(delSaved)} of progress will be removed. ${par.name} goes back to a single goal with a ${inr(Number(mode.goal.target_amount))} target.`
                    : `${mode.goal.name} and its ${inr(delSaved)} of progress will be removed from your goals. Past transfers stay in the ledger.`}
              </p>
              {kids.length > 0 && (
                <>
                  <div className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
                    {kids.map((x) => {
                      const xa = info.get(x.id)!.a;
                      return (
                        <div key={x.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-4 py-3">
                          <span className="font-semibold">{x.name}</span>
                          <span className="tabular text-[13px] text-muted">
                            {inr(xa.current)} of {inr(xa.targetAmount)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <label htmlFor="del-name" className="text-sm font-semibold">
                      Type “{mode.goal.name}” to confirm
                    </label>
                    <input
                      id="del-name"
                      type="text"
                      autoComplete="off"
                      autoFocus
                      value={form.delName}
                      onChange={(e) => set({ delName: e.target.value })}
                      className={FIELD}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </Dialog>
      )}
    </Reveal>
  );
}
