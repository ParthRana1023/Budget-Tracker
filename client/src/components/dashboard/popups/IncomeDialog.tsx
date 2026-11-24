"use client";

// Record income (design handoff, Popups): received now, or expected later (on hold).

import { useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { addDaysStr, cycleDayOf, cycleKeyFor, nextCycleOffer, shortDate } from "@/lib/cycle.mjs";
import { baseCurrency, inr } from "@/lib/money.mjs";
import { recurringStatus } from "@/lib/recurringStatus.mjs";
import Dialog from "../../ui/Dialog";
import type { PopupContext } from "./context";
import { useKeyboardInset } from "../../ui/useKeyboardInset";
import {
  AddTabs,
  AmountField,
  DueDayField,
  FIELD,
  Labeled,
  Preview,
  SAVE_FAILED,
  Suggestions,
  Switch,
  SwitchRow,
  paise,
  safeAfterPreview,
  toField,
  useForeign,
  usePopupForm,
  type PreviewProps,
} from "./parts";
import { CurrencyChip, CurrencyList, RateLine } from "./currency";

type IncomeType = "salary" | "variable" | "other";
const TYPES: Array<[IncomeType, string, string]> = [
  ["salary", "Salary", "Monthly salary"],
  ["variable", "Variable pay", "Quarterly incentive"],
  ["other", "Other", "Freelance payment"],
];

export default function IncomeDialog({
  ctx,
  expected = false,
  typed = "",
  onClose,
  onSwitch,
}: {
  ctx: PopupContext;
  expected?: boolean;
  /** The amount as typed, carried over from the Expense tab. */
  typed?: string;
  onClose: () => void;
  /** Opened from Add: the sheet shows Expense | Income tabs; switching passes the typed amount. */
  onSwitch?: (typed: string) => void;
}) {
  const { model, today, period } = ctx;
  const later = addDaysStr(today, 7);
  const keyboardOpen = useKeyboardInset() > 0;
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    amount: typed,
    type: (expected ? "variable" : "salary") as IncomeType,
    name: "",
    status: (expected ? "expected" : "received") as "received" | "expected",
    date: expected ? later : today,
    repeat: false,
    day: "",
    itemId: null as string | null,
    early: false,
  });
  // Received income can be typed in another currency (saved in base at this cycle's rate);
  // money on hold stays in the base currency.
  const fx = useForeign(period.startStr);
  const received0 = form.status === "received";
  useEffect(() => {
    if (!received0 && fx.foreign) fx.setCurrency(baseCurrency());
  }, [received0]);
  const inBase = fx.toBase(form.amount);
  const amount = fx.foreign ? inBase.amount : paise(form.amount);
  const received = form.status === "received";
  // Income 1-5 days before payday can count toward the next cycle (counts_from).
  const offer: string | null = received ? nextCycleOffer(form.date, ctx.schedule) : null;
  const early = form.early && !!offer;
  const daysBefore = offer ? cycleDayOf(offer, { startStr: form.date }) - 1 : 0;
  const holdTotal = ctx.held.reduce((s, i) => s + Number(i.amount), 0);

  const statusCtx = { cycleTransactions: model.cycleTransactions, period, today };
  const suggestions = ctx.recurringItems
    .filter((r) => r.type === "income" && r.active)
    .map((r) => {
      const recorded = recurringStatus(r, statusCtx).key === "recorded";
      return {
        id: r.id,
        name: r.name,
        amount: Number(r.amount),
        recorded,
        when: recorded ? "recorded this month" : r.day_of_month ? `day ${r.day_of_month}` : "no fixed day",
      };
    });
  const pick = (id: string) => {
    if (form.itemId === id) return set({ itemId: null });
    const r = ctx.recurringItems.find((x) => x.id === id)!;
    set({
      itemId: id,
      amount: toField(Number(r.amount)),
      type: r.income_type,
      name: r.name,
      status: "received",
      date: today,
      repeat: false,
    });
  };
  const stop = (id: string) =>
    save(
      () => createClient().from("recurring_items").update({ active: false }).eq("id", id),
      async () => {
        const r = ctx.recurringItems.find((x) => x.id === id)!;
        await ctx.saved(`${r.name} stopped repeating · past entries kept`, () =>
          createClient().from("recurring_items").update({ active: true }).eq("id", id),
        );
      },
    );

  let preview: PreviewProps;
  if (amount > 0 && early) {
    preview = {
      label: `Counts from ${shortDate(offer!)}`,
      value: `+${inr(amount)}`,
      line: "added to next cycle’s income",
      sub: `safe to spend stays ${inr(model.safe)}`,
    };
  } else if (amount > 0 && received) {
    preview = safeAfterPreview(
      ctx.previewSafe([{ type: "income", amount, date: form.date }]),
      model.safe,
      period.daysRemaining,
      model.savingsTarget,
    );
    preview.sub = `+${inr(amount)}`;
  } else if (amount > 0) {
    preview = {
      label: "On hold after",
      value: inr(holdTotal + amount),
      line: "not counted until it arrives",
      sub: `safe to spend stays ${inr(model.safe)}`,
    };
  } else {
    preview = { label: "On hold now", value: inr(holdTotal), line: `safe to spend ${inr(model.safe)}` };
  }

  const submit = () => {
    if (!fx.rateOk) return setError("Enter the exchange rate for this cycle.");
    if (amount <= 0) return setError(`Enter an amount above ${inr(0)}.`);
    const name = form.name.trim() || TYPES.find(([k]) => k === form.type)![1];
    const supabase = createClient();
    if (!received) {
      if (form.date <= today) return setError("Expected income needs a date after today.");
      return save(
        () =>
          supabase
            .from("income_sources")
            .insert({
              user_id: ctx.userId,
              name,
              type: form.type,
              status: "expected",
              amount,
              expected_date: form.date,
            })
            .select("id")
            .single()
            .then((r) => ({ error: r.error, data: r.data?.id })),
        async (id) => {
          onClose();
          await ctx.saved(`${inr(amount)} is on hold until it reaches your bank`, () =>
            supabase.from("income_sources").delete().eq("id", id),
          );
        },
      );
    }
    if (form.date < period.startStr || form.date > today)
      return setError("Received income needs a date in this cycle, up to today.");
    const day = form.day ? +form.day : null;
    if (form.repeat && day !== null && !(day >= 1 && day <= 28))
      return setError("Pick a day from 1 to 28, or leave it blank.");
    const viaRecurring = !!form.itemId || form.repeat;
    const countsFrom = early ? offer : null;
    save(
      async () => {
        const r = await (viaRecurring
          ? supabase.rpc("record_entry_with_recurring", {
              p_type: "income",
              p_amount: amount,
              p_date: form.date,
              p_category_id: null,
              p_note: name,
              p_item_id: form.itemId,
              p_make_recurring: !form.itemId,
              p_day: form.itemId ? null : day,
              p_income_type: form.type,
              p_cycle_key: cycleKeyFor(countsFrom ?? form.date, ctx.schedule),
              p_counts_from: countsFrom,
            })
          : supabase.rpc("record_received_income", {
              p_name: name,
              p_amount: amount,
              p_date: form.date,
              p_type: form.type,
              p_counts_from: countsFrom,
            }));
        // The income RPCs take base amounts; keep what was typed on the new entry.
        if (!r.error && fx.foreign && typeof r.data === "string") {
          const u = await supabase.from("transactions").update(inBase.original).eq("id", r.data);
          if (u.error) return { error: u.error, data: r.data };
        }
        return r;
      },
      async (txId) => {
        onClose();
        // The income row and its transaction are linked; deleting the transaction removes both.
        const undo = typeof txId === "string" ? () => supabase.from("transactions").delete().eq("id", txId) : undefined;
        await ctx.saved(
          countsFrom
            ? `Added ${inr(amount)} · counts toward the cycle starting ${shortDate(countsFrom)}`
            : `Added ${inr(amount)} to this cycle’s income${form.repeat && !form.itemId ? " · repeats monthly" : ""}`,
          undo,
        );
      },
    );
  };

  const month = new Date(`${today}T12:00:00`).toLocaleDateString("en-GB", { month: "long" });
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`Income · ${month} cycle`}
      title="Record income"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={
        busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : amount > 0 ? `Save ${inr(amount)}` : "Save income"
      }
      sheetHeader={onSwitch && <AddTabs current="income" onSwitch={() => onSwitch(form.amount)} />}
    >
      {!keyboardOpen && <Suggestions items={suggestions} selected={form.itemId} onPick={pick} onStop={stop} />}
      <AmountField
        id="in-amt"
        value={form.amount}
        onChange={(v) => set({ amount: v })}
        currency={fx.currency}
        chip={
          received0 && (
            <CurrencyChip currency={fx.currency} open={fx.listOpen} onToggle={() => fx.setListOpen(!fx.listOpen)} />
          )
        }
      >
        {fx.listOpen && received0 && (
          <CurrencyList
            value={fx.currency}
            onPick={(c) => {
              fx.setCurrency(c);
              set({ amount: "" });
            }}
            onClose={() => fx.setListOpen(false)}
          />
        )}
        {received0 && <RateLine fx={fx} typed={form.amount} cycleStart={period.startStr} ownRate id="in" />}
      </AmountField>
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">Type</span>
        <div
          role="radiogroup"
          aria-label="Income type"
          className="flex gap-0.5 rounded-full border border-line p-[3px]"
        >
          {TYPES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={form.type === k}
              onClick={() => set(k === "variable" ? { type: k, status: "expected", date: later } : { type: k })}
              className="min-h-[38px] min-w-0 flex-1 cursor-pointer rounded-full border-0 px-2 py-1 text-[13px] leading-[1.2] font-semibold transition-colors duration-200"
              style={{
                background: form.type === k ? "var(--ink)" : "transparent",
                color: form.type === k ? "var(--bg)" : "var(--muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Labeled id="in-name" label="Source" optional>
        <input
          id="in-name"
          type="text"
          placeholder={TYPES.find(([k]) => k === form.type)![2]}
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          className={FIELD}
        />
      </Labeled>
      <div className="flex flex-col gap-2.5">
        <span className="eyebrow">Status</span>
        <div
          role="radiogroup"
          aria-label="Income status"
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,190px),1fr))] gap-2"
        >
          {(
            [
              ["received", "Received in bank", "Counts toward safe to spend now.", "var(--lime)", "var(--lime-soft)"],
              [
                "expected",
                "Expected later",
                "Held aside until you mark it received.",
                "var(--warn)",
                "var(--warn-soft)",
              ],
            ] as const
          ).map(([k, label, desc, c, soft]) => {
            const on = form.status === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ status: k, date: k === "expected" ? later : today })}
                className="flex cursor-pointer items-start gap-3 rounded-[14px] border px-4 py-3.5 text-left transition-colors duration-200"
                style={{
                  borderColor: on ? c : "var(--line)",
                  background: on ? soft : "transparent",
                  boxShadow: on ? `inset 0 0 0 1px ${c}` : "none",
                }}
              >
                <span
                  className="mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-[1.5px]"
                  style={{ borderColor: on ? c : "var(--line-2)" }}
                >
                  <span
                    className="h-2 w-2 rounded-full transition-transform duration-200"
                    style={{ background: c, transform: `scale(${on ? 1 : 0})` }}
                  />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{label}</span>
                  <span className="text-[13px] text-pretty text-muted">{desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] items-end gap-3.5">
        <Labeled id="in-date" label={received ? "Received on" : "Expected on"}>
          <input
            id="in-date"
            type="date"
            min={received ? period.startStr : addDaysStr(today, 1)}
            max={received ? today : undefined}
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        {received && !form.itemId && (
          <div className="flex min-h-12 items-center gap-3 rounded-xl border border-line py-1.5 pr-2 pl-3.5">
            <span className="flex-1 text-sm font-semibold">Repeat every month</span>
            <Switch on={form.repeat} onToggle={() => set({ repeat: !form.repeat })} label="Repeat every month" />
          </div>
        )}
      </div>
      {received && !form.itemId && (
        <div
          className="-mt-3 grid transition-[grid-template-rows] duration-300 ease-soft"
          style={{ gridTemplateRows: form.repeat ? "1fr" : "0fr" }}
        >
          <div className="overflow-hidden">
            <DueDayField id="in-day" value={form.day} onChange={(v) => set({ day: v })} />
          </div>
        </div>
      )}
      {offer && (
        <SwitchRow
          title={`Count toward the cycle starting ${shortDate(offer)}`}
          sub={`This arrived ${daysBefore} day${daysBefore === 1 ? "" : "s"} before payday. Turn this on if it’s meant for next month: it stays out of this cycle’s safe to spend and is counted from ${shortDate(offer)}.`}
          on={form.early}
          onToggle={() => set({ early: !form.early })}
        />
      )}
      <Preview {...preview} />
    </Dialog>
  );
}
