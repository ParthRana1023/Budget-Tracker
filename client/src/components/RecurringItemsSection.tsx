"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatINRDecimal } from "@/lib/budgetUtils";
import { isRecurringItemDue, validateRecurringForm } from "@/lib/recurrence.mjs";
import { toLocalDateString } from "@/lib/periods.mjs";
import { Category } from "./FastExpenseModal";

export interface RecurringItem {
  id: string;
  name: string;
  amount: number; // paise
  type: "expense" | "income";
  category_id: string | null;
  day_of_month: number;
  active: boolean;
}

interface FormValues {
  type: "expense" | "income";
  name: string;
  amount: string; // rupees, as typed
  day: string;
  categoryId: string;
}

const EMPTY_FORM: FormValues = { type: "expense", name: "", amount: "", day: "1", categoryId: "" };

const fieldClass = "border border-slate-300 rounded-lg p-2 text-xs bg-white w-full";

function toFormValues(item: RecurringItem): FormValues {
  return {
    type: item.type,
    name: item.name,
    amount: String(item.amount / 100),
    day: String(item.day_of_month),
    categoryId: item.category_id ?? "",
  };
}

/** Create / edit form. Expense schedules need a category; income schedules do not. */
function ScheduleForm({
  initial,
  categories,
  submitLabel,
  testId,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  categories: Category[];
  submitLabel: string;
  testId: string;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState<FormValues>(initial);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="flex gap-2" role="group" aria-label="Schedule type">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`${testId}-type-${t}`}
            aria-pressed={form.type === t}
            onClick={() => set("type", t)}
            className={`flex-1 rounded-lg p-2 text-xs font-semibold border ${
              form.type === t ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-300"
            }`}
          >
            {t === "expense" ? "Expense" : "Income"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          aria-label="Schedule name"
          data-testid={`${testId}-name`}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={form.type === "income" ? "Salary" : "Rent"}
          className={fieldClass}
        />
        <input
          aria-label="Amount in rupees"
          data-testid={`${testId}-amount`}
          value={form.amount}
          onChange={(e) => set("amount", e.target.value)}
          placeholder="Amount (₹)"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          className={fieldClass}
        />
        <input
          aria-label="Day of month"
          data-testid={`${testId}-day`}
          value={form.day}
          onChange={(e) => set("day", e.target.value)}
          placeholder="Day (1-28)"
          type="number"
          min="1"
          max="28"
          className={fieldClass}
        />
        {form.type === "expense" ? (
          <select
            aria-label="Category"
            data-testid={`${testId}-category`}
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
            className={fieldClass}
          >
            <option value="">Category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-[11px] text-slate-500 flex items-center">Counts as received income</div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          data-testid={`${testId}-submit`}
          disabled={busy}
          onClick={() => onSubmit(form)}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-lg p-2 text-xs font-semibold"
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={onCancel}
            className="px-3 rounded-lg border border-slate-300 text-xs text-slate-600"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default function RecurringItemsSection({
  items,
  transactions,
  categories,
  userId,
  onUpdated,
}: {
  items: RecurringItem[];
  transactions: Array<{ external_id?: string | null }>;
  categories: Category[];
  userId: string;
  onUpdated: () => void;
}) {
  const client = useMemo(() => createClient(), []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [createKey, setCreateKey] = useState(0); // remounts the create form to clear it after a save

  const due = useMemo(() => items.filter((x) => isRecurringItemDue(x, transactions)), [items, transactions]);
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Uncategorised";

  // Runs one write, keeps the busy flag and the error line consistent.
  const run = async (action: () => PromiseLike<{ error: { message: string; code?: string } | null }>) => {
    setBusy(true);
    setError("");
    const { error: err } = await action();
    setBusy(false);
    if (err) {
      setError(err.code === "23505" ? "This schedule has already been posted for this month." : err.message);
      return false;
    }
    onUpdated();
    return true;
  };

  const create = async (values: FormValues) => {
    const result = validateRecurringForm(values);
    if (!result.value) return setError(result.error ?? "Check the form and try again.");
    const ok = await run(() => client.from("recurring_items").insert({ user_id: userId, ...result.value }));
    if (ok) setCreateKey((k) => k + 1);
  };

  const save = async (id: string, values: FormValues) => {
    const result = validateRecurringForm(values);
    if (!result.value) return setError(result.error ?? "Check the form and try again.");
    const ok = await run(() => client.from("recurring_items").update(result.value).eq("id", id));
    if (ok) setEditingId(null);
  };

  const toggleActive = (item: RecurringItem) =>
    run(() => client.from("recurring_items").update({ active: !item.active }).eq("id", item.id));

  const remove = async (id: string) => {
    const ok = await run(() => client.from("recurring_items").delete().eq("id", id));
    if (ok) setConfirmDeleteId(null);
  };

  // Post with the user's LOCAL date. (toISOString() is UTC and would pick the
  // previous day, hence the previous month's key, shortly after local midnight.)
  const post = (id: string) =>
    run(() => client.rpc("post_recurring_item", { p_item_id: id, p_date: toLocalDateString() }));

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3" data-testid="recurring-section">
      <h2 className="font-bold text-sm">Recurring items</h2>
      {error && (
        <p role="alert" data-testid="recurring-error" className="text-xs text-rose-700">
          {error}
        </p>
      )}

      <ScheduleForm
        key={createKey}
        initial={EMPTY_FORM}
        categories={categories}
        submitLabel="Save schedule"
        testId="recurring-new"
        busy={busy}
        onSubmit={create}
      />

      {items.length === 0 && <p className="text-xs text-slate-500">No recurring schedules yet.</p>}

      <ul className="space-y-2">
        {items.map((x) =>
          editingId === x.id ? (
            <li key={x.id} className="border border-emerald-300 rounded-xl p-3 bg-emerald-50/40">
              <ScheduleForm
                initial={toFormValues(x)}
                categories={categories}
                submitLabel="Save changes"
                testId="recurring-edit"
                busy={busy}
                onSubmit={(values) => save(x.id, values)}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={x.id} data-testid="recurring-row" data-name={x.name} className="border border-slate-200 rounded-xl p-3 text-xs space-y-2">
              <div className="flex justify-between gap-2">
                <div>
                  <span className="font-semibold text-slate-800">{x.name}</span>{" "}
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                      x.type === "income" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {x.type === "income" ? "Income" : "Expense"}
                  </span>
                  <div className="text-slate-500">
                    {formatINRDecimal(x.amount)} on day {x.day_of_month}
                    {x.type === "expense" && <> · {categoryName(x.category_id)}</>}
                  </div>
                </div>
                <span data-testid="recurring-status" className={x.active ? "text-emerald-700" : "text-slate-400"}>
                  {x.active ? "Active" : "Paused"}
                </span>
              </div>

              {confirmDeleteId === x.id ? (
                <div className="flex items-center gap-2" role="alertdialog" aria-label={`Confirm delete ${x.name}`}>
                  <span className="text-rose-700 flex-1">Delete this schedule permanently? Posted transactions are kept.</span>
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="recurring-delete-confirm"
                    onClick={() => remove(x.id)}
                    className="px-2 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                  >
                    Delete
                  </button>
                  <button type="button" data-testid="recurring-delete-cancel" onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 rounded-lg border border-slate-300">
                    Keep
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button type="button" aria-label={`Edit ${x.name}`} data-testid="recurring-edit-btn" onClick={() => { setError(""); setEditingId(x.id); }} className="text-slate-700 font-medium">
                    Edit
                  </button>
                  <button type="button" aria-label={`${x.active ? "Pause" : "Resume"} ${x.name}`} data-testid="recurring-toggle-btn" disabled={busy} onClick={() => toggleActive(x)} className="text-slate-700 font-medium">
                    {x.active ? "Pause" : "Resume"}
                  </button>
                  <button type="button" aria-label={`Delete ${x.name}`} data-testid="recurring-delete-btn" onClick={() => setConfirmDeleteId(x.id)} className="text-rose-600 font-medium">
                    Delete
                  </button>
                </div>
              )}
            </li>
          )
        )}
      </ul>

      {due.map((x) => (
        <button
          key={x.id}
          type="button"
          disabled={busy}
          data-testid="recurring-post-btn"
          data-name={x.name}
          onClick={() => post(x.id)}
          className="w-full text-left bg-amber-50 border border-amber-200 p-2 rounded-lg text-xs"
        >
          Review &amp; post {x.type === "income" ? "income" : "expense"}: <strong>{x.name}</strong> ({formatINRDecimal(x.amount)})
        </button>
      ))}
    </section>
  );
}
