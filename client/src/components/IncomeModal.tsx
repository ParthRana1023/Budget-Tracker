"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { X, Check, Loader2, AlertCircle, Calendar } from "lucide-react";

interface IncomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onIncomeAdded: () => void;
}

export default function IncomeModal({
  isOpen,
  onClose,
  userId,
  onIncomeAdded,
}: IncomeModalProps) {
  const [name, setName] = useState<string>("Monthly Salary");
  const [amountRupees, setAmountRupees] = useState<string>("");
  const [type, setType] = useState<"salary" | "variable" | "other">("salary");
  const [status, setStatus] = useState<"expected" | "received">("received");
  const [date, setDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amountRupees);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setErrorMsg("Please enter a valid amount greater than 0");
      return;
    }

    if (!name.trim()) {
      setErrorMsg("Please provide an income source name");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const amountPaise = Math.round(parsedAmount * 100);

      const { error } = await supabase.from("income_sources").insert({
        user_id: userId,
        name: name.trim(),
        type,
        status,
        amount: amountPaise,
        expected_date: status === "expected" ? date : null,
        received_date: status === "received" ? date : null,
      });

      if (error) {
        throw error;
      }

      // Also if status === 'received', log a transaction of type 'income' so transaction history reflects it!
      if (status === "received") {
        await supabase.from("transactions").insert({
          user_id: userId,
          amount: amountPaise,
          type: "income",
          date,
          note: `Income: ${name.trim()}`,
          source: "manual",
        });
      }

      setAmountRupees("");
      setName("Monthly Salary");
      onIncomeAdded();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to log income");
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
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
            <h3 className="font-bold text-slate-900 text-base">Record Income</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Source Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. October Salary, Quarterly Bonus"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Amount (₹)
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-slate-400 text-lg">
                ₹
              </span>
              <input
                type="number"
                step="any"
                required
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="0"
                className="w-full pl-9 pr-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Income Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["salary", "variable", "other"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t);
                    if (t === "variable") {
                      setStatus("expected"); // default variable pay to expected
                    }
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-medium capitalize transition-all ${
                    type === t
                      ? "bg-blue-600 border-blue-600 text-white shadow-xs font-semibold"
                      : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {t === "variable" ? "Variable Pay" : t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStatus("received")}
                className={`py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                  status === "received"
                    ? "bg-emerald-600 border-emerald-600 text-white font-semibold shadow-xs"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                ✓ Received in Bank
              </button>
              <button
                type="button"
                onClick={() => setStatus("expected")}
                className={`py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                  status === "expected"
                    ? "bg-amber-600 border-amber-600 text-white font-semibold shadow-xs"
                    : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                }`}
              >
                ⏳ Expected Later
              </button>
            </div>
          </div>

          {/* Explanation Banner */}
          {status === "expected" && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Holding Bucket:</strong> This amount will NOT be added to your spendable budget until marked as received.
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {status === "received" ? "Received Date" : "Expected Date"}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
            />
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 text-sm font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-[2] py-2.5 px-4 rounded-xl text-white bg-blue-600 hover:bg-blue-700 text-sm font-semibold transition-all shadow-md shadow-blue-600/25 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Income</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

