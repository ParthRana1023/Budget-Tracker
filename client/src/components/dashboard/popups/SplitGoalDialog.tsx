"use client";

// "Split {goal}" (handoff v4 §2b): a goal that already holds money gets sub-goals, and its money is
// shared out across them, equally, by target or as typed. Nothing is lost: lib/goalSplit.mjs works
// out the exact plan and split_goal checks it adds up.

import { useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { cleanTyped, currencySymbol, inr, showTyped, toMinor } from "@/lib/money.mjs";
import { convert } from "@/lib/fx.mjs";
import { planSplit, shareOut, splitGoal, unsplitGoal } from "@/lib/goalSplit.mjs";
import Dialog from "../../ui/Dialog";
import type { Contribution, Goal } from "../types";
import { SAVE_FAILED, cleanAmount, paise, toField } from "./parts";

type Row = { name: string; target: string; by: string };
type Mode = "equal" | "target" | "custom";
const EMPTY: Row = { name: "", target: "", by: "" };
const MAX_ROWS = 8;
const SMALL_LABEL = "text-xs font-semibold text-muted";
const BOX =
  "flex h-11 min-w-0 items-center gap-1 rounded-[10px] border border-line-2 bg-tile px-3 focus-within:border-lime";
const BARE = "min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none focus-visible:outline-none";

export default function SplitGoalDialog({
  goal,
  contributions,
  minMonth,
  onClose,
  onSaved,
}: {
  goal: Goal;
  /** This goal's own contributions (each needs its id). */
  contributions: Contribution[];
  /** Earliest "By" month, YYYY-MM. */
  minMonth: string;
  onClose: () => void;
  /** Toast with Undo once saved (Goals' run). */
  onSaved: (message: string, undo: () => PromiseLike<{ error: unknown }>) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([EMPTY, EMPTY]);
  const [mode, setMode] = useState<Mode>("equal");
  const [amts, setAmts] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touch = () => {
    setDirty(true);
    setError(null);
  };

  // Targets are typed in the goal's currency (sub-goals share it); money held is in the base one.
  const cur = goal.original_currency ?? undefined;
  const sym = currencySymbol(cur);
  const S = Number(goal.saved_before ?? 0) + contributions.reduce((t, c) => t + Number(c.amount), 0);
  const original = rows.map((r) => toMinor(parseFloat(r.target) || 0, cur));
  const targets = original.map((m) => (cur ? convert(m, cur, Number(goal.fx_rate)) : m));
  const byTargetOk = targets.every((t) => t > 0);
  const shares =
    mode === "custom"
      ? rows.map((_, i) => paise(amts[i] ?? ""))
      : shareOut(S, mode === "target" && byTargetOk ? targets : rows.map(() => 1));
  const left = S - shares.reduce((t, x) => t + x, 0);
  const label = (i: number) => rows[i].name.trim() || `Sub-goal ${i + 1}`;

  const put = (i: number, p: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
    touch();
  };
  const remove = (i: number) => {
    setRows((rs) => rs.filter((_, j) => j !== i));
    setAmts((as) => as.filter((_, j) => j !== i));
    touch();
  };

  const submit = async () => {
    const names = rows.map((r) => r.name.trim());
    if (names.some((n) => !n)) return setError("Give each sub-goal a name.");
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length)
      return setError("Each sub-goal needs a different name.");
    if (!byTargetOk) return setError(`Give each sub-goal a target above ${inr(0)}.`);
    if (mode === "custom" && left !== 0)
      return setError(
        left > 0 ? `Place the last ${inr(left)} before saving.` : `That’s ${inr(-left)} more than ${goal.name} holds.`,
      );
    if (!navigator.onLine) return setError("You’re offline, so this wasn’t saved. Reconnect and try again.");
    const plan = planSplit({
      savedBefore: Number(goal.saved_before ?? 0),
      contributions: contributions.map((c) => ({ id: c.id!, amount: Number(c.amount) })),
      shares,
    });
    const supabase = createClient();
    setBusy(true);
    const { error: e } = await splitGoal(
      supabase,
      goal.id,
      rows.map((r, i) => ({
        name: names[i],
        target_amount: targets[i],
        target_date: r.by ? `${r.by}-01` : null,
        ...(cur && { original_amount: original[i] }),
      })),
      plan,
    );
    setBusy(false);
    if (e) return setError(SAVE_FAILED);
    onClose();
    await onSaved(`Split ${goal.name} into ${rows.length} sub-goals · ${inr(S)} shared out`, () =>
      unsplitGoal(supabase, goal.id, Number(goal.target_amount), cur ? Number(goal.original_amount) : null),
    );
  };

  const MODES: Array<[Mode, string, string]> = [
    ["equal", "Equally", "Same amount each"],
    ["target", "By target", byTargetOk ? "In proportion to each target" : "Add every target first"],
    ["custom", "I’ll choose", "Type an amount for each"],
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`${inr(S)} saved · becomes the total of its sub-goals`}
      title={`Split ${goal.name}`}
      size="md"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : "Split goal"}
    >
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">Sub-goals</span>
        {rows.map((r, i) => (
          <div
            key={i}
            role="group"
            aria-label={label(i)}
            className="flex flex-col gap-2.5 rounded-[14px] border border-line-2 bg-tile-2 p-3.5"
          >
            <div className="flex items-center justify-between gap-2.5">
              <span className="truncate text-[13px] font-bold text-ink-2">{label(i)}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={rows.length <= 1}
                aria-label={`Remove sub-goal ${i + 1}`}
                className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-2 hover:bg-tile disabled:cursor-default disabled:opacity-35"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`sg-n-${i}`} className={SMALL_LABEL}>
                Name
              </label>
              <input
                id={`sg-n-${i}`}
                type="text"
                maxLength={40}
                value={r.name}
                onChange={(e) => put(i, { name: e.target.value })}
                placeholder="e.g. Flights"
                className="h-11 w-full min-w-0 rounded-[10px] border border-line-2 bg-tile px-3 text-[15px] text-ink outline-none focus:border-lime focus-visible:outline-none"
              />
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-2.5">
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`sg-t-${i}`} className={SMALL_LABEL}>
                  Target
                </label>
                <span className={BOX}>
                  <span className="text-muted">{sym}</span>
                  <input
                    id={`sg-t-${i}`}
                    inputMode="decimal"
                    value={showTyped(r.target)}
                    onChange={(e) => put(i, { target: cleanTyped(e.target.value, undefined, cur) })}
                    placeholder="0"
                    className={`${BARE} tabular font-semibold`}
                  />
                </span>
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`sg-b-${i}`} className={SMALL_LABEL}>
                  By <span className="font-normal">· optional</span>
                </label>
                <input
                  id={`sg-b-${i}`}
                  type="month"
                  min={minMonth}
                  value={r.by}
                  onChange={(e) => put(i, { by: e.target.value })}
                  className="block h-11 w-full min-w-0 appearance-none rounded-[10px] border border-line-2 bg-tile px-3 text-[15px] text-ink outline-none focus:border-lime focus-visible:outline-none"
                />
              </div>
            </div>
          </div>
        ))}
        {rows.length < MAX_ROWS && (
          <button
            type="button"
            onClick={() => {
              setRows((rs) => [...rs, EMPTY]);
              touch();
            }}
            className="h-[38px] cursor-pointer self-start rounded-full border border-dashed border-line-2 bg-transparent px-3.5 text-[13px] font-semibold hover:border-ink-2"
          >
            + Add another
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <span id="sg-mode-l" className="eyebrow">
          Share out the {inr(S)} already saved
        </span>
        <div
          role="radiogroup"
          aria-labelledby="sg-mode-l"
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,140px),1fr))] gap-2"
        >
          {MODES.map(([k, name, sub]) => {
            const on = mode === k,
              off = k === "target" && !byTargetOk;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={off || undefined}
                onClick={() => {
                  if (off) return;
                  setMode(k);
                  touch();
                }}
                className="flex cursor-pointer flex-col gap-0.5 rounded-xl border px-3.5 py-3 text-left transition-[border-color,background] duration-200"
                style={{
                  borderColor: on ? "var(--lime)" : "var(--line)",
                  background: on ? "var(--lime-soft)" : "transparent",
                  opacity: off ? 0.5 : 1,
                }}
              >
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-xs text-muted">{sub}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col rounded-[14px] border border-line">
          {rows.map((_, i) => {
            const share = shares[i] ?? 0,
              t = targets[i],
              over = t > 0 && share > t;
            return (
              <div
                key={i}
                className="-mt-px flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3.5 py-3"
              >
                <div className="flex min-w-0 flex-[1_1_140px] flex-col">
                  <span className="truncate font-semibold">{label(i)}</span>
                  <span className="text-xs" style={{ color: over ? "var(--warn)" : "var(--ink)" }}>
                    {over ? "More than its target" : t > 0 ? `${Math.round((share / t) * 100)}% of ${inr(t)}` : ""}
                  </span>
                </div>
                {mode === "custom" ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAmts(rows.map((_, j) => (j === i ? toField(S) : "0")));
                        touch();
                      }}
                      aria-label={`Put all ${inr(S)} into ${label(i)}`}
                      className="h-8 cursor-pointer rounded-full border border-line-2 bg-transparent px-2.5 text-xs font-semibold whitespace-nowrap hover:border-ink-2"
                    >
                      All into this one
                    </button>
                    <span className={`${BOX} h-10 w-[130px] bg-tile-2`}>
                      <span className="text-muted">{currencySymbol()}</span>
                      <input
                        inputMode="decimal"
                        value={showTyped(amts[i] ?? "")}
                        onChange={(e) => {
                          const v = cleanAmount(e.target.value);
                          setAmts((as) => rows.map((_, j) => (j === i ? v : (as[j] ?? ""))));
                          touch();
                        }}
                        aria-label={`Amount for ${label(i)}`}
                        placeholder="0"
                        className={`${BARE} tabular text-right font-semibold`}
                      />
                    </span>
                  </div>
                ) : (
                  <span
                    aria-live="polite"
                    className="tabular font-serif text-2xl leading-none"
                    style={{ color: over ? "var(--warn)" : "var(--ink)" }}
                  >
                    {inr(share)}
                  </span>
                )}
              </div>
            );
          })}
          {mode === "custom" && (
            <div
              role="status"
              aria-live="polite"
              className="tabular flex justify-between gap-3 border-t border-line-2 px-3.5 py-3 text-sm font-bold"
            >
              <span className="text-ink-2">Left to place</span>
              <span style={{ color: left === 0 ? "var(--lime-text)" : left > 0 ? "var(--ink-2)" : "var(--danger)" }}>
                {left === 0 ? "All placed" : left > 0 ? `${inr(left)} left` : `${inr(-left)} too much`}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 text-[13px] text-pretty text-ink-2">
        <ShieldCheck size={16} aria-hidden className="mt-px flex-none text-lime-text" />
        <span>
          The total stays {inr(S)}. Nothing is lost: the money already in {goal.name} moves into its sub-goals, and{" "}
          {goal.name} becomes the total of them.
        </span>
      </div>
    </Dialog>
  );
}
