"use client";

import { useState } from "react";
import { Repeat, Trash2, Check } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { formatINRDecimal } from "@/lib/budgetUtils";
import { scheduleLabel } from "@/lib/recurrence.mjs";
import type { RecurringItem } from "@/lib/recurringTypes";

export interface RecurringSuggestion {
  item: RecurringItem;
  /** Already recorded for the month of the entry date; recording again would be a duplicate. */
  recorded: boolean;
}

/**
 * "Recurring" quick-picks shown at the top of the expense / income pop-ups.
 * Tapping one fills the form. Each can also be stopped (the schedule is deleted;
 * transactions it already recorded are kept).
 */
export default function RecurringSuggestions({
  suggestions,
  selectedId,
  onPick,
  onClear,
  onChanged,
}: {
  suggestions: RecurringSuggestion[];
  selectedId: string | null;
  onPick: (item: RecurringItem) => void;
  onClear: () => void;
  onChanged: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (suggestions.length === 0) return null;

  const stop = async (item: RecurringItem) => {
    setBusy(true);
    setError("");
    const { error: err } = await createClient().from("recurring_items").delete().eq("id", item.id);
    setBusy(false);
    if (err) return setError(err.message);
    setConfirmId(null);
    if (selectedId === item.id) onClear();
    onChanged();
  };

  return (
    <div data-testid="recurring-suggestions" className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <Repeat className="w-3.5 h-3.5" />
        <span>Recurring</span>
      </div>
      {error && (
        <p role="alert" className="text-[11px] text-rose-700">
          {error}
        </p>
      )}
      <ul className="space-y-1.5">
        {suggestions.map(({ item, recorded }) => {
          const selected = selectedId === item.id;
          return (
            <li key={item.id} data-testid="recurring-suggestion" data-name={item.name} className="flex items-stretch gap-1.5">
              {confirmId === item.id ? (
                <div className="flex-1 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs" role="alertdialog" aria-label={`Stop repeating ${item.name}`}>
                  <span className="flex-1 text-rose-800">Stop repeating “{item.name}”? Past records are kept.</span>
                  <button type="button" disabled={busy} data-testid="recurring-stop-confirm" onClick={() => stop(item)} className="font-semibold text-rose-700">
                    Stop
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="text-slate-500">
                    Keep
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={recorded}
                    aria-pressed={selected}
                    data-testid="recurring-suggestion-pick"
                    onClick={() => (selected ? onClear() : onPick(item))}
                    className={`flex-1 text-left rounded-xl border px-3 py-2 text-xs transition-colors ${
                      selected
                        ? "border-emerald-500 bg-emerald-50"
                        : recorded
                          ? "border-slate-200 bg-slate-50 text-slate-400"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-semibold text-slate-800">{item.name}</span>{" "}
                    <span className="text-slate-600">{formatINRDecimal(item.amount)}</span>
                    <span className="block text-[11px] text-slate-500">
                      {recorded ? (
                        <span className="inline-flex items-center gap-1">
                          <Check className="w-3 h-3" /> recorded this month
                        </span>
                      ) : (
                        scheduleLabel(item)
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Stop repeating ${item.name}`}
                    data-testid="recurring-suggestion-stop"
                    onClick={() => setConfirmId(item.id)}
                    className="px-2 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
