"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { X, Check, Loader2, Sparkles, Calendar, FileText } from "lucide-react";

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
}

export default function FastExpenseModal({
  isOpen,
  onClose,
  categories,
  userId,
  onExpenseAdded,
}: FastExpenseModalProps) {
  const [amountRupees, setAmountRupees] = useState<string>("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    categories[0]?.id || ""
  );
  const [date, setDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [note, setNote] = useState<string>("");
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

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

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const amountPaise = Math.round(parsedAmount * 100);

      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        category_id: selectedCategoryId,
        amount: amountPaise,
        type: "expense",
        date: date || new Date().toISOString().split("T")[0],
        note: note.trim() || null,
        source: "manual",
      });

      if (error) {
        throw error;
      }

      // Reset and trigger refresh
      setAmountRupees("");
      setNote("");
      onExpenseAdded();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to log expense");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
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
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              2. Select Category
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
              {categories.map((c) => {
                const isSelected = selectedCategoryId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
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
            className="flex-[2] py-3 px-4 rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 text-sm font-semibold transition-all shadow-md shadow-emerald-600/25 flex items-center justify-center gap-2 disabled:opacity-60"
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

