"use client";

import { Repeat } from "lucide-react";
import type { RecurringItem } from "@/lib/recurringTypes";

/**
 * The recurring checkbox in the expense / income pop-ups.
 *  - Nothing picked: "Repeat every month" + an optional auto-record day.
 *  - A recurring suggestion picked: shows which one, with an option to update it
 *    with the values currently in the form.
 * The checkbox only describes what to do; nothing is counted until the date arrives
 * (or the entry itself is saved, which is a normal entry for this month).
 */
export default function RecurringOptions({
  selectedItem,
  checked,
  onCheckedChange,
  day,
  onDayChange,
  updateItem,
  onUpdateItemChange,
  error,
}: {
  selectedItem: RecurringItem | null;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  day: string;
  onDayChange: (v: string) => void;
  updateItem: boolean;
  onUpdateItemChange: (v: boolean) => void;
  error?: string;
}) {
  const dayInput = (
    <div>
      <label className="block text-[11px] font-medium text-slate-600 mb-1" htmlFor="recurring-day">
        Record automatically on day (1–28) <span className="text-slate-400">— optional</span>
      </label>
      <input
        id="recurring-day"
        data-testid="recurring-day"
        type="number"
        min="1"
        max="28"
        inputMode="numeric"
        placeholder="Leave blank to only get it suggested"
        value={day}
        onChange={(e) => onDayChange(e.target.value)}
        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
      />
      <p className="mt-1 text-[11px] text-slate-500">
        With a day set, it is recorded for you once that day has ended, and you get an alert with an Undo.
      </p>
    </div>
  );

  return (
    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2.5" data-testid="recurring-options">
      {selectedItem ? (
        <>
          <p className="text-xs text-slate-700 flex items-center gap-1.5">
            <Repeat className="w-3.5 h-3.5 text-emerald-600" />
            <span>
              Using recurring: <strong>{selectedItem.name}</strong>
            </span>
          </p>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              data-testid="recurring-update-checkbox"
              checked={updateItem}
              onChange={(e) => onUpdateItemChange(e.target.checked)}
            />
            Also update this recurring item with the values above
          </label>
          {updateItem && dayInput}
        </>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input type="checkbox" data-testid="recurring-checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
            <Repeat className="w-3.5 h-3.5 text-slate-500" />
            Repeat every month
          </label>
          {checked && dayInput}
        </>
      )}
      {error && (
        <p role="alert" data-testid="recurring-options-error" className="text-[11px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
