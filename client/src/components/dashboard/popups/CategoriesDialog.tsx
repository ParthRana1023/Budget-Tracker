"use client";

// Categories (design handoff, Popups): Flexible / Fixed tabs; rename, set a limit or an
// amount + due day, move between the two, delete unused, add. Changes apply on close, with Undo.

import { useState } from "react";
import { Lock, Trash2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { baseCurrency, cleanTyped, currencySymbol, inr, showTyped, toMajor, toMinor } from "@/lib/money.mjs";
import { convert, fetchRate } from "@/lib/fx.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import { categoryDiff, draftProblems } from "@/lib/categoryDiff.mjs";
import Dialog from "../../ui/Dialog";
import type { Category } from "../types";
import type { PopupContext } from "./context";
import { FIELD, Preview, SAVE_FAILED, cleanAmount, cleanDay, paise, toField } from "./parts";
import { CurrencyChip, CurrencyList } from "./currency";

type Cat = {
  id: string;
  name: string;
  type: "fixed" | "flexible";
  monthly_limit: number;
  due_day: number | null;
  is_active: boolean;
  original_amount: number | null;
  original_currency: string | null;
  fx_rate: number | null;
  fx_date: string | null;
  /** The currency the limit is typed in (the base currency for most rows). Not saved itself. */
  currency: string;
};
const asCat = (c: Category): Cat => ({
  id: c.id,
  name: c.name,
  type: c.type,
  monthly_limit: Number(c.monthly_limit),
  due_day: c.due_day ?? null,
  is_active: c.is_active !== false,
  original_amount: c.original_currency ? Number(c.original_amount) : null,
  original_currency: c.original_currency ?? null,
  fx_rate: c.original_currency ? Number(c.fx_rate) : null,
  fx_date: c.fx_date ?? null,
  currency: c.original_currency ?? baseCurrency(),
});
const SMALL =
  "h-10 rounded-[10px] border border-line-2 bg-tile-2 text-[15px] text-ink outline-none focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";

/** Applies a diff; returns the first error. */
async function apply(userId: string, d: ReturnType<typeof categoryDiff>) {
  const db = createClient();
  for (const u of d.updates) {
    const r = await db.from("categories").update(u.patch).eq("id", u.id);
    if (r.error) return r.error;
  }
  if (d.inserts.length) {
    const r = await db.from("categories").insert(d.inserts.map((row) => ({ ...row, user_id: userId })));
    if (r.error) return r.error;
  }
  return null;
}

export default function CategoriesDialog({ ctx, onClose }: { ctx: PopupContext; onClose: () => void }) {
  const before = ctx.categories.map(asCat);
  const saved = new Map(before.map((c) => [c.id, c]));
  const cycleStart = ctx.period.startStr;
  const [draft, setDraft] = useState<Cat[]>(before);
  // Typed values (in each row's currency), kept as text while editing.
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(
      before.map((c) => [
        c.id,
        c.original_currency
          ? String(toMajor(Number(c.original_amount), c.original_currency))
          : c.monthly_limit
            ? toField(c.monthly_limit)
            : "",
      ]),
    ),
  );
  // One rate per foreign currency (base units for 1 of it), this cycle's or a saved row's.
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(before.filter((c) => c.original_currency).map((c) => [c.currency, String(c.fx_rate)])),
  );
  const [rateNotes, setRateNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"flexible" | "fixed">("flexible");
  const [add, setAdd] = useState({ name: "", limit: "", due: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { model } = ctx;

  const update = (id: string, patch: Partial<Cat>) => {
    setDraft((d) => d.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setError(null);
  };
  // Each row priced from what was typed: monthly_limit is in the base currency; a foreign limit
  // also keeps its original amount and rate. A saved rate keeps its date.
  const priced = draft.map((c): Cat => {
    const minor = toMinor(parseFloat(limits[c.id] ?? "") || 0, c.currency);
    const plain = { original_amount: null, original_currency: null, fx_rate: null, fx_date: null };
    if (c.currency === baseCurrency() || !minor) return { ...c, ...plain, monthly_limit: minor };
    const r = parseFloat(rates[c.currency] ?? "");
    const was = saved.get(c.id);
    return {
      ...c,
      monthly_limit: r > 0 ? convert(minor, c.currency, r) : 0,
      original_amount: minor,
      original_currency: c.currency,
      fx_rate: r > 0 ? r : null,
      fx_date: was?.fx_rate === r && was.fx_date ? was.fx_date : cycleStart,
    };
  });
  // The row whose currency list is open (one at a time; it opens under that row).
  const [listFor, setListFor] = useState<string | null>(null);
  const pickCurrency = (id: string, code: string) => {
    update(id, { currency: code });
    if (code === baseCurrency() || rates[code] !== undefined) return;
    setRates((r) => ({ ...r, [code]: "" }));
    setRateNotes((n) => ({ ...n, [code]: "Getting this cycle’s rate…" }));
    fetchRate(code, cycleStart).then(
      (r) => {
        setRates((x) => ({ ...x, [code]: x[code] || String(r.rate) }));
        setRateNotes((n) => ({
          ...n,
          [code]: r.stale
            ? `The rates service is down, so this is the rate from ${shortDate(r.date)}. Change it if you need to.`
            : `The rate on ${shortDate(cycleStart)}, when this cycle started. Limits follow each new cycle’s rate.`,
        }));
      },
      (e: Error) => setRateNotes((n) => ({ ...n, [code]: e.message })),
    );
  };
  const live = priced.filter((c) => c.is_active);
  const foreignInUse = [...new Set(live.filter((c) => c.original_currency).map((c) => c.currency))];
  const rows = live.filter((c) => c.type === tab);
  const usedThisCycle = (id: string) => (model.spentByCat.get(id) ?? 0) > 0;

  const addCategory = () => {
    const name = add.name.trim();
    if (!name) return setError("Give the new category a name.");
    const limit = paise(add.limit);
    if (tab === "fixed" && limit <= 0) return setError(`A fixed bill needs a monthly amount above ${inr(0)}.`);
    const due = add.due ? Math.min(28, Math.max(1, +add.due)) : null;
    // Re-adding a name that was switched off brings that category back.
    const old = draft.find((c) => !c.is_active && c.name.trim().toLowerCase() === name.toLowerCase());
    const id = old?.id ?? `new-${Date.now()}`;
    const row: Cat = {
      id,
      name,
      type: tab,
      monthly_limit: limit,
      due_day: tab === "fixed" ? due : null,
      is_active: true,
      original_amount: null,
      original_currency: null,
      fx_rate: null,
      fx_date: null,
      currency: baseCurrency(),
    };
    setDraft((d) => (old ? d.map((c) => (c.id === id ? row : c)) : [...d, row]));
    setLimits((l) => ({ ...l, [id]: limit ? toField(limit) : "" }));
    setAdd({ name: "", limit: "", due: "" });
    setError(null);
  };

  // Closing (Done, X, Esc, outside) applies the changes.
  const close = async () => {
    const unrated = live.find((c) => c.original_currency && !c.fx_rate);
    if (unrated)
      return setError(`Add the rate for 1 ${unrated.currency} to save ${unrated.name.trim() || "this limit"}.`);
    const problems = draftProblems(priced);
    if (problems.length) return setError(problems[0]);
    const diff = categoryDiff(before, priced);
    if (!diff.updates.length && !diff.inserts.length) return onClose();
    if (!navigator.onLine) return setError("You’re offline, so this wasn’t saved. Reconnect and try again.");
    setBusy(true);
    const err = await apply(ctx.userId, diff);
    setBusy(false);
    if (err) return setError(SAVE_FAILED);
    onClose();
    // Undo: back to how it was. New rows can't be removed by a diff, so they are switched off.
    const undo = categoryDiff(
      priced.filter((c) => !c.id.startsWith("new-")),
      before,
    );
    await ctx.saved("Categories updated", async () => {
      const db = createClient();
      const added = diff.inserts.map((r) => r.name);
      if (added.length) {
        const r = await db.from("categories").update({ is_active: false }).eq("user_id", ctx.userId).in("name", added);
        if (r.error) return { error: r.error };
      }
      return { error: await apply(ctx.userId, undo) };
    });
  };

  const flexBudget = live.filter((c) => c.type === "flexible").reduce((s, c) => s + c.monthly_limit, 0);
  const billTotal = live.filter((c) => c.type === "fixed").reduce((s, c) => s + c.monthly_limit, 0);

  return (
    <Dialog
      open
      onClose={close}
      eyebrow="Limits and bills"
      title="Categories"
      size="lg"
      error={error}
      onSubmit={close}
      busy={busy}
      showCancel={false}
      hint="Changes apply when you close · Undo after"
      submitLabel={busy ? "Saving…" : "Done"}
    >
      <div role="tablist" className="flex gap-0.5 rounded-full border border-line p-[3px]">
        {(
          [
            ["flexible", "Flexible"],
            ["fixed", "Fixed bills"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className="min-h-[38px] flex-1 cursor-pointer rounded-full border-0 text-[13px] font-semibold transition-colors duration-200"
            style={{
              background: tab === k ? "var(--ink)" : "transparent",
              color: tab === k ? "var(--bg)" : "var(--muted)",
            }}
          >
            {label} · {live.filter((c) => c.type === k).length}
          </button>
        ))}
      </div>
      <div className="flex flex-col">
        {rows.map((c) => {
          const spent = model.spentByCat.get(c.id) ?? 0,
            inUse = usedThisCycle(c.id);
          return (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3"
              data-testid="category-row"
              data-name={c.name}
            >
              <span className="flex min-w-0 flex-[1_1_150px] flex-col gap-0.5">
                <input
                  type="text"
                  aria-label={`${c.name} name`}
                  value={c.name}
                  onChange={(e) => update(c.id, { name: e.target.value })}
                  className="-ml-2 h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[15px] font-semibold text-ink outline-none hover:border-line-2 focus:border-lime focus:bg-tile-2 focus-visible:outline-none"
                />
                <span className="tabular text-xs text-muted">
                  {inr(spent)} {c.type === "flexible" ? "spent" : "paid"} this cycle
                </span>
              </span>
              <button
                type="button"
                onClick={() => update(c.id, { type: c.type === "flexible" ? "fixed" : "flexible" })}
                aria-label={`Move ${c.name} to ${c.type === "flexible" ? "fixed bills" : "flexible"}`}
                className="h-8 cursor-pointer rounded-full border border-line bg-transparent px-2.5 text-xs font-semibold text-ink-2 hover:border-ink-2"
              >
                {c.type === "flexible" ? "→ Fixed" : "→ Flexible"}
              </button>
              <span className="flex items-center gap-1.5">
                <CurrencyChip
                  currency={c.currency}
                  label={`${c.name} currency`}
                  open={listFor === c.id}
                  onToggle={() => setListFor(listFor === c.id ? null : c.id)}
                />
                <span className="text-muted">{currencySymbol(c.currency)}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={c.type === "flexible" ? "No limit" : "Amount"}
                  aria-label={`${c.name} monthly ${c.type === "flexible" ? "limit" : "amount"}`}
                  value={showTyped(limits[c.id] ?? "")}
                  onChange={(e) => {
                    setLimits((l) => ({ ...l, [c.id]: cleanTyped(e.target.value, undefined, c.currency) }));
                    setError(null);
                  }}
                  className={`${SMALL} tabular w-28 px-2.5 text-right font-semibold`}
                />
              </span>
              {listFor === c.id && (
                <div className="w-full">
                  <CurrencyList
                    value={c.currency}
                    onPick={(code) => {
                      pickCurrency(c.id, code);
                      setListFor(null);
                    }}
                    onClose={() => setListFor(null)}
                  />
                </div>
              )}
              {c.original_currency && (
                <span className="tabular w-full text-right text-xs text-muted">
                  {c.fx_rate ? `≈ ${inr(c.monthly_limit)} this cycle` : "Needs a rate"}
                </span>
              )}
              {c.type === "fixed" && (
                <span className="flex items-center gap-1.5 text-[13px] text-muted">
                  day
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="—"
                    aria-label={`${c.name} due day`}
                    value={c.due_day ?? ""}
                    onChange={(e) => {
                      const v = cleanDay(e.target.value);
                      update(c.id, { due_day: v ? Math.min(28, Math.max(1, +v)) : null });
                    }}
                    className={`${SMALL} w-[52px] px-2 text-center`}
                  />
                </span>
              )}
              {inUse ? (
                <span
                  title="Has entries this cycle, so it can’t be deleted"
                  className="flex w-9 justify-center text-muted"
                >
                  <Lock size={14} />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => update(c.id, { is_active: false })}
                  aria-label={`Delete ${c.name}`}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-muted hover:border-danger hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {foreignInUse.map((code) => (
        <label key={code} className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">
            {currencySymbol()} for 1 {code}
          </span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${currencySymbol()} for 1 ${code}`}
            value={rates[code] ?? ""}
            onChange={(e) => {
              setRates((r) => ({ ...r, [code]: e.target.value.replace(/[^\d.]/g, "").slice(0, 14) }));
              setError(null);
            }}
            className={`${FIELD} tabular h-11`}
          />
          {rateNotes[code] && <span className="text-[13px] text-pretty text-muted">{rateNotes[code]}</span>}
        </label>
      ))}
      <div className="flex flex-col gap-2.5 rounded-[14px] border border-dashed border-line-2 p-4">
        <span className="eyebrow">Add a category</span>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Name"
            aria-label="New category name"
            value={add.name}
            onChange={(e) => setAdd({ ...add, name: e.target.value })}
            className={`${FIELD} h-11 w-auto flex-[2_1_160px]`}
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder={tab === "flexible" ? "Blank = no limit" : "Monthly amount"}
            aria-label="Monthly limit"
            value={showTyped(add.limit)}
            onChange={(e) => setAdd({ ...add, limit: cleanAmount(e.target.value) })}
            className={`${FIELD} h-11 w-auto flex-[1_1_120px]`}
          />
          {tab === "fixed" && (
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              placeholder="Due day"
              aria-label="Due day"
              value={add.due}
              onChange={(e) => setAdd({ ...add, due: cleanDay(e.target.value) })}
              className={`${FIELD} h-11 w-auto flex-[0_1_96px]`}
            />
          )}
          <button
            type="button"
            onClick={addCategory}
            className="h-11 cursor-pointer rounded-full border-0 bg-ink px-[18px] text-sm font-bold text-bg active:scale-[.97]"
          >
            Add
          </button>
        </div>
      </div>
      <Preview
        label="Flexible budget"
        value={inr(flexBudget)}
        line={`across ${live.filter((c) => c.type === "flexible").length} categories · bills ${inr(billTotal)}`}
      />
    </Dialog>
  );
}
