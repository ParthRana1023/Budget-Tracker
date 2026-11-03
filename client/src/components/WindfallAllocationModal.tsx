"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
  Sparkles, 
  PiggyBank, 
  Calendar, 
  PartyPopper, 
  Check, 
  X, 
  Loader2, 
  ShieldCheck, 
  Wallet,
  Coins,
  AlertCircle
} from "lucide-react";
import { formatINR } from "@/lib/budgetUtils";

interface WindfallAllocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  incomeSource: { id: string; name: string; amount: number } | null; // amount in paise
  savingsGoals: Array<{ id: string; name: string }>;
  userId: string;
  onAllocated: () => void;
}

export default function WindfallAllocationModal({
  isOpen,
  onClose,
  incomeSource,
  savingsGoals,
  userId,
  onAllocated,
}: WindfallAllocationModalProps) {
  if (!isOpen || !incomeSource) return null;

  const totalPaise = Number(incomeSource.amount);
  const totalRupees = Math.round(totalPaise / 100);

  // Allocation state in Rupees
  const [savingsAmount, setSavingsAmount] = useState<number>(Math.round(totalRupees * 0.5));
  const [selectedGoalId, setSelectedGoalId] = useState<string>(savingsGoals[0]?.id || "");
  const [annualExpensesAmount, setAnnualExpensesAmount] = useState<number>(Math.round(totalRupees * 0.3));
  const [discretionaryAmount, setDiscretionaryAmount] = useState<number>(
    totalRupees - Math.round(totalRupees * 0.5) - Math.round(totalRupees * 0.3)
  );

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const allocatedTotal = savingsAmount + annualExpensesAmount + discretionaryAmount;
  const remainingToAllocate = totalRupees - allocatedTotal;

  // Preset Handlers
  const applyPreset = (sPercent: number, aPercent: number, dPercent: number) => {
    const s = Math.round(totalRupees * sPercent);
    const a = Math.round(totalRupees * aPercent);
    const d = totalRupees - s - a;
    setSavingsAmount(s);
    setAnnualExpensesAmount(a);
    setDiscretionaryAmount(d);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (allocatedTotal !== totalRupees) {
      setErrorMsg(`Please allocate the entire windfall. Difference: ₹${Math.abs(remainingToAllocate)}`);
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const today = new Date().toISOString().split("T")[0];

      // 1. Mark income source as received
      const { error: incError } = await supabase
        .from("income_sources")
        .update({
          status: "received",
          received_date: today,
        })
        .eq("id", incomeSource.id);

      if (incError) throw incError;

      // 2. If savings allocated, credit goal contributions & log transaction
      if (savingsAmount > 0 && selectedGoalId) {
        const sPaise = Math.round(savingsAmount * 100);
        const { data: sTx } = await supabase
          .from("transactions")
          .insert({
            user_id: userId,
            amount: sPaise,
            type: "savings_transfer",
            date: today,
            note: `Windfall allocation (${incomeSource.name}) to savings goal`,
            source: "manual",
          })
          .select()
          .single();

        await supabase.from("goal_contributions").insert({
          user_id: userId,
          goal_id: selectedGoalId,
          transaction_id: sTx?.id || null,
          amount: sPaise,
          date: today,
        });
      }

      // 3. Log income transaction for the windfall
      await supabase.from("transactions").insert({
        user_id: userId,
        amount: totalPaise,
        type: "income",
        date: today,
        note: `Received Variable Pay: ${incomeSource.name} (Split: ${formatINR(savingsAmount * 100)} Savings, ${formatINR(annualExpensesAmount * 100)} Annual, ${formatINR(discretionaryAmount * 100)} Fun)`,
        source: "manual",
      });

      onAllocated();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to allocate windfall.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 px-6 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-emerald-500/10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
              <PartyPopper className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">Windfall Allocation</h3>
              <p className="text-[11px] text-slate-500">
                Variable pay received: <strong className="text-slate-900 font-bold">{incomeSource.name} ({formatINR(totalPaise)})</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Quick Preset Buttons */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Quick Allocation Presets
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => applyPreset(0.5, 0.3, 0.2)}
                className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left text-xs transition-colors"
              >
                <span className="font-bold block text-slate-800">50 / 30 / 20</span>
                <span className="text-[10px] text-slate-500 block">50% Save • 30% Bills • 20% Fun</span>
              </button>

              <button
                type="button"
                onClick={() => applyPreset(0.8, 0.1, 0.1)}
                className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left text-xs transition-colors"
              >
                <span className="font-bold block text-purple-700">80% Savings</span>
                <span className="text-[10px] text-slate-500 block">Max savings growth</span>
              </button>

              <button
                type="button"
                onClick={() => applyPreset(1.0, 0, 0)}
                className="p-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-left text-xs transition-colors"
              >
                <span className="font-bold block text-emerald-700">100% Reserve</span>
                <span className="text-[10px] text-slate-500 block">Total safety fund</span>
              </button>
            </div>
          </div>

          {/* 3 Allocation Fields */}
          <div className="space-y-4 pt-1">
            {/* 1. Savings Goals */}
            <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PiggyBank className="w-4 h-4 text-purple-700" />
                  <span className="text-xs font-bold text-slate-900">1. Savings Goals Priority</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-bold text-purple-800">₹</span>
                  <input
                    type="number"
                    value={savingsAmount}
                    onChange={(e) => setSavingsAmount(Number(e.target.value) || 0)}
                    className="w-28 px-2 py-1 bg-white border border-purple-200 rounded-lg text-xs font-bold text-right"
                  />
                </div>
              </div>

              {savingsGoals.length > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500 text-[11px] shrink-0">Credit Goal:</span>
                  <select
                    value={selectedGoalId}
                    onChange={(e) => setSelectedGoalId(e.target.value)}
                    className="flex-1 px-2 py-1 bg-white border border-purple-200 rounded-lg text-xs font-medium"
                  >
                    {savingsGoals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* 2. Annual or Irregular Expenses */}
            <div className="p-4 rounded-2xl bg-blue-50/60 border border-blue-100 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-700" />
                  <div>
                    <span className="text-xs font-bold text-slate-900 block">2. Annual & Irregular Bills</span>
                    <span className="text-[10px] text-slate-500">Insurance premiums, taxes, car service</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-bold text-blue-800">₹</span>
                  <input
                    type="number"
                    value={annualExpensesAmount}
                    onChange={(e) => setAnnualExpensesAmount(Number(e.target.value) || 0)}
                    className="w-28 px-2 py-1 bg-white border border-blue-200 rounded-lg text-xs font-bold text-right"
                  />
                </div>
              </div>
            </div>

            {/* 3. Discretionary Spending */}
            <div className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100 space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-emerald-700" />
                  <div>
                    <span className="text-xs font-bold text-slate-900 block">3. Discretionary Spending</span>
                    <span className="text-[10px] text-slate-500">Added to this month's Safe-to-Spend</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs font-bold text-emerald-800">₹</span>
                  <input
                    type="number"
                    value={discretionaryAmount}
                    onChange={(e) => setDiscretionaryAmount(Number(e.target.value) || 0)}
                    className="w-28 px-2 py-1 bg-white border border-emerald-200 rounded-lg text-xs font-bold text-right"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Allocation Progress Bar & Tally */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-slate-600">Total Allocated:</span>
              <span className={remainingToAllocate === 0 ? "text-emerald-700 font-bold" : "text-amber-700"}>
                ₹{allocatedTotal.toLocaleString("en-IN")} / ₹{totalRupees.toLocaleString("en-IN")}
              </span>
            </div>

            <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
              <div
                style={{ width: `${(savingsAmount / totalRupees) * 100}%` }}
                className="bg-purple-600 h-full"
                title="Savings"
              />
              <div
                style={{ width: `${(annualExpensesAmount / totalRupees) * 100}%` }}
                className="bg-blue-600 h-full"
                title="Annual Bills"
              />
              <div
                style={{ width: `${(discretionaryAmount / totalRupees) * 100}%` }}
                className="bg-emerald-600 h-full"
                title="Discretionary"
              />
            </div>

            {remainingToAllocate !== 0 && (
              <p className="text-[11px] text-amber-700 font-medium">
                {remainingToAllocate > 0
                  ? `₹${remainingToAllocate.toLocaleString("en-IN")} remaining to be allocated.`
                  : `Over-allocated by ₹${Math.abs(remainingToAllocate).toLocaleString("en-IN")}.`}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-300 text-xs font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || remainingToAllocate !== 0}
              className="flex-[2] py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Confirm & Allocate Windfall</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

