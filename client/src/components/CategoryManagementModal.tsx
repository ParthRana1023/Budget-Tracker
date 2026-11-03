"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { X, Plus, Trash2, Edit2, Check, Loader2, Layers, TrendingUp } from "lucide-react";
import { Category } from "./FastExpenseModal";

interface CategoryManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  userId: string;
  onCategoriesUpdated: () => void;
}

export default function CategoryManagementModal({
  isOpen,
  onClose,
  categories,
  userId,
  onCategoriesUpdated,
}: CategoryManagementModalProps) {
  const [activeTab, setActiveTab] = useState<"fixed" | "flexible">("flexible");
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newCatName, setNewCatName] = useState<string>("");
  const [newCatLimit, setNewCatLimit] = useState<string>("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editLimit, setEditLimit] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

  const filteredCategories = categories.filter((c) => c.type === activeTab);

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) {
      setErrorMsg("Please enter a category name");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const limitPaise = Math.round((parseFloat(newCatLimit) || 0) * 100);

      const { error } = await supabase.from("categories").insert({
        user_id: userId,
        name: newCatName.trim(),
        type: activeTab,
        monthly_limit: limitPaise,
      });

      if (error) throw error;

      setNewCatName("");
      setNewCatLimit("");
      setShowAddForm(false);
      onCategoriesUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create category");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateLimit = async (id: string) => {
    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const limitPaise = Math.round((parseFloat(editLimit) || 0) * 100);

      const { error } = await supabase
        .from("categories")
        .update({ monthly_limit: limitPaise })
        .eq("id", id);

      if (error) throw error;

      setEditingCatId(null);
      onCategoriesUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update category");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm("Are you sure you want to delete this category?")) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;

      onCategoriesUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete category");
    } finally {
      setLoading(false);
    }
  };

  const formatRupees = (paise: number) => {
    return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl border border-slate-100 overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="p-5 px-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Category Management</h3>
            <p className="text-xs text-slate-500">Configure your fixed obligations & flexible limits</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="flex border-b border-slate-200 bg-slate-50 p-2 gap-2">
          <button
            onClick={() => setActiveTab("flexible")}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "flexible"
                ? "bg-white text-emerald-700 shadow-xs border border-slate-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Flexible Categories ({categories.filter((c) => c.type === "flexible").length})</span>
          </button>
          <button
            onClick={() => setActiveTab("fixed")}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              activeTab === "fixed"
                ? "bg-white text-emerald-700 shadow-xs border border-slate-200"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Fixed Categories ({categories.filter((c) => c.type === "fixed").length})</span>
          </button>
        </div>

        {/* Content list */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}

          {/* Add Category Button or Form */}
          {!showAddForm ? (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full py-2.5 px-3 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add New {activeTab === "fixed" ? "Fixed" : "Flexible"} Category</span>
            </button>
          ) : (
            <form onSubmit={handleAddCategory} className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-800">
                Create {activeTab === "fixed" ? "Fixed" : "Flexible"} Category
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  placeholder="Category Name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
                <input
                  type="number"
                  placeholder="Monthly Limit in ₹"
                  value={newCatLimit}
                  onChange={(e) => setNewCatLimit(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  <span>Save</span>
                </button>
              </div>
            </form>
          )}

          {/* Categories List */}
          <div className="space-y-2 mt-3">
            {filteredCategories.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div className="flex-1 mr-3">
                  <span className="font-semibold text-slate-800 block">{c.name}</span>
                  {editingCatId === c.id ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="number"
                        value={editLimit}
                        onChange={(e) => setEditLimit(e.target.value)}
                        placeholder="Limit in ₹"
                        className="w-28 px-2 py-1 bg-white border border-emerald-400 rounded text-xs"
                      />
                      <button
                        onClick={() => handleUpdateLimit(c.id)}
                        className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setEditingCatId(null)}
                        className="p-1 text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-slate-500 text-[11px]">
                      Monthly Budget: <strong>{formatRupees(c.monthly_limit)}</strong>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingCatId(c.id);
                      setEditLimit((c.monthly_limit / 100).toString());
                    }}
                    title="Edit limit"
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(c.id)}
                    title="Delete category"
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

