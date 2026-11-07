"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { X, Plus, Trash2, Edit2, Check, Loader2, Layers, TrendingUp, RotateCcw } from "lucide-react";
import { Category } from "./FastExpenseModal";

interface CategoryManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  userId: string;
  onCategoriesUpdated: () => void;
}

/** "" or "0" means "no limit"; anything negative or non-numeric is rejected (null). Returns paise. */
function parseLimitToPaise(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
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
  const [editName, setEditName] = useState<string>("");
  const [infoMsg, setInfoMsg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  if (!isOpen) return null;

  const filteredCategories = categories.filter((c) => c.type === activeTab);

  const nameTaken = (name: string, exceptId?: string) =>
    categories.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase());

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfoMsg("");
    if (!newCatName.trim()) {
      setErrorMsg("Please enter a category name");
      return;
    }
    if (nameTaken(newCatName)) {
      setErrorMsg(`A category named "${newCatName.trim()}" already exists`);
      return;
    }
    if (parseLimitToPaise(newCatLimit) === null) {
      setErrorMsg("Enter a valid monthly limit (0 or more), or leave it blank for no limit");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const limitPaise = parseLimitToPaise(newCatLimit) ?? 0;

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

  const handleUpdateCategory = async (id: string) => {
    setInfoMsg("");
    if (!editName.trim()) {
      setErrorMsg("Category name cannot be empty");
      return;
    }
    if (nameTaken(editName, id)) {
      setErrorMsg(`A category named "${editName.trim()}" already exists`);
      return;
    }
    const limitPaise = parseLimitToPaise(editLimit);
    if (limitPaise === null) {
      setErrorMsg("Enter a valid monthly limit (0 or more), or leave it blank for no limit");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("categories")
        .update({ name: editName.trim(), monthly_limit: limitPaise })
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

  // Re-creates any starter category the user has deleted. Existing categories,
  // limits and transactions are never touched.
  const handleRestoreStarters = async () => {
    setLoading(true);
    setErrorMsg("");
    setInfoMsg("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ensure_starter_categories");
      if (error) throw error;
      const added = Number(data) || 0;
      setInfoMsg(added === 0 ? "All starter categories are already present." : `Restored ${added} starter categor${added === 1 ? "y" : "ies"} (no limit set).`);
      if (added > 0) onCategoriesUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to restore starter categories");
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
  const toggleEdit = (c: Category) => {
    setErrorMsg("");
    setInfoMsg("");
    setEditingCatId(c.id);
    setEditName(c.name);
    setEditLimit(c.monthly_limit > 0 ? (c.monthly_limit / 100).toString() : "");
  };

  return (
    <div role="dialog" aria-label="Category Management" data-testid="category-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
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
            <div role="alert" data-testid="category-error" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div role="status" data-testid="category-info" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              {infoMsg}
            </div>
          )}

          <button
            type="button"
            data-testid="restore-starters"
            onClick={handleRestoreStarters}
            disabled={loading}
            className="w-full py-2 px-3 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-semibold hover:bg-slate-50 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore starter categories</span>
          </button>

          {/* Add Category Button or Form */}
          {!showAddForm ? (
            <button
              data-testid="add-category-btn"
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
                  aria-label="Category name"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
                <input
                  type="number"
                  placeholder="Monthly Limit in ₹"
                  aria-label="Monthly limit in rupees"
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
                data-testid="category-row"
                data-name={c.name}
                className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div className="flex-1 mr-3">
                  {editingCatId === c.id ? (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label="Category name"
                        data-testid="category-edit-name"
                        className="w-full px-2 py-1 bg-white border border-emerald-400 rounded text-xs"
                      />
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={editLimit}
                          onChange={(e) => setEditLimit(e.target.value)}
                          placeholder="Limit in ₹ (blank = none)"
                          aria-label="Monthly limit in rupees"
                          data-testid="category-edit-limit"
                          className="w-40 px-2 py-1 bg-white border border-emerald-400 rounded text-xs"
                        />
                        <button
                          onClick={() => handleUpdateCategory(c.id)}
                          disabled={loading}
                          aria-label="Save category"
                          data-testid="category-edit-save"
                          className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setEditingCatId(null)}
                          aria-label="Cancel editing"
                          className="p-1 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="font-semibold text-slate-800 block">{c.name}</span>
                      <span className="text-slate-500 text-[11px]" data-testid="category-limit">
                        {c.monthly_limit > 0 ? (
                          <>Monthly Budget: <strong>{formatRupees(c.monthly_limit)}</strong></>
                        ) : (
                          <em>No limit set</em>
                        )}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleEdit(c)}
                    title="Edit category"
                    aria-label={`Edit ${c.name}`}
                    data-testid="category-edit-btn"
                    className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteCategory(c.id)}
                    title="Delete category"
                    aria-label={`Delete ${c.name}`}
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

