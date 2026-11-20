"use client";

// Recurring items (design handoff v2, Settings › Categories & fixed bills › Edit recurring):
// every item with name, amount, day, a repeat switch and delete, plus an Add row.
// Changes apply on close, with Undo (lib/recurringDiff.mjs).

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { inr, showTyped } from "@/lib/money.mjs";
import { recurringDiff, recurringProblems } from "@/lib/recurringDiff.mjs";
import Dialog from "../../ui/Dialog";
import type { RecurringItem } from "../types";
import type { PopupContext } from "./context";
import { FIELD, SAVE_FAILED, OFFLINE, Switch, cleanAmount, cleanDay, paise, toField } from "./parts";

const SMALL =
  "h-10 rounded-[10px] border border-line-2 bg-tile-2 text-[15px] text-ink outline-none focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";
const INCOME = "income";

/** Applies a diff; returns the first error. */
async function apply(d: ReturnType<typeof recurringDiff>) {
  const db = createClient();
  for (const u of d.updates) {
    const r = await db.from("recurring_items").update(u.patch).eq("id", u.id);
    if (r.error) return r.error;
  }
  if (d.deletes.length) {
    const r = await db.from("recurring_items").delete().in("id", d.deletes);
    if (r.error) return r.error;
  }
  if (d.inserts.length) {
    const r = await db.from("recurring_items").insert(d.inserts);
    if (r.error) return r.error;
  }
  return null;
}

