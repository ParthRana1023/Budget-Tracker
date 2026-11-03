"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Check, Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { isRecurringItemDue } from "@/lib/recurrence.mjs";
import { Category } from "./FastExpenseModal";

export default function RecurringItemsSection({ items, transactions, categories, userId, onUpdated }: { items: any[]; transactions: any[]; categories: Category[]; userId: string; onUpdated: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("1");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const dueItems = useMemo(() => items.filter((item) => isRecurringItemDue(item, transactions)), [items, transactions]);

  const save = async () => {
    const value = Math.round(Number(amount) * 100);
    if (!name.trim() || !value || Number(day) < 1 || Number(day) > 28 || (type === "expense" && !categoryId)) { setError("Enter a name, amount, day (1–28), and expense category."); return; }
    const { error } = await createClient().from("recurring_items").insert({ user_id: userId, name: name.trim(), amount: value, day_of_month: Number(day), type, category_id: type === "expense" ? categoryId : null });
    if (error) { setError(error.message); return; }
    setAdding(false); setName(""); setAmount(""); setError(""); onUpdated();
  };
  const post = async (item: any) => {
    if (!confirm(`Post ${item.name} for ₹${(item.amount / 100).toLocaleString("en-IN")} now?`)) return;
    const date = new Date().toISOString().slice(0, 10); const client = createClient();
    const { error } = await client.rpc("post_recurring_item", { p_item_id: item.id, p_date: date });
    if (error) { setError(error.message); return; }
    onUpdated();
  };
  return <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3"><div className="flex justify-between items-center"><div><h2 className="font-bold text-sm">Recurring items</h2><p className="text-xs text-slate-500">Review before posting each month.</p></div><button onClick={() => setAdding(!adding)} className="text-xs font-semibold text-emerald-700 flex gap-1 items-center"><Plus className="w-4 h-4" /> Schedule</button></div>{error && <p className="text-xs text-rose-700">{error}</p>}{adding && <div className="grid grid-cols-2 sm:grid-cols-5 gap-2"><input aria-label="Recurring item name" value={name} onChange={e=>setName(e.target.value)} placeholder="Rent or salary" className="border rounded-lg px-2 py-2 text-xs"/><input aria-label="Recurring amount" value={amount} onChange={e=>setAmount(e.target.value)} type="number" placeholder="Amount" className="border rounded-lg px-2 py-2 text-xs"/><input aria-label="Recurring day" value={day} onChange={e=>setDay(e.target.value)} type="number" min="1" max="28" className="border rounded-lg px-2 py-2 text-xs"/><select value={categoryId} onChange={e=>setCategoryId(e.target.value)} disabled={type === "income"} className="border rounded-lg px-2 py-2 text-xs"><option value="">Expense category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button onClick={save} className="bg-emerald-600 text-white rounded-lg text-xs font-semibold">Save schedule</button><button onClick={()=>setType(type === "expense" ? "income" : "expense")} className="text-xs text-slate-600 col-span-2">Type: {type}</button></div>}{dueItems.map(item=><div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-amber-50 border border-amber-200"><div className="flex gap-2"><CalendarClock className="w-4 h-4 text-amber-700"/><span className="text-xs"><b>{item.name}</b> due today · ₹{(item.amount / 100).toLocaleString("en-IN")}</span></div><button onClick={()=>post(item)} className="text-xs font-semibold text-amber-900 flex gap-1"><Check className="w-4 h-4"/> Review & post</button></div>)}{!dueItems.length && <p className="text-xs text-slate-500">No recurring items are due.</p>}</section>;
}
