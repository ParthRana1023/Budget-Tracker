"use client";

// Edit entry (design handoff, Popups): amount, category, date, note (+ payee, paid with), or delete.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { baseCurrency, cleanTyped, formatExact, inr, showTyped, toMajor, toMinor } from "@/lib/money.mjs";
import { convert } from "@/lib/fx.mjs";
import { dayLabel, shortDate } from "@/lib/cycle.mjs";
import Dialog from "../../ui/Dialog";
import type { Tx } from "../types";
import type { PopupContext } from "./context";
import {
  AmountField,
  FIELD,
  Labeled,
  MethodPicker,
  Preview,
  SAVE_FAILED,
  paise,
  safeAfterPreview,
  toField,
  usePopupForm,
} from "./parts";
import { rateText } from "./currency";

const KIND = { income: "Income", savings_transfer: "Savings transfer", reserve_transfer: "Reserve" } as const;

export default function EditEntryDialog({
  ctx,
  entry,
  onClose,
}: {
  ctx: PopupContext;
  entry: Tx;
  onClose: () => void;
}) {
  const { model, today, period } = ctx;
  const isExpense = entry.type === "expense";
  const cur = entry.original_currency ?? null;
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    // A foreign entry is edited in what was typed; its rate stays the one it was saved with.
    amount: cur ? String(toMajor(Number(entry.original_amount), cur)) : toField(Number(entry.amount)),
    categoryId: entry.category_id ?? "",
    date: entry.date,
    note: entry.note ?? "",
    payee: entry.payee ?? "",
    method: entry.payment_method ?? null,
  });
  const [confirming, setConfirming] = useState(false);
  const originalMinor = cur ? toMinor(parseFloat(form.amount) || 0, cur) : null;
  // A foreign entry's base amount follows the saved rate, unless typed over (bank fees).
  const [charged, setCharged] = useState("");
  const atRate = cur ? convert(originalMinor!, cur, Number(entry.fx_rate)) : 0;
  const amount = cur ? (charged ? paise(charged) : atRate) : paise(form.amount);
  const label = isExpense
    ? (model.byId.get(entry.category_id ?? "")?.name ?? entry.category?.name ?? "Uncategorised")
    : KIND[entry.type as keyof typeof KIND];
  const after = ctx.previewSafe(
    [{ ...entry, amount, date: form.date, category_id: isExpense ? form.categoryId || null : entry.category_id }],
    entry.id,
  );

  const restore = async () => {
    const db = createClient();
    const r = await db.rpc("update_financial_transaction", {
      p_transaction_id: entry.id,
      p_amount: Number(entry.amount),
      p_date: entry.date,
      p_category_id: entry.category_id,
      p_note: entry.note,
    });
    if (r.error || !isExpense) return r;
    return db
      .from("transactions")
      .update({
        payee: entry.payee ?? null,
        payment_method: entry.payment_method ?? null,
        ...(cur && { original_amount: entry.original_amount }),
      })
      .eq("id", entry.id);
  };

  const submit = () => {
    if (amount <= 0) return setError(`Enter an amount above ${inr(0)}.`);
    if (form.date < period.startStr || form.date > today) return setError("Pick a date in this cycle, up to today.");
    const supabase = createClient();
    save(
      async () => {
        const r = await supabase.rpc("update_financial_transaction", {
          p_transaction_id: entry.id,
          p_amount: amount,
          p_date: form.date,
          p_category_id: isExpense ? form.categoryId || null : entry.category_id,
          p_note: form.note.trim() || entry.note,
        });
        const payee = form.payee.trim() || null;
        const unchanged =
          payee === (entry.payee ?? null) &&
          form.method === (entry.payment_method ?? null) &&
          originalMinor === (cur ? Number(entry.original_amount) : null);
        if (r.error || !isExpense || unchanged) return r;
        return supabase
          .from("transactions")
          .update({ payee, payment_method: form.method, ...(cur && { original_amount: originalMinor }) })
          .eq("id", entry.id);
      },
      async () => {
        onClose();
        await ctx.saved("Entry updated", restore);
      },
    );
  };

  // Linked rows (income source, goal contribution) go with the transaction; a recurring item stays.
  const remove = () =>
    save(
      () => createClient().from("transactions").delete().eq("id", entry.id),
      async () => {
        onClose();
        // Undo puts a plain expense back; income and transfers have linked rows, so no undo for those.
        const row = {
          user_id: ctx.userId,
          type: entry.type,
          amount: entry.amount,
          date: entry.date,
          note: entry.note,
          category_id: entry.category_id,
          payee: entry.payee ?? null,
          payment_method: entry.payment_method ?? null,
          original_amount: entry.original_amount ?? null,
          original_currency: entry.original_currency ?? null,
          fx_rate: entry.fx_rate ?? null,
          fx_date: entry.fx_date ?? null,
          from_reserve: !!entry.from_reserve,
          external_id: entry.external_id,
        };
        const undo = isExpense ? () => createClient().from("transactions").insert(row) : undefined;
        await ctx.saved(`Deleted ${entry.note || label}`, undo);
      },
    );

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`${dayLabel(entry.date, today)} · ${label}`}
      title="Edit entry"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : "Save changes"}
    >
      <AmountField id="ed-amt" value={form.amount} onChange={(v) => set({ amount: v })} currency={cur ?? undefined}>
        {cur && (
          <div className="flex flex-col gap-3 rounded-xl bg-tile-2 px-3.5 py-3">
            <span className="tabular text-sm">
              <span className="font-semibold">
                Paid {formatExact(originalMinor!, cur)} at {rateText(Number(entry.fx_rate), cur)}
              </span>
              <span className="text-muted"> · rate from {shortDate(entry.fx_date ?? entry.date)}</span>
            </span>
            <Labeled id="ed-charged" label={`Charged in ${baseCurrency()}`}>
              <input
                id="ed-charged"
                type="text"
                inputMode="decimal"
                placeholder={showTyped(toField(atRate))}
                value={showTyped(charged)}
                onChange={(e) => setCharged(cleanTyped(e.target.value))}
                className={`${FIELD} tabular`}
              />
            </Labeled>
            <span className="-mt-1.5 text-xs text-muted">Change it to match your bank statement, fees included.</span>
          </div>
        )}
      </AmountField>
      {isExpense && (
        <Labeled id="ed-cat" label="Category">
          <select
            id="ed-cat"
            value={form.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
            className={FIELD}
          >
            {[...model.flex, ...model.fixed].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.type === "flexible" ? "flexible" : "fixed"}
              </option>
            ))}
          </select>
        </Labeled>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
        <Labeled id="ed-date" label="Date">
          <input
            id="ed-date"
            type="date"
            min={period.startStr}
            max={today}
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        <Labeled id="ed-note" label="Note">
          <input
            id="ed-note"
            type="text"
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        {isExpense && (
          <Labeled id="ed-payee" label="Payee" optional>
            <input
              id="ed-payee"
              type="text"
              maxLength={120}
              value={form.payee}
              onChange={(e) => set({ payee: e.target.value })}
              className={FIELD}
            />
          </Labeled>
        )}
      </div>
      {isExpense && (
        <MethodPicker
          id="ed-method"
          value={form.method}
          onChange={(method) => set({ method })}
          hint="Tracking only: it doesn’t change any numbers."
        />
      )}
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Delete entry"
          className="flex flex-col gap-3 rounded-[14px] border border-danger bg-danger-soft p-4"
        >
          <span className="font-bold">Delete this entry?</span>
          <span className="text-sm text-pretty text-ink-2">
            {entry.external_id?.startsWith("recurring:")
              ? `${inr(entry.amount)} on ${dayLabel(entry.date, today)} will be removed. It stays on your recurring list for next month.`
              : `${inr(entry.amount)} on ${dayLabel(entry.date, today)} will be removed from this cycle.`}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={remove}
              className="h-10 cursor-pointer rounded-full border-0 bg-danger px-[18px] text-sm font-bold text-danger-ink"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-10 cursor-pointer rounded-full border border-line-2 bg-transparent px-4 text-sm font-semibold"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex cursor-pointer items-center gap-2 self-start border-0 bg-transparent py-1 text-sm font-semibold text-danger"
        >
          <Trash2 size={14} />
          Delete this entry
        </button>
      )}
      <Preview {...safeAfterPreview(after, model.safe, period.daysRemaining, model.savingsTarget)} />
    </Dialog>
  );
}
