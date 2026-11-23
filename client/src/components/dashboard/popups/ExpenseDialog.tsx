"use client";

// Log expense (design handoff, Popups).

import { createClient } from "@/utils/supabase/client";
import { inr, showTyped } from "@/lib/money.mjs";
import { recurringStatus } from "@/lib/recurringStatus.mjs";
import Dialog from "../../ui/Dialog";
import type { Category } from "../types";
import type { PopupContext } from "./context";
import { cycleKeyFor } from "@/lib/cycle.mjs";
import type { PaymentMethod } from "@/lib/paymentMethods.mjs";
import {
  AmountField,
  DueDayField,
  FIELD,
  Labeled,
  MethodSelect,
  Preview,
  SAVE_FAILED,
  SwitchRow,
  Suggestions,
  paise,
  safeAfterPreview,
  toField,
  usePopupForm,
  type PreviewProps,
} from "./parts";

export type ExpensePrefill = { categoryId?: string; amount?: number; note?: string; fromReserve?: boolean };
const QUICK = [100, 250, 500, 1000, 2000];

export default function ExpenseDialog({
  ctx,
  prefill,
  onClose,
}: {
  ctx: PopupContext;
  prefill: ExpensePrefill;
  onClose: () => void;
}) {
  const { model, today, period } = ctx;
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    amount: prefill.amount ? toField(prefill.amount) : "",
    categoryId: prefill.categoryId ?? "",
    date: today,
    note: prefill.note ?? "",
    payee: "",
    method: null as PaymentMethod | null,
    fromReserve: !!prefill.fromReserve,
    repeat: false,
    day: "",
    itemId: null as string | null,
  });
  const amount = paise(form.amount);
  const cat = form.categoryId ? model.byId.get(form.categoryId) : undefined;
  const spent = (c: Category) => model.spentByCat.get(c.id) ?? 0;

  const statusCtx = { cycleTransactions: model.cycleTransactions, period, today };
  const suggestions = ctx.recurringItems
    .filter((r) => r.type === "expense" && r.active)
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
      categoryId: r.category_id ?? "",
      note: r.name,
      method: r.payment_method ?? null,
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

  // Preview of the result.
  let preview: PreviewProps;
  if (amount > 0) {
    const after = ctx.previewSafe([
      {
        type: "expense",
        amount,
        date: form.date,
        category_id: form.categoryId || null,
        from_reserve: form.fromReserve,
      },
    ]);
    preview = safeAfterPreview(after, model.safe, period.daysRemaining, model.savingsTarget, "After this");
    if (cat?.type === "flexible" && Number(cat.monthly_limit) > 0 && !form.fromReserve) {
      const limit = Number(cat.monthly_limit),
        b4 = spent(cat),
        aft = b4 + amount;
      if (aft > limit)
        preview.notes!.unshift({
          text: `Takes ${cat.name} ${inr(aft - limit)} over its monthly limit.`,
          tone: "danger",
        });
      else if (aft / limit >= 0.8 && b4 / limit < 0.8)
        preview.notes!.unshift({
          text: `Brings ${cat.name} to ${Math.round((aft / limit) * 100)}% of its limit.`,
          tone: "warn",
        });
    }
    if (cat?.type === "fixed" && spent(cat) + amount <= Number(cat.monthly_limit)) {
      preview = {
        ...preview,
        label: "Paid from reserved bills",
        sub: `${inr(Number(cat.monthly_limit) - spent(cat))} was set aside`,
      };
    }
  } else {
    preview = {
      label: "Safe to spend now",
      value: inr(model.safe),
      line: `${inr(Math.max(0, model.safe) / period.daysRemaining)} a day for ${period.daysRemaining} days`,
    };
  }

  const submit = () => {
    if (amount <= 0) return setError("Enter an amount above ₹0.");
    if (!form.categoryId) return setError("Pick a category.");
    const day = form.day ? +form.day : null;
    if (form.repeat && day !== null && !(day >= 1 && day <= 28))
      return setError("Pick a day from 1 to 28, or leave it blank.");
    if (form.date < period.startStr || form.date > today) return setError("Pick a date in this cycle, up to today.");
    if (form.fromReserve && amount > model.reserveLeft)
      return setError(`The annual bills reserve only has ${inr(model.reserveLeft)} left.`);
    const note = form.note.trim() || cat!.name;
    const payee = form.payee.trim() || null;
    const supabase = createClient();
    const viaRecurring = !!form.itemId || form.repeat;

    save(
      async () => {
        if (!viaRecurring) {
          return supabase
            .from("transactions")
            .insert({
              user_id: ctx.userId,
              type: "expense",
              amount,
              date: form.date,
              category_id: form.categoryId,
              note,
              payee,
              payment_method: form.method,
              from_reserve: form.fromReserve,
            })
            .select("id")
            .single()
            .then((r) => ({ error: r.error, data: r.data?.id }));
        }
        const r = await supabase.rpc("record_entry_with_recurring", {
          p_type: "expense",
          p_amount: amount,
          p_date: form.date,
          p_category_id: form.categoryId,
          p_note: note,
          p_item_id: form.itemId,
          p_make_recurring: !form.itemId,
          p_day: form.itemId ? null : day,
          p_cycle_key: cycleKeyFor(form.date, ctx.schedule),
        });
        // The recurring path doesn't take these; set them on the new entry. With an item, the
        // method shown here (its default, changed or cleared) replaces the one the database copied.
        if (!r.error && (payee || form.fromReserve || form.method || form.itemId)) {
          const u = await supabase
            .from("transactions")
            .update({ payee, from_reserve: form.fromReserve, payment_method: form.method })
            .eq("id", r.data);
          if (u.error) return { error: u.error, data: r.data };
        }
        return r;
      },
      async (txId) => {
        onClose();
        const madeRule = form.repeat && !form.itemId;
        await ctx.saved(
          `Logged ${inr(amount)} to ${cat!.name}${form.fromReserve ? " · paid from reserve" : ""}${madeRule ? (day ? ` · due on day ${day}` : " · suggested monthly") : ""}`,
          async () => {
            const { data: row } = await supabase.from("transactions").select("external_id").eq("id", txId).single();
            const del = await supabase.from("transactions").delete().eq("id", txId);
            // Undo also removes a schedule this entry created.
            const itemId = madeRule ? row?.external_id?.split(":")[1] : null;
            if (!del.error && itemId) return supabase.from("recurring_items").delete().eq("id", itemId);
            return del;
          },
        );
      },
    );
  };

  const tile = (c: Category) => {
    const sel = form.categoryId === c.id,
      s = spent(c),
      limit = Number(c.monthly_limit);
    const sub =
      c.type === "fixed"
        ? s >= limit
          ? "Paid"
          : `${inr(limit - s)} due`
        : !limit
          ? "No limit"
          : s > limit
            ? `${inr(s - limit)} over`
            : `${inr(limit - s)} left`;
    const subColor =
      c.type === "flexible" && limit && s > limit
        ? "var(--danger)"
        : c.type === "flexible" && limit && s / limit >= 0.8
          ? "var(--warn)"
          : "var(--muted)";
    return (
      <button
        key={c.id}
        type="button"
        aria-pressed={sel}
        onClick={() => set({ categoryId: c.id })}
        className="flex min-h-[54px] cursor-pointer flex-col items-start justify-center gap-px rounded-xl border px-3 py-2 text-left transition-[border-color,background,transform] duration-200 active:scale-[.97]"
        style={{
          borderColor: sel ? "var(--lime)" : "var(--line)",
          background: sel ? "var(--lime-soft)" : "transparent",
          boxShadow: sel ? "inset 0 0 0 1px var(--lime)" : "none",
        }}
      >
        <span className="text-sm leading-[1.25] font-semibold">{c.name}</span>
        <span className="tabular text-xs" style={{ color: subColor }}>
          {sub}
        </span>
      </button>
    );
  };
  const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,132px),1fr))] gap-1.5";
  const catInfo = !cat
    ? "Pick one"
    : cat.type === "flexible"
      ? Number(cat.monthly_limit)
        ? `${inr(spent(cat))} of ${inr(Number(cat.monthly_limit))} used`
        : "No limit set"
      : `${inr(spent(cat))} of ${inr(Number(cat.monthly_limit))} paid`;

  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow={`Day ${period.daysElapsed} of ${period.totalDays} · ${inr(model.safe)} safe to spend`}
      title="Log expense"
      size="lg"
      dirty={dirty}
      error={error}
      onSubmit={submit}
      busy={busy}
      submitLabel={
        busy ? "Saving…" : error === SAVE_FAILED ? "Try again" : amount > 0 ? `Log ${inr(amount)}` : "Log expense"
      }
    >
      <Suggestions items={suggestions} selected={form.itemId} onPick={pick} onStop={stop} icon />
      <AmountField id="ex-amt" value={form.amount} onChange={(v) => set({ amount: v })}>
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => set({ amount: String(Math.round((paise(form.amount) / 100 + q) * 100) / 100) })}
              className="tabular h-[34px] cursor-pointer rounded-full border border-line bg-transparent px-3 text-[13px] font-semibold text-ink-2 transition-[border-color,color,transform] hover:border-ink-2 hover:text-ink active:scale-[.94]"
            >
              +{showTyped(String(q))}
            </button>
          ))}
          {form.amount && (
            <button
              type="button"
              onClick={() => set({ amount: "" })}
              className="h-[34px] cursor-pointer border-0 bg-transparent px-2.5 text-[13px] text-muted hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>
      </AmountField>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="eyebrow">Category</span>
          <span className="tabular text-[13px] text-muted">{catInfo}</span>
        </div>
        <span className="font-serif text-[17px] text-ink-2 italic">Flexible</span>
        <div className={grid}>{model.flex.map(tile)}</div>
        <span className="pt-1 font-serif text-[17px] text-ink-2 italic">Fixed bills</span>
        <div className={grid}>{model.fixed.map(tile)}</div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
        <Labeled id="ex-date" label="Date">
          <input
            id="ex-date"
            type="date"
            min={period.startStr}
            max={today}
            value={form.date}
            onChange={(e) => set({ date: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        <Labeled id="ex-note" label="Note" optional>
          <input
            id="ex-note"
            type="text"
            placeholder="Swiggy lunch, fuel"
            value={form.note}
            onChange={(e) => set({ note: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        <Labeled id="ex-payee" label="Payee" optional>
          <input
            id="ex-payee"
            type="text"
            maxLength={120}
            placeholder="Swiggy, DMart"
            value={form.payee}
            onChange={(e) => set({ payee: e.target.value })}
            className={FIELD}
          />
        </Labeled>
        <MethodSelect id="ex-method" value={form.method} onChange={(method) => set({ method })} />
      </div>

      {model.reserveLeft > 0 && (
        <SwitchRow
          title="Pay from annual bills reserve"
          sub={`${inr(model.reserveLeft)} available · doesn’t touch safe to spend`}
          on={form.fromReserve}
          onToggle={() => set({ fromReserve: !form.fromReserve })}
        />
      )}
      {!form.itemId && (
        <SwitchRow
          title="Repeat every month"
          sub="Rent, subscriptions, EMIs"
          on={form.repeat}
          onToggle={() => set({ repeat: !form.repeat })}
        >
          <DueDayField id="ex-day" value={form.day} onChange={(v) => set({ day: v })} />
        </SwitchRow>
      )}
      <Preview {...preview} />
    </Dialog>
  );
}