export default function RecurringListDialog({ ctx, onClose }: { ctx: PopupContext; onClose: () => void }) {
  const before = ctx.recurringItems;
  const [draft, setDraft] = useState<RecurringItem[]>(before);
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(before.map((r) => [r.id, toField(Number(r.amount))])),
  );
  const [add, setAdd] = useState({ name: "", cat: INCOME, amount: "", day: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = ctx.categories.filter((c) => c.is_active !== false);
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name;

  const update = (id: string, patch: Partial<RecurringItem>) => {
    setDraft((d) => d.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setError(null);
  };

  const addItem = () => {
    const name = add.name.trim(),
      amount = paise(add.amount);
    if (!name) return setError("Name the recurring item.");
    if (amount <= 0) return setError("Add an amount above ₹0.");
    const income = add.cat === INCOME;
    const row = {
      id: crypto.randomUUID(),
      user_id: ctx.userId,
      name,
      amount,
      type: income ? "income" : "expense",
      category_id: income ? null : add.cat,
      day_of_month: add.day ? Math.min(28, Math.max(1, +add.day)) : null,
      active: true,
      income_type: "salary",
    } as RecurringItem;
    setDraft((d) => [...d, row]);
    setAmounts((a) => ({ ...a, [row.id]: toField(amount) }));
    setAdd({ name: "", cat: INCOME, amount: "", day: "" });
    setError(null);
  };

  // Closing (Done, X, Esc, outside) applies the changes.
  const close = async () => {
    const problems = recurringProblems(draft);
    if (problems.length) return setError(problems[0]);
    const diff = recurringDiff(before, draft);
    if (!diff.updates.length && !diff.inserts.length && !diff.deletes.length) return onClose();
    if (!navigator.onLine) return setError(OFFLINE);
    setBusy(true);
    const err = await apply(diff);
    setBusy(false);
    if (err) return setError(SAVE_FAILED);
    onClose();
    const saved = draft.map((r) => ({ ...r, name: r.name.trim() }));
    await ctx.saved("Recurring items updated", async () => ({ error: await apply(recurringDiff(saved, before)) }));
  };

  const monthly = draft.filter((r) => r.active && r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);

  return (
    <Dialog
      open
      onClose={close}
      eyebrow="Repeats every month"
      title="Recurring items"
      size="lg"
      error={error}
      onSubmit={close}
      busy={busy}
      showCancel={false}
      hint="Changes apply when you close · Undo after"
      submitLabel={busy ? "Saving…" : "Done"}
    >
      <span className="-mb-2 text-[13px] text-pretty text-muted">
        These show as Due on the Dashboard each month. Nothing is recorded until you tap Record there.
      </span>
      <div className="flex flex-col">
        {draft.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 transition-opacity duration-200"
            style={{ opacity: r.active ? 1 : 0.55 }}
            data-testid="recurring-edit-row"
            data-name={r.name}
          >
            <span className="flex min-w-0 flex-[1_1_150px] flex-col gap-0.5">
              <input
                type="text"
                aria-label={`${r.name} name`}
                value={r.name}
                onChange={(e) => update(r.id, { name: e.target.value })}
                className="-ml-2 h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[15px] font-semibold text-ink outline-none hover:border-line-2 focus:border-lime focus:bg-tile-2 focus-visible:outline-none"
              />
              <span className="text-xs text-muted">
                {r.type === "income" ? "Income" : (catName(r.category_id) ?? "Expense")}
                {r.active ? "" : " · paused"}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted">₹</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={`${r.name} amount`}
                value={showTyped(amounts[r.id] ?? "")}
                onChange={(e) => {
                  const v = cleanAmount(e.target.value);
                  setAmounts((a) => ({ ...a, [r.id]: v }));
                  update(r.id, { amount: paise(v) });
                }}
                className={`${SMALL} tabular w-28 px-2.5 text-right font-semibold`}
              />
            </span>
            <span className="flex items-center gap-1.5 text-[13px] text-muted">
              day
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                placeholder="—"
                aria-label={`${r.name} day of month`}
                value={r.day_of_month ?? ""}
                onChange={(e) => {
                  const v = cleanDay(e.target.value);
                  update(r.id, { day_of_month: v ? Math.min(28, Math.max(1, +v)) : null });
                }}
                className={`${SMALL} w-[52px] px-2 text-center`}
              />
            </span>
            <Switch
              on={r.active}
              onToggle={() => update(r.id, { active: !r.active })}
              label={`Repeat ${r.name} every month`}
            />
            <button
              type="button"
              onClick={() => setDraft((d) => d.filter((x) => x.id !== r.id))}
              aria-label={`Delete ${r.name}`}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-muted hover:border-danger hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {draft.length === 0 && <span className="py-4 text-sm text-muted">No recurring items yet.</span>}
      </div>
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-dashed border-line-2 p-4">
        <span className="eyebrow">Add a recurring item</span>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Name"
            aria-label="New recurring item name"
            value={add.name}
            onChange={(e) => setAdd({ ...add, name: e.target.value })}
            className={`${FIELD} h-11 w-auto flex-[2_1_160px]`}
          />
          <select
            aria-label="Category"
            value={add.cat}
            onChange={(e) => setAdd({ ...add, cat: e.target.value })}
            className={`${FIELD} h-11 w-auto flex-[1_1_140px] cursor-pointer`}
          >
            <option value={INCOME}>Income</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Amount"
            aria-label="New recurring item amount"
            value={showTyped(add.amount)}
            onChange={(e) => setAdd({ ...add, amount: cleanAmount(e.target.value) })}
            className={`${FIELD} h-11 w-auto flex-[1_1_110px]`}
          />
          <input
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder="Day"
            aria-label="New recurring item day of month"
            value={add.day}
            onChange={(e) => setAdd({ ...add, day: cleanDay(e.target.value) })}
            className={`${FIELD} h-11 w-auto flex-[0_1_72px]`}
          />
          <button
            type="button"
            onClick={addItem}
            className="h-11 cursor-pointer rounded-full border-0 bg-ink px-[18px] text-sm font-bold text-bg active:scale-[.97]"
          >
            Add
          </button>
        </div>
      </div>
      <span className="tabular text-[13px] text-muted">
        {draft.length} {draft.length === 1 ? "item" : "items"} · {inr(monthly)} a month going out
      </span>
    </Dialog>
  );
}
