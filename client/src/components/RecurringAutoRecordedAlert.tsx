"use client";

import { useState } from "react";
import { BellRing, X } from "lucide-react";
import { formatINRDecimal } from "@/lib/budgetUtils";
import { formatShortDate } from "@/lib/recurrence.mjs";
import type { AutoRecordedEntry } from "@/lib/recurringTypes";

/**
 * Pops up when recurring items were recorded automatically (their day ended).
 * Each entry has an Undo, which removes it and stops it coming back for that month.
 */
export default function RecurringAutoRecordedAlert({
  entries,
  onUndo,
  onDismiss,
}: {
  entries: AutoRecordedEntry[];
  onUndo: (entry: AutoRecordedEntry) => Promise<string | null>; // resolves to an error message, or null on success
  onDismiss: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  if (entries.length === 0) return null;

  const undo = async (entry: AutoRecordedEntry) => {
    setBusyId(entry.transactionId);
    setError("");
    const message = await onUndo(entry);
    setBusyId(null);
    if (message) setError(message);
  };

  return (
    <div
      role="alert"
      data-testid="recurring-auto-alert"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[min(92vw,26rem)] rounded-2xl border border-emerald-200 bg-white shadow-2xl p-4 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <BellRing className="w-4 h-4 text-emerald-600" />
          {entries.length === 1 ? "Recurring item recorded automatically" : `${entries.length} recurring items recorded automatically`}
        </p>
        <button type="button" aria-label="Dismiss" data-testid="recurring-auto-dismiss" onClick={onDismiss} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.transactionId} data-testid="recurring-auto-entry" data-name={e.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-700">
              <strong>{e.name}</strong> · {e.type === "income" ? "+" : "−"}
              {formatINRDecimal(e.amount)} · {formatShortDate(e.date)}
            </span>
            <button
              type="button"
              disabled={busyId === e.transactionId}
              data-testid="recurring-auto-undo"
              onClick={() => undo(e)}
              className="shrink-0 rounded-lg border border-slate-300 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {busyId === e.transactionId ? "Undoing…" : "Undo"}
            </button>
          </li>
        ))}
      </ul>

      {error && (
        <p data-testid="recurring-auto-error" className="text-[11px] text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
