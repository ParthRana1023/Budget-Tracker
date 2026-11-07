"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/utils/supabase/client";
import { X, Check, Loader2, Sparkles, Calendar, FileText, AlertTriangle, ShieldAlert } from "lucide-react";
import { checkExpenseImpact } from "@/lib/alertUtils";
import { toLocalDateString } from "@/lib/periods.mjs";
import { parseOptionalDay, suggestRecurring } from "@/lib/recurrence.mjs";
import type { RecurringItem } from "@/lib/recurringTypes";
import RecurringSuggestions from "./RecurringSuggestions";
import RecurringOptions from "./RecurringOptions";

export interface Category {
  id: string;
  name: string;
  type: "fixed" | "flexible";
  monthly_limit: number;
}

interface FastExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  userId: string;
  onExpenseAdded: () => void;
  currentSafeToSpend?: number;
  recentTransactions?: Array<{ category_id: string | null; amount: number; type: string }>;
  onAlertTriggered?: (alertMessage: string) => void;
  /** Recurring schedules, offered as suggestions at the top of the pop-up. */
  recurringItems?: RecurringItem[];
  /** All transactions (with external_id) so already-recorded months are not suggested again. */
  allTransactions?: Array<{ external_id?: string | null }>;
}

export default function FastExpenseModal({
  isOpen,
  onClose,
  categories,
  userId,
  onExpenseAdded,
  currentSafeToSpend = 0,
  recentTransactions = [],
  onAlertTriggered,
  recurringItems = [],
  allTransactions = [],
}: FastExpenseModalProps) {
  const [amountRupees, setAmountRupees] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    categories[0]?.id || ""
  );
  const [date, setDate] = useState<string>(toLocalDateString());
  const [note, setNote] = useState<string>("");
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [postSubmitWarning, setPostSubmitWarning] = useState<string | null>(null);

  // Recurring: a suggestion the user picked, the "repeat monthly" checkbox, and its optional auto day.
  const [selectedItem, setSelectedItem] = useState<RecurringItem | null>(null);
  const [makeRecurring, setMakeRecurring] = useState<boolean>(false);
  const [recurringDay, setRecurringDay] = useState<string>("");
  const [updateItem, setUpdateItem] = useState<boolean>(false);
  const [recurringError, setRecurringError] = useState<string>("");

  const suggestions = useMemo(
    () => suggestRecurring(recurringItems, "expense", allTransactions, date || toLocalDateString()),
    [recurringItems, allTransactions, date]
  );

  const selectedCategory = useMemo(() => {
    return categories.find((c) => c.id === selectedCategoryId);
  }, [categories, selectedCategoryId]);

  // Current spending in this category
  const currentCategorySpent = useMemo(() => {
    return recentTransactions
      .filter((t) => t.type === "expense" && t.category_id === selectedCategoryId)
      .reduce((sum, t) => sum + Number(t.amount), 0);
  }, [recentTransactions, selectedCategoryId]);

  // Real-time impact preview calculation
  const impact = useMemo(() => {
    const parsed = parseFloat(amountRupees);
    if (isNaN(parsed) || parsed <= 0) return null;
    const amountPaise = Math.round(parsed * 100);
    return checkExpenseImpact(amountPaise, selectedCategory, currentCategorySpent, currentSafeToSpend);
  }, [amountRupees, selectedCategory, currentCategorySpent, currentSafeToSpend]);

  if (!isOpen) return null;

  const resetRecurring = () => {
    setSelectedItem(null);
    setMakeRecurring(false);
    setRecurringDay("");
    setUpdateItem(false);
    setRecurringError("");
  };

  // Tapping a suggestion fills the form from the schedule (nothing is saved yet).
  const pickItem = (item: RecurringItem) => {
    setSelectedItem(item);
    setMakeRecurring(false);
    setUpdateItem(false);
    setRecurringError("");
    setAmountRupees(String(item.amount / 100));
    setNote(item.name);
    setRecurringDay(item.day_of_month ? String(item.day_of_month) : "");
    if (item.category_id && categories.some((c) => c.id === item.category_id)) setSelectedCategoryId(item.category_id);
    setShowDetails(true);
  };

  const quickAmounts = [100, 250, 500, 1000, 2000];

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const parsedAmount = parseFloat(amountRupees);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg("Please enter a valid amount greater than 0");
      return;
    }

    if (!selectedCategoryId) {
      setErrorMsg("Please select a category");
      return;
    }

    // Recurring: validate the optional auto-record day only when it will actually be used.
    const recurringMode = selectedItem !== null || makeRecurring;
    let recurringDayValue: number | null = null;
    if (recurringMode && (selectedItem ? updateItem : makeRecurring)) {
      const parsedDay = parseOptionalDay(recurringDay);
      if ("error" in parsedDay) {
        setRecurringError(parsedDay.error);
        return;
      }
      recurringDayValue = parsedDay.value;
    }
    setRecurringError("");

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const amountPaise = Math.round(parsedAmount * 100);

      const { error } = recurringMode
        ? // One atomic call: records this entry and creates/links the recurring schedule.
          await supabase.rpc("record_entry_with_recurring", {
            p_type: "expense",
            p_amount: amountPaise,
            p_date: date || toLocalDateString(),
            p_category_id: selectedCategoryId,
            p_note: note.trim() || null,
            p_item_id: selectedItem?.id ?? null,
            p_make_recurring: selectedItem ? false : makeRecurring,
            p_day: recurringDayValue,
            p_update_item: selectedItem ? updateItem : false,
          })
        : await supabase.from("transactions").insert({
            user_id: userId,
            category_id: selectedCategoryId,
            amount: amountPaise,
            type: "expense",
            date: date || toLocalDateString(),
            note: note.trim() || null,
            source: "manual",
          });

      if (error) {
        if (error.code === "23505") {
          throw new Error("This recurring item is already recorded for that month.");
        }
        throw error;
      }

      // If an alert was triggered by this expense, notify parent
      if (impact?.message && onAlertTriggered) {
        onAlertTriggered(impact.message);
      }

      // Reset and trigger refresh
      setAmountRupees("");
      setNote("");
      resetRecurring();
      onExpenseAdded();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to log expense");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div role="dialog" aria-label="Log expense" data-testid="expense-modal" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 px-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <h3 className="font-bold text-slate-900 text-base">Quick Log Expense</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Real-time Alert Impact Preview (Phase 4 requirement) */}
          {impact?.message && (
            <div
              className={`p-3 rounded-2xl border text-xs flex items-start gap-2.5 animate-in fade-in ${
                impact.triggers100 || impact.threatensSavings
                  ? "bg-rose-50 border-rose-200 text-rose-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              {impact.triggers100 || impact.threatensSavings ? (
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <span className="font-semibold leading-relaxed">{impact.message}</span>
            </div>
          )}

          <RecurringSuggestions
            suggestions={suggestions}
            selectedId={selectedItem?.id ?? null}
            onPick={pickItem}
            onClear={resetRecurring}
            onChanged={onExpenseAdded}
          />

          {/* TAP 1: Amount Input */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              1. Amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-slate-400">
                ₹
              </span>
              <input
                type="number"
                step="any"
                autoFocus
                placeholder="0"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border-2 border-slate-200 rounded-2xl text-3xl font-extrabold text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
              />
            </div>

            {/* Quick Add Amount Chips */}
            <div className="flex flex-wrap gap-2 mt-2.5">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    const current = parseFloat(amountRupees) || 0;
                    setAmountRupees((current + amt).toString());
                  }}
                  className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-600 transition-colors"
                >
                  +{amt}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAmountRupees("")}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* TAP 2: Category Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                2. Select Category
              </label>
              {selectedCategory && selectedCategory.monthly_limit > 0 && (
                <span className="text-[11px] text-slate-500">
                  Limit: ₹{Math.round(selectedCategory.monthly_limit / 100).toLocaleString("en-IN")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {categories.map((c) => {
                const isSelected = selectedCategoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-testid="expense-category"
                    data-name={c.name}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedCategoryId(c.id)}
                    className={`p-3 rounded-xl border text-left text-xs font-medium transition-all flex flex-col justify-between ${
                      isSelected
                        ? "bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/30 font-semibold scale-[1.02]"
                        : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                    }`}
                  >
                    <span className="truncate block">{c.name}</span>
                    <span
                      className={`text-[10px] mt-1 uppercase tracking-wider block ${
                        isSelected ? "text-emerald-100" : "text-slate-400"
                      }`}
                    >
                      {c.type}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Details Toggle */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span>{showDetails ? "Hide extra details" : "Add note or change date (optional)"}</span>
            </button>

            {showDetails && (
              <div className="mt-3 p-3 bg-slate-50 rounded-xl space-y-3 border border-slate-200 animate-in fade-in duration-100">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-slate-400" />
                    Date
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1 flex items-center gap-1">
                    <FileText className="w-3 h-3 text-slate-400" />
                    Note
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Swiggy lunch or fuel"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          <RecurringOptions
            selectedItem={selectedItem}
            checked={makeRecurring}
            onCheckedChange={setMakeRecurring}
            day={recurringDay}
            onDayChange={setRecurringDay}
            updateItem={updateItem}
            onUpdateItemChange={setUpdateItem}
            error={recurringError}
          />
        </div>

        {/* TAP 3: Submit Action */}
        <div className="p-4 px-6 bg-slate-50 border-t border-slate-100 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 text-sm font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            id="save-expense-btn"
            disabled={loading}
            onClick={() => handleSubmit()}
            className={`flex-[2] py-3 px-4 rounded-xl text-white text-sm font-semibold transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-60 ${
              impact?.triggers100 || impact?.threatensSavings
                ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/25"
                : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/25"
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>3. Done • Log Expense</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
