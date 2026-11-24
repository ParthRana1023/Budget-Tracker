"use client";

// Edit recurring item (design handoff, Popups).

import { createClient } from "@/utils/supabase/client";
import { cleanTyped, inr, showTyped, toMajor } from "@/lib/money.mjs";
import Dialog from "../../ui/Dialog";
import type { RecurringItem } from "../types";
import type { PopupContext } from "./context";
import { FIELD, Labeled, MethodPicker, SAVE_FAILED, cleanDay, toField, useForeign, usePopupForm } from "./parts";
import { CurrencyChip, CurrencyList, RateLine } from "./currency";

export default function RecurringDialog({
  ctx,
  item,
  onClose,
}: {
  ctx: PopupContext;
  item: RecurringItem;
  onClose: () => void;
}) {
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    name: item.name,
    // A foreign bill is edited in its own currency; its base amount follows each cycle's rate.
    amount: item.original_currency
      ? String(toMajor(Number(item.original_amount), item.original_currency))
      : toField(Number(item.amount)),
    day: item.day_of_month ? String(item.day_of_month) : "",
    method: item.payment_method ?? null,
  });
  const isExpense = item.type === "expense";
  const fx = useForeign(
    ctx.period.startStr,
    item.original_currency
      ? { currency: item.original_currency, rate: Number(item.fx_rate), date: item.fx_date ?? null }
      : null,
  );

  const submit = () => {
    const name = form.name.trim(),
      { amount, original } = fx.toBase(form.amount),
      day = form.day ? +form.day : null;
    if (!name) return setError("Give it a name.");
    if (!fx.rateOk) return setError("Enter the exchange rate for this cycle.");
    if (amount <= 0) return setError(`Enter an amount above ${inr(0)}.`);
    if (day !== null && !(day >= 1 && day <= 28)) return setError("Pick a day from 1 to 28, or leave it blank.");
    const db = createClient();
    save(
      () =>
        db
          .from("recurring_items")
          .update({
            name,
            amount,
            day_of_month: day,
            ...original,
            ...(isExpense && { payment_method: form.method }),
          })
          .eq("id", item.id),
      async () => {
        onClose();
        await ctx.saved(`${name} updated`, () =>
          db
            .from("recurring_items")
            .update({
              name: item.name,
              amount: item.amount,
              day_of_month: item.day_of_month,
              payment_method: item.payment_method ?? null,
              original_amount: item.original_amount ?? null,
              original_currency: item.original_currency ?? null,
              fx_rate: item.fx_rate ?? null,
              fx_date: item.fx_date ?? null,
            })
            .eq("id", item.id),
        );
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Repeats every month"
      title="Edit recurring item"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : "Save changes"}
    >
      <Labeled id="ru-name" label="Name">
        <input
          id="ru-name"
          type="text"
          autoFocus
          value={form.name}
          onChange={(e) => set({ name: e.target.value })}
          className={FIELD}
        />
      </Labeled>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
        <Labeled id="ru-amt" label="Amount">
          <div className="flex gap-2">
            <input
              id="ru-amt"
              type="text"
              inputMode="decimal"
              value={showTyped(form.amount)}
              onChange={(e) => set({ amount: cleanTyped(e.target.value, undefined, fx.currency) })}
              className={`${FIELD} tabular`}
            />
            <CurrencyChip
              size={48}
              currency={fx.currency}
              open={fx.listOpen}
              onToggle={() => fx.setListOpen(!fx.listOpen)}
            />
          </div>
        </Labeled>
        <Labeled id="ru-day" label="Day (1–28)" optional>
          <input
            id="ru-day"
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder="—"
            value={form.day}
            onChange={(e) => set({ day: cleanDay(e.target.value) })}
            className={FIELD}
          />
        </Labeled>
      </div>
      {fx.listOpen && (
        <CurrencyList
          value={fx.currency}
          onPick={(c) => {
            fx.setCurrency(c);
            set({ amount: "" });
          }}
          onClose={() => fx.setListOpen(false)}
        />
      )}
      {/* Bills are worked out again each cycle, so there's no "your own rate" here. */}
      <RateLine fx={fx} typed={form.amount} cycleStart={ctx.period.startStr} id="ru" />
      {isExpense && (
        <MethodPicker
          id="ru-method"
          label="Usually paid with"
          value={form.method}
          onChange={(method) => set({ method })}
          hint="Entries recorded from this item use it: Due notices, Record buttons and suggestions."
        />
      )}
      <span className="text-[13px] text-pretty text-muted">
        Changes apply from the next time it’s recorded. Past entries stay as they are.
      </span>
    </Dialog>
  );
}
