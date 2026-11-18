"use client";

// Edit recurring item (design handoff, Popups).

import { createClient } from "@/utils/supabase/client";
import Dialog from "../../ui/Dialog";
import type { RecurringItem } from "../types";
import type { PopupContext } from "./context";
import { FIELD, Labeled, SAVE_FAILED, cleanAmount, cleanDay, paise, toField, usePopupForm } from "./parts";

export default function RecurringDialog({ ctx, item, onClose }: { ctx: PopupContext; item: RecurringItem; onClose: () => void }) {
  const { form, set, dirty, error, setError, busy, save } = usePopupForm({
    name: item.name,
    amount: toField(Number(item.amount)),
    day: item.day_of_month ? String(item.day_of_month) : "",
  });

  const submit = () => {
    const name = form.name.trim(), amount = paise(form.amount), day = form.day ? +form.day : null;
    if (!name) return setError("Give it a name.");
    if (amount <= 0) return setError("Enter an amount above ₹0.");
    if (day !== null && !(day >= 1 && day <= 28)) return setError("Pick a day from 1 to 28, or leave it blank.");
    const db = createClient();
    save(
      () => db.from("recurring_items").update({ name, amount, day_of_month: day }).eq("id", item.id),
      async () => {
        onClose();
        await ctx.saved(`${name} updated`, () =>
          db.from("recurring_items").update({ name: item.name, amount: item.amount, day_of_month: item.day_of_month }).eq("id", item.id),
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
        <input id="ru-name" type="text" autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} className={FIELD} />
      </Labeled>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3.5">
        <Labeled id="ru-amt" label="Amount">
          <input id="ru-amt" type="text" inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: cleanAmount(e.target.value) })} className={`${FIELD} tabular`} />
        </Labeled>
        <Labeled id="ru-day" label="Day (1–28)" optional>
          <input id="ru-day" type="text" inputMode="numeric" maxLength={2} placeholder="—" value={form.day} onChange={(e) => set({ day: cleanDay(e.target.value) })} className={FIELD} />
        </Labeled>
      </div>
      <span className="text-[13px] text-pretty text-muted">Changes apply from the next time it’s recorded. Past entries stay as they are.</span>
    </Dialog>
  );
}
