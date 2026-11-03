"use client";

import { useState, useMemo } from "react";
import { 
  Search, 
  Filter, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Calendar, 
  FileText,
  SlidersHorizontal,
  Edit2
} from "lucide-react";
import { TransactionItem } from "./EditTransactionModal";
import { Category } from "./FastExpenseModal";

interface TransactionListProps {
  transactions: TransactionItem[];
  categories: Category[];
  onEditTransaction: (item: TransactionItem) => void;
  onOpenFastExpense: () => void;
}

export default function TransactionList({
  transactions,
  categories,
  onEditTransaction,
  onOpenFastExpense,
}: TransactionListProps) {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedType, setSelectedType] = useState<string>("all");

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // Type filter
      if (selectedType !== "all" && t.type !== selectedType) {
        return false;
      }
      // Category filter
      if (selectedCategory !== "all" && t.category_id !== selectedCategory) {
        return false;
      }
      // Search term filter
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const noteMatch = (t.note || "").toLowerCase().includes(term);
        const catMatch = (t.category?.name || "").toLowerCase().includes(term);
        if (!noteMatch && !catMatch) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, selectedCategory, selectedType, searchTerm]);

  const formatINR = (paise: number) => {
    return `₹${(paise / 100).toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
      {/* Title & Filters row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 text-base">Transactions</h3>
          <p className="text-xs text-slate-500">
            {filteredTransactions.length} of {transactions.length} entries shown
          </p>
        </div>

        {/* Search bar */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search notes or categories..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Filter Chips Bar */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mr-1">
          <SlidersHorizontal className="w-3 h-3" />
          <span>Filters:</span>
        </div>

        {/* Type Filter */}
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700"
        >
          <option value="all">All Types</option>
          <option value="expense">Expenses Only</option>
          <option value="income">Income Only</option>
        </select>

        {/* Category Filter */}
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 max-w-xs"
        >
          <option value="all">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {(selectedType !== "all" || selectedCategory !== "all" || searchTerm) && (
          <button
            onClick={() => {
              setSelectedType("all");
              setSelectedCategory("all");
              setSearchTerm("");
            }}
            className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 ml-auto"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Transactions List */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
        {filteredTransactions.length > 0 ? (
          filteredTransactions.map((item) => {
            const isExpense = item.type === "expense";
            return (
              <div
                key={item.id}
                onClick={() => onEditTransaction(item)}
                className="p-3 rounded-2xl bg-slate-50 hover:bg-slate-100/80 border border-slate-100 flex items-center justify-between text-xs transition-colors cursor-pointer group"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      isExpense
                        ? "bg-rose-100 text-rose-600"
                        : "bg-emerald-100 text-emerald-600"
                    }`}
                  >
                    {isExpense ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownLeft className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">
                        {item.category?.name || (isExpense ? "Uncategorized Expense" : "Income")}
                      </span>
                      {item.category?.type && (
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                          • {item.category.type}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span>{item.date}</span>
                      {item.note && (
                        <>
                          <span>•</span>
                          <span className="truncate max-w-xs">{item.note}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`font-bold text-sm ${
                      isExpense ? "text-slate-900" : "text-emerald-600"
                    }`}
                  >
                    {isExpense ? "− " : "+ "}
                    {formatINR(item.amount)}
                  </span>
                  <Edit2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            );
          })
        ) : (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <FileText className="w-8 h-8 mx-auto opacity-50" />
            <p className="text-xs">No transactions match your filters.</p>
            <button
              onClick={onOpenFastExpense}
              className="text-xs font-semibold text-emerald-600 hover:underline"
            >
              + Log an expense now in 3 taps
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

