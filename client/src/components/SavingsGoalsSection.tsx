"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { 
  PiggyBank, 
  Plus, 
  Target, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  ArrowRight,
  MoreVertical,
  Trash2,
  Edit2,
  X,
  Loader2,
  Coins
} from "lucide-react";
import { formatINR, calculateNeededPerMonth } from "@/lib/budgetUtils";

export interface SavingsGoal {
  id: string;
  name: string;
  target_amount: number; // in paise
  target_date?: string | null;
  created_at?: string;
  current_amount?: number; // computed from contributions
}

interface SavingsGoalsSectionProps {
  goals: SavingsGoal[];
  contributions: Array<{ goal_id: string; amount: number }>;
  userId: string;
  onGoalsUpdated: () => void;
}

export default function SavingsGoalsSection({
  goals,
  contributions,
  userId,
  onGoalsUpdated,
}: SavingsGoalsSectionProps) {
  // Modal states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [contributeGoal, setContributeGoal] = useState<SavingsGoal | null>(null);

  // Form states for New Goal
  const [newGoalName, setNewGoalName] = useState("");
  const [newTargetAmount, setNewTargetAmount] = useState("");
  const [newTargetDate, setNewTargetDate] = useState("");
  const [initialContribution, setInitialContribution] = useState("");

  // Form states for Contribution
  const [contribAmount, setContribAmount] = useState("");
  const [contribDate, setContribDate] = useState(new Date().toISOString().split("T")[0]);
  const [contribNote, setContribNote] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Calculate current saved amount per goal from contributions
  const goalsWithCalculations = goals.map((goal) => {
    const totalContributed = contributions
      .filter((c) => c.goal_id === goal.id)
      .reduce((sum, c) => sum + Number(c.amount), 0);

    const percent = goal.target_amount > 0 
      ? Math.min(100, (totalContributed / goal.target_amount) * 100) 
      : 0;

    const metrics = calculateNeededPerMonth(goal.target_amount, totalContributed, goal.target_date);

    return {
      ...goal,
      current_amount: totalContributed,
      percent,
      metrics,
    };
  });

  // Handle Add Goal
  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseFloat(newTargetAmount);
    if (!newGoalName.trim() || isNaN(target) || target <= 0) {
      setErrorMsg("Please enter a valid goal name and target amount.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const targetPaise = Math.round(target * 100);

      const { data: goalData, error: goalError } = await supabase
        .from("savings_goals")
        .insert({
          user_id: userId,
          name: newGoalName.trim(),
          target_amount: targetPaise,
          target_date: newTargetDate || null,
        })
        .select()
        .single();

      if (goalError) throw goalError;

      // If initial contribution provided
      const initContrib = parseFloat(initialContribution);
      if (!isNaN(initContrib) && initContrib > 0 && goalData) {
        const initPaise = Math.round(initContrib * 100);
        await supabase.from("goal_contributions").insert({
          user_id: userId,
          goal_id: goalData.id,
          amount: initPaise,
          date: new Date().toISOString().split("T")[0],
        });
      }

      setNewGoalName("");
      setNewTargetAmount("");
      setNewTargetDate("");
      setInitialContribution("");
      setIsAddOpen(false);
      onGoalsUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create savings goal.");
    } finally {
      setLoading(false);
    }
  };

  // Handle Contribute
  const handleAddContribution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contributeGoal) return;
    const amount = parseFloat(contribAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMsg("Please enter a valid contribution amount.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const amountPaise = Math.round(amount * 100);

      const { error: contribError } = await supabase.rpc("record_goal_contribution", { p_goal_id: contributeGoal.id, p_amount: amountPaise, p_date: contribDate || new Date().toISOString().split("T")[0], p_note: `Contribution to ${contributeGoal.name}${contribNote ? `: ${contribNote.trim()}` : ""}` });
      if (contribError) throw contribError;

      setContribAmount("");
      setContribNote("");
      setContributeGoal(null);
      onGoalsUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to log contribution.");
    } finally {
      setLoading(false);
    }
  };

  // Handle Delete Goal
  const handleDeleteGoal = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      const supabase = createClient();
      await supabase.from("savings_goals").delete().eq("id", id);
      onGoalsUpdated();
    } catch (err: any) {
      alert(err.message || "Failed to delete goal.");
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">Savings Goals</h3>
            <p className="text-[11px] text-slate-500">
              Savings are set aside first to secure your future commitments
            </p>
          </div>
        </div>

        <button
          onClick={() => setIsAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 text-xs font-semibold transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Goal</span>
        </button>
      </div>

      {/* Goals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        {goalsWithCalculations.length > 0 ? (
          goalsWithCalculations.map((goal) => {
            const isCompleted = goal.percent >= 100;

            return (
              <div
                key={goal.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                  isCompleted
                    ? "bg-emerald-50/40 border-emerald-200/80"
                    : "bg-slate-50/70 border-slate-200/80 hover:bg-slate-50"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                        <PiggyBank className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm leading-tight">
                          {goal.name}
                        </h4>
                        {goal.target_date && (
                          <span className="text-[10px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3 h-3 text-slate-400" />
                            Target: {new Date(goal.target_date).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleDeleteGoal(goal.id, goal.name)}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded-md transition-colors"
                      title="Delete goal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Amounts & Percentage */}
                  <div className="flex items-baseline justify-between mt-3 mb-1.5">
                    <span className="text-base font-extrabold text-slate-900">
                      {formatINR(goal.current_amount || 0)}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">
                      Target: {formatINR(goal.target_amount)} ({Math.round(goal.percent)}%)
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-2 w-full bg-slate-200/80 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isCompleted ? "bg-emerald-500" : "bg-purple-600"
                      }`}
                      style={{ width: `${goal.percent}%` }}
                    />
                  </div>
                </div>

                {/* Footer: Needed Per Month & Quick Contribute */}
                <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between gap-2">
                  <div className="text-[11px]">
                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Goal Reached!
                      </span>
                    ) : (
                      <div>
                        <span className="text-slate-500">Needed to hit date: </span>
                        <strong className="text-purple-700 font-bold">
                          {formatINR(goal.metrics.neededPerMonth)}/mo
                        </strong>
                        {goal.metrics.monthsRemaining > 0 && (
                          <span className="text-slate-400 text-[10px] ml-1">
                            ({goal.metrics.monthsRemaining} mo left)
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setContributeGoal(goal)}
                    className="px-3 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs flex items-center gap-1 transition-colors"
                  >
                    <Coins className="w-3 h-3" />
                    <span>Contribute</span>
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="col-span-2 py-8 text-center text-slate-400 space-y-2">
            <PiggyBank className="w-8 h-8 mx-auto opacity-40 text-purple-600" />
            <p className="text-xs">No savings goals set yet.</p>
            <button
              onClick={() => setIsAddOpen(true)}
              className="text-xs font-semibold text-purple-700 hover:underline"
            >
              + Create your first savings goal (e.g. Emergency Fund)
            </button>
          </div>
        )}
      </div>

      {/* MODAL 1: Create New Savings Goal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
            <div className="p-4 px-6 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-600" />
                <h3 className="font-bold text-slate-900 text-base">New Savings Goal</h3>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateGoal} className="p-6 space-y-4">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Goal Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Emergency Fund, Vacation, Car"
                  value={newGoalName}
                  onChange={(e) => setNewGoalName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Target Amount (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 100000"
                  value={newTargetAmount}
                  onChange={(e) => setNewTargetAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-base font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Target Deadline (Optional)
                </label>
                <input
                  type="date"
                  value={newTargetDate}
                  onChange={(e) => setNewTargetDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Used to calculate the required monthly savings pace.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Initial Saved Amount (₹, Optional)
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0"
                  value={initialContribution}
                  onChange={(e) => setInitialContribution(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="flex-1 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-300 text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Create Savings Goal</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Contribute to Goal */}
      {contributeGoal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
            <div className="p-4 px-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base">Contribute to {contributeGoal.name}</h3>
                <p className="text-[11px] text-slate-500">
                  Target: {formatINR(contributeGoal.target_amount)} • Currently saved: {formatINR(contributeGoal.current_amount || 0)}
                </p>
              </div>
              <button
                onClick={() => setContributeGoal(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddContribution} className="p-6 space-y-4">
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Contribution Amount (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  autoFocus
                  placeholder="0"
                  value={contribAmount}
                  onChange={(e) => setContribAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-lg font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Date
                </label>
                <input
                  type="date"
                  value={contribDate}
                  onChange={(e) => setContribDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Monthly automated transfer"
                  value={contribNote}
                  onChange={(e) => setContribNote(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setContributeGoal(null)}
                  className="flex-1 py-2.5 rounded-xl text-slate-600 bg-white border border-slate-300 text-xs font-semibold hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Coins className="w-3.5 h-3.5" />}
                  <span>Save Contribution</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

