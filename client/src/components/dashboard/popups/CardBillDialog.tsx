"use client";

// "Card bill paid" (handoff v4 §1, Dashboard.dc.html ?modal=payCard). Saves a card_payment: a
// transfer that only lowers what's owed on the card. Safe to spend, budgets and Reports spending
// never read it, because each purchase was counted when it was logged.

import { ShieldCheck } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { inr } from "@/lib/money.mjs";
import { cardsSummary } from "@/lib/cards.mjs";
import Dialog from "../../ui/Dialog";
import { cardChip, cardTone, dueLabel, owedText } from "../CardBills";
import type { PopupContext } from "./context";
import { AmountField, FIELD, Labeled, Preview, SAVE_FAILED, paise, toField, usePopupForm } from "./parts";

export default function CardBillDialog({
  ctx,
  cardId,
  onClose,
}: {
  ctx: PopupContext;
  /** The card tapped; else the most urgent one. */
  cardId?: string | null;
  onClose: () => void;
}) {
  const { today, period, model } = ctx;
  const { cards, urgent } = cardsSummary(ctx.cards, ctx.transactions, today);
  const first = cards.find((c) => c.id === cardId) ?? urgent ?? cards[0];
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    cardId: first?.id ?? "",
    amount: first && first.owed > 0 ? toField(first.owed) : "",
    date: today,
    note: "",
  });
  const card = cards.find((c) => c.id === form.cardId);
  const amount = paise(form.amount);
  if (!card) return null;
  const full = card.owed > 0 && amount === card.owed;

  const submit = () => {
    if (amount <= 0) return setError(`Enter an amount above ${inr(0)}.`);
    if (form.date > today) return setError("Pick a date up to today.");
    const supabase = createClient();
    save(
      () =>
        supabase
          .from("transactions")
          .insert({
            user_id: ctx.userId,
            type: "card_payment",
            card_id: card.id,
            amount,
            date: form.date,
            note: form.note.trim().slice(0, 120) || null,
          })
          .select("id")
          .single()
          .then((r) => ({ error: r.error, data: r.data?.id })),
      async (txId) => {
        onClose();
        await ctx.saved(`${card.name} bill paid · ${inr(amount)}`, () =>
          supabase
            .from("transactions")
            .delete()
            .eq("id", txId as string),
        );
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`${card.name} · ${card.owed > 0 ? `${inr(card.owed)} owed` : card.owed < 0 ? `${inr(-card.owed)} in credit` : "nothing owed"}`}
      title="Card bill paid"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={
        busy
          ? "Saving…"
          : error === SAVE_FAILED
            ? "Try again"
            : amount > 0
              ? `Mark ${inr(amount)} paid`
              : "Mark as paid"
      }
    >
      {cards.length > 1 && (
        <div className="flex flex-col gap-2">
          <span id="pc-card-l" className="eyebrow">
            Card
          </span>
          <div
            role="radiogroup"
            aria-labelledby="pc-card-l"
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2"
          >
            {cards.map((c) => {
              const on = c.id === card.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ cardId: c.id, amount: c.owed > 0 ? toField(c.owed) : "" })}
                  className="flex min-w-0 cursor-pointer flex-col gap-0.5 rounded-xl border px-3.5 py-3 text-left transition-[border-color,background] duration-200"
                  style={{
                    borderColor: on ? "var(--lime)" : "var(--line)",
                    background: on ? "var(--lime-soft)" : "transparent",
                    boxShadow: on ? "inset 0 0 0 1px var(--lime)" : "none",
                  }}
                >
                  <span className="truncate text-sm font-semibold">{c.name}</span>
                  <span
                    className="tabular text-[13px]"
                    style={{ color: c.status === "overdue" || c.status === "soon" ? cardTone(c) : "var(--muted)" }}
                  >
                    {c.owed > 0
                      ? `${inr(c.owed)} · ${(c.status === "overdue" ? cardChip(c) : dueLabel(c)).toLowerCase()}`
                      : c.owed < 0
                        ? owedText(c)
                        : "Nothing owed"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <AmountField id="pc-amt" value={form.amount} onChange={(v) => set({ amount: v })}>
        {card.owed > 0 && (
          <button
            type="button"
            onClick={() => set({ amount: toField(card.owed) })}
            aria-pressed={full}
            className="tabular h-[38px] cursor-pointer self-start rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap"
            style={{
              borderColor: full ? "var(--lime)" : "var(--line-2)",
              background: full ? "var(--lime-soft)" : "transparent",
            }}
          >
            Full balance · {inr(card.owed)}
          </button>
        )}
        {amount > 0 && (
          <p role="status" aria-live="polite" className="tabular m-0 text-sm font-semibold text-pretty text-ink-2">
            {full
              ? `Clears ${card.name}.`
              : amount > card.owed
                ? `Leaves ${inr(amount - Math.max(0, card.owed))} credit on ${card.name}.`
                : `${inr(card.owed - amount)} still owed on ${card.name} after this.`}
          </p>
        )}
      </AmountField>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3.5">
        <Labeled id="pc-date" label="Date paid">
          <input
            id="pc-date"
            type="date"
            max={today}
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        <Labeled id="pc-note" label="Note" optional>
          <input
            id="pc-note"
            type="text"
            maxLength={120}
            placeholder="Paid from savings account"
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            className={FIELD}
          />
        </Labeled>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 text-[13px] text-pretty text-ink-2">
        <ShieldCheck size={16} aria-hidden className="mt-px flex-none text-lime-text" />
        <span>
          Marking a bill paid doesn’t change safe to spend. The spending was already counted when you logged each
          purchase, so this only lowers what you owe.
        </span>
      </div>
      <Preview
        label="Safe to spend"
        value={inr(model.safe)}
        line="stays the same"
        sub={`${period.daysRemaining} days to payday`}
      />
    </Dialog>
  );
}
