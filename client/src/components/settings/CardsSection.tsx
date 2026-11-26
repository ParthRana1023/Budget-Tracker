"use client";

// Settings › Credit cards (handoff v4 §1, Settings.dc.html ?sec=card): add, edit and remove the
// cards the Dashboard tracks. No amounts owed here; the Dashboard shows those. Each card also has
// a statement day (agreed deviation, plans/v4-handoff-plan.md), so the bill that's due is known.

import { useState, type ReactNode } from "react";
import { ChevronDown, CreditCard, Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { currencySymbol, showTyped } from "@/lib/money.mjs";
import { archiveCard, ordinal, payDayLabel, saveCard } from "@/lib/settings.mjs";
import { Switch, cleanAmount, paise, toField } from "../dashboard/popups/parts";
import type { CreditCard as Card } from "../dashboard/types";
import { BTN_LINE, INPUT, SAVE_ERROR, SELECT, SectionHead } from "./parts";

/** Day-of-month options: bare ordinals, then the last day (handoff v4 product decisions). */
const DAYS = [...Array.from({ length: 28 }, (_, i) => ({ v: i + 1, l: ordinal(i + 1) })), { v: 31, l: "Last day" }];

type Draft = { id?: string; name: string; statementDay: number; dueDay: number; opening: string; reminders: boolean };
const draftOf = (c: Card): Draft => ({
  id: c.id,
  name: c.name,
  statementDay: c.statement_day,
  dueDay: c.due_day,
  opening: c.opening_balance ? toField(Number(c.opening_balance)) : "",
  reminders: c.reminders,
});
const NEW: Draft = { name: "", statementDay: 1, dueDay: 18, opening: "", reminders: true };
/** The two name errors are shown as they are; anything else is the generic save error. */
const NAME_ERRORS = ["Give the card a name so you can tell it apart.", "You already have a card with this name."];

export default function CardsSection({ cards, onChanged }: { cards: Card[]; onChanged: () => Promise<void> }) {
  const live = cards.filter((c) => !c.archived_at);
  /** The card being edited ("new" for one being added). */
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErr(null);
  };
  const toggle = (id: string, c?: Card) => {
    setErr(null);
    setAsking(false);
    if (open === id) return setOpen(null); // a new card closed without saving is just dropped
    setOpen(id);
    setDraft(c ? draftOf(c) : NEW);
  };
  const run = async (write: () => PromiseLike<{ error: { message?: string } | null }>, after: () => void) => {
    if (!navigator.onLine) return setErr(SAVE_ERROR);
    setBusy(true);
    const { error } = await write();
    setBusy(false);
    if (error) return setErr(NAME_ERRORS.includes(error.message ?? "") ? error.message! : SAVE_ERROR);
    after();
    await onChanged();
  };
  const save = () => {
    const name = draft.name.trim();
    if (!name) return setErr(NAME_ERRORS[0]);
    if (live.some((c) => c.id !== draft.id && c.name.trim().toLowerCase() === name.toLowerCase()))
      return setErr(NAME_ERRORS[1]);
    void run(
      async () => {
        const r = await saveCard(createClient(), {
          id: draft.id,
          name,
          statementDay: draft.statementDay,
          dueDay: draft.dueDay,
          opening: paise(draft.opening),
          reminders: draft.reminders,
        });
        if (!r.error) setSaved(r.id);
        return r;
      },
      () => setOpen(null),
    );
  };
  const remove = (id: string) =>
    void run(
      () => archiveCard(createClient(), id),
      () => {
        setOpen(null);
        setAsking(false);
      },
    );

  const daySelect = (id: string, value: number, onChange: (v: number) => void) => (
    <select id={id} value={value} onChange={(e) => onChange(+e.target.value)} className={`${SELECT} w-full`}>
      {DAYS.map((d) => (
        <option key={d.v} value={d.v}>
          {d.l}
        </option>
      ))}
    </select>
  );

  const editor = (pid: string, name: string) => (
    <div id={pid} className="flex flex-col gap-3.5 px-6 pt-1 pb-5">
      <Field id={`${pid}-n`} label="Card name">
        <input
          id={`${pid}-n`}
          type="text"
          maxLength={40}
          value={draft.name}
          onChange={(e) => edit({ name: e.target.value })}
          placeholder="e.g. HDFC Regalia"
          className={`${INPUT} w-full`}
        />
      </Field>
      <Field id={`${pid}-s`} label="Statement closes" help="Day of the month">
        {daySelect(`${pid}-s`, draft.statementDay, (statementDay) => edit({ statementDay }))}
      </Field>
      <Field id={`${pid}-d`} label="Bill due" help="Day of the month">
        {daySelect(`${pid}-d`, draft.dueDay, (dueDay) => edit({ dueDay }))}
      </Field>
      <Field id={`${pid}-o`} label="Opening balance" help="Owed before you started logging">
        <span className={`${INPUT} flex w-full items-center gap-1.5 focus-within:border-lime`}>
          <span className="text-muted">{currencySymbol()}</span>
          <input
            id={`${pid}-o`}
            inputMode="decimal"
            value={showTyped(draft.opening)}
            onChange={(e) => edit({ opening: cleanAmount(e.target.value) })}
            placeholder="0"
            className="tabular min-w-0 flex-1 border-0 bg-transparent font-semibold text-ink outline-none focus-visible:outline-none"
          />
        </span>
      </Field>
      <div className="flex items-center gap-3.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">Bill reminders</span>
          <span className="text-[13px] text-muted">3 days before and on the due date</span>
        </div>
        <Switch
          on={draft.reminders}
          onToggle={() => edit({ reminders: !draft.reminders })}
          label="Bill reminders for this card"
        />
      </div>
      {err && (
        <span role="alert" className="text-[13px] font-semibold text-danger">
          {err}
        </span>
      )}
      {asking && draft.id ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl bg-danger-soft px-3.5 py-3 text-[13px] text-danger"
        >
          <span className="flex-[1_1_240px] font-semibold text-pretty">
            Remove {name}? Its purchases and payments stay in your history, but it’s no longer tracked as owed.
          </span>
          <button type="button" onClick={() => setAsking(false)} className={BTN_LINE}>
            Keep card
          </button>
          <button
            type="button"
            onClick={() => remove(draft.id!)}
            disabled={busy}
            className="h-[38px] cursor-pointer rounded-full border-0 bg-danger px-4 text-[13px] font-bold text-danger-ink disabled:opacity-60"
          >
            Remove card
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2.5 border-t border-line pt-3">
          {draft.id ? (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-danger"
            >
              Remove card
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="h-[38px] cursor-pointer rounded-full border-0 bg-lime px-5 text-[13px] font-bold text-lime-ink disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );

  const row = (id: string, name: string, sub: string, c?: Card) => {
    const on = open === id,
      pid = `card-p-${id}`;
    return (
      <div key={id} className="flex flex-col">
        <button
          type="button"
          onClick={() => toggle(id, c)}
          aria-expanded={on}
          aria-controls={pid}
          className="flex min-h-16 w-full cursor-pointer items-center gap-3.5 border-0 bg-transparent px-6 py-3 text-left hover:bg-tile-2"
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-tile-2 text-ink-2">
            <CreditCard size={17} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[15px] font-semibold">{name}</span>
            <span className="truncate text-[13px] text-muted">{sub}</span>
          </span>
          {saved === id && <span className="text-xs font-semibold text-lime-text">Saved</span>}
          <ChevronDown
            size={16}
            aria-hidden
            className="flex-none text-ink-2 transition-transform duration-200"
            style={{ transform: `rotate(${on ? 180 : 0}deg)` }}
          />
        </button>
        {on && editor(pid, name)}
      </div>
    );
  };

  return (
    <>
      <SectionHead
        title="Credit cards"
        lede="Track what you owe on each card and when it’s due. Card spend already counts toward safe to spend."
      />
      <div className="flex flex-col divide-y divide-line rounded-[18px] border border-line bg-tile">
        {!live.length && open !== "new" && (
          <div className="flex flex-col gap-1 px-6 py-5">
            <span className="text-sm font-semibold">No cards yet</span>
            <span className="text-[13px] text-pretty text-muted">
              Add a card to see its bill on the Dashboard and get reminders before it’s due.
            </span>
          </div>
        )}
        {live.map((c) =>
          row(
            c.id,
            c.name,
            `Statement on the ${payDayLabel(c.statement_day)} · due on the ${payDayLabel(c.due_day)} · reminders ${c.reminders ? "on" : "off"}`,
            c,
          ),
        )}
        {open === "new" && row("new", draft.name.trim() || "New card", "Not saved yet")}
        <div className="px-6 py-4">
          <button
            type="button"
            onClick={() => toggle("new")}
            disabled={open === "new"}
            className={`${BTN_LINE} gap-2 hover:border-lime`}
          >
            <Plus size={15} aria-hidden />
            Add card
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ id, label, help, children }: { id: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <label htmlFor={id} className="flex flex-[0_0_180px] flex-col text-sm font-semibold">
        {label}
        {help && <span className="text-[13px] font-normal text-muted">{help}</span>}
      </label>
      <div className="min-w-0 flex-[1_1_200px]">{children}</div>
    </div>
  );
}
