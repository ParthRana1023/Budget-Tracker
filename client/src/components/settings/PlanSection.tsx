"use client";

// Settings › Budget plan (design handoff v2): salary, payday and save first wait for
// "Apply from when?" (this cycle or the next), then land in the plan history.

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { currencySymbol, formatMoney, NUMBER_LOCALES, toMajor, toMinor } from "@/lib/money.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import {
  applyPlan,
  nextCycleStart,
  ordinal,
  PAYDAY_OPTIONS,
  payDayLabel,
  payDayPreview,
  pendingPlan,
  planHistory,
} from "@/lib/settings.mjs";
import type { PayDayEntry } from "@/lib/periods.mjs";
import type { Settings } from "../dashboard/types";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import { BTN_LINK, Card, INPUT, Row, SAVE_ERROR, SELECT, SectionHead } from "./parts";

type Field = "salary" | "payday" | "save_pct";
type Format = NonNullable<Settings["number_format"]>;

const cycleRuns = (d: number) =>
  d === 1 ? "1st – last day" : d === 31 ? "last day – day before" : `${ordinal(d)} – ${ordinal(d - 1)}`;
const longDate = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const LABEL = { salary: "Salary", payday: "Payday", save_pct: "Save first", currency: "Base currency" } as const;
const MIN_PCT = 5,
  MAX_PCT = 60;

export default function PlanSection({
  settings,
  schedule,
  today,
  cycleDays,
  fixedBills,
  onApplied,
}: {
  settings: Settings;
  schedule: PayDayEntry[];
  today: string;
  cycleDays: number;
  fixedBills: number;
  /** After a save: refresh, then toast with Undo. */
  onApplied: (message: string) => Promise<void>;
}) {
  const format: Format = settings.number_format ?? "indian";
  const money = (p: number) => formatMoney(p, format);
  const base = {
    salary: String(Math.round(toMajor(Number(settings.take_home_pay ?? 0)))),
    payday: String(settings.month_start_day ?? 1),
    save_pct: String(settings.savings_pct ?? 20),
  };
  const [form, setForm] = useState(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<{ fields: Field[]; from: string | null } | null>(null);
  const [allHistory, setAllHistory] = useState(false);

  // A fresh base (after a save or Undo) resets the form.
  const baseKey = `${base.salary}|${base.payday}|${base.save_pct}`;
  const [seenKey, setSeenKey] = useState(baseKey);
  if (seenKey !== baseKey) {
    setSeenKey(baseKey);
    setForm(base);
  }

  const edited = (Object.keys(base) as Field[]).filter((k) => form[k] !== base[k]);
  const set = (k: Field, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
    setJustSaved(null);
  };
  const pending = pendingPlan(settings, today);
  const nextFrom = nextCycleStart(schedule, today);

  const status = (k: Field): [string, string] => {
    if (edited.includes(k)) return ["Not saved", "var(--warn)"];
    if (justSaved?.fields.includes(k))
      return [justSaved.from ? `✓ Saved · from ${shortDate(justSaved.from)}` : "✓ Saved", "var(--lime-text)"];
    if (pending[k]) return [`Starts ${shortDate(pending[k]!)}`, "var(--muted)"];
    return ["", "var(--muted)"];
  };

  const sal = +form.salary || 0,
    pct = Math.min(100, +form.save_pct || 0),
    payday = +form.payday;
  const save0 = toMinor(Math.round((+base.salary * +base.save_pct) / 100)),
    save1 = toMinor(Math.round((sal * pct) / 100));
  const left0 = toMinor(+base.salary) - save0 - fixedBills,
    left1 = toMinor(sal) - save1 - fixedBills;
  const effects: { label: string; from: string; to: string; color: string }[] = [];
  if (edited.includes("salary") || edited.includes("save_pct")) {
    if (save0 !== save1)
      effects.push({
        label: "Saved first each month",
        from: money(save0),
        to: money(save1),
        color: "var(--lime-text)",
      });
    effects.push({
      label: "Left after bills and savings",
      from: money(left0),
      to: money(left1),
      color: left1 < 0 ? "var(--danger)" : left1 < left0 ? "var(--warn)" : "var(--ink)",
    });
    effects.push({
      label: "Safe to spend per day",
      from: money(left0 / cycleDays),
      to: money(left1 / cycleDays),
      color: left1 < left0 ? "var(--warn)" : "var(--ink)",
    });
  }
  const paydayPreview = edited.includes("payday") ? payDayPreview(schedule, today, payday) : null;
  if (paydayPreview)
    effects.push({
      label: "Each cycle runs",
      from: cycleRuns(+base.payday),
      to: cycleRuns(payday),
      color: "var(--ink)",
    });

  const apply = async (applies: "now" | "next") => {
    if (edited.includes("salary") && sal <= 0) return setError("Enter your monthly salary.");
    if (edited.includes("save_pct") && (pct < MIN_PCT || pct > MAX_PCT))
      return setError(`Save first must be between ${MIN_PCT}% and ${MAX_PCT}%.`);
    if (!navigator.onLine) return setError(SAVE_ERROR);
    setBusy(true);
    const { error: err } = await applyPlan(
      createClient(),
      {
        salary: edited.includes("salary") ? toMinor(sal) : undefined,
        payday: edited.includes("payday") ? payday : undefined,
        savePct: edited.includes("save_pct") ? pct : undefined,
      },
      applies,
      schedule,
      today,
    );
    setBusy(false);
    if (err) {
      reportClientError("plan_apply_failed", { ...errorFields(err) });
      return setError(SAVE_ERROR);
    }
    setJustSaved({ fields: edited, from: applies === "next" ? nextFrom : null });
    await onApplied(applies === "next" ? `Plan updated · from ${shortDate(nextFrom)}` : "Plan updated for this cycle");
  };

  const history = planHistory(settings);
  const shown = allHistory ? history : history.slice(0, 4);
  // A salary row from a base switch shows each side in its own currency (₹1,00,000 → $1,200).
  const value = (field: Field | "currency", v: number | null, code: string | null) =>
    field === "currency"
      ? (code ?? "—")
      : v === null
        ? "—"
        : field === "salary"
          ? code
            ? formatMoney(v, format, code)
            : money(v)
          : field === "payday"
            ? payDayLabel(v)
            : `${v}%`;
  const statusCell = (k: Field) => {
    const [text, color] = status(k);
    return (
      <span aria-live="polite" className="flex-[0_0_120px] text-xs font-semibold" style={{ color }}>
        {text}
      </span>
    );
  };
  const loc = NUMBER_LOCALES[format];

  return (
    <>
      <SectionHead title="Budget plan" lede="What you earn, when it lands, and how much is set aside first." />
      <Card>
        <Row label="Monthly salary" htmlFor="f-sal">
          <span className={`${INPUT} flex flex-[1_1_220px] items-center gap-1.5 focus-within:border-lime`}>
            <span className="text-muted">{currencySymbol()}</span>
            <input
              id="f-sal"
              inputMode="numeric"
              autoComplete="off"
              value={form.salary ? Number(form.salary).toLocaleString(loc) : ""}
              onChange={(e) => set("salary", e.target.value.replace(/\D/g, "").slice(0, 9))}
              className="tabular min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none focus-visible:outline-none"
            />
          </span>
          {statusCell("salary")}
        </Row>
        <Row label="Payday" htmlFor="f-pay">
          <select
            id="f-pay"
            value={form.payday}
            onChange={(e) => set("payday", e.target.value)}
            className={`${SELECT} flex-[1_1_220px]`}
          >
            {PAYDAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {statusCell("payday")}
        </Row>
        <div>
          <Row label="Save first" htmlFor="f-pct" help={<span className="tabular">{money(save1)} a month</span>}>
            <span className={`${INPUT} flex flex-[1_1_220px] items-center gap-1.5 pr-1.5 focus-within:border-lime`}>
              <input
                id="f-pct"
                inputMode="numeric"
                autoComplete="off"
                value={form.save_pct}
                onChange={(e) => set("save_pct", e.target.value.replace(/\D/g, "").slice(0, 2))}
                className="tabular w-10 min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none focus-visible:outline-none"
              />
              <span className="text-muted">% of salary</span>
              {(
                [
                  [-1, "Lower save first", Minus],
                  [1, "Raise save first", Plus],
                ] as const
              ).map(([step, label, Icon]) => (
                <button
                  key={step}
                  type="button"
                  aria-label={label}
                  onClick={() =>
                    set("save_pct", String(Math.min(MAX_PCT, Math.max(MIN_PCT, (+form.save_pct || 0) + step))))
                  }
                  className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-full border border-line-2 bg-transparent text-ink-2 hover:border-ink-2 hover:text-ink"
                >
                  <Icon size={14} />
                </button>
              ))}
            </span>
            {statusCell("save_pct")}
          </Row>
          {edited.length > 0 && (
            <div className="px-6 pb-5 max-[480px]:px-[18px]">
              <div
                role="region"
                aria-label="Apply plan changes"
                className="flex flex-col gap-3 rounded-[14px] bg-lime-soft px-[18px] py-4"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold">Apply from when?</span>
                  {edited.map((k) => (
                    <span key={k} className="tabular text-[13px] text-ink-2">
                      {LABEL[k]}: {value(k, k === "salary" ? toMinor(+base.salary) : +base[k], null)} →{" "}
                      <strong className="text-ink">{value(k, k === "salary" ? toMinor(sal) : +form[k], null)}</strong>
                    </span>
                  ))}
                </div>
                {effects.length > 0 && (
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-2">
                    {effects.map((e) => (
                      <div key={e.label} className="flex flex-col gap-0.5 rounded-xl bg-tile px-3 py-2.5">
                        <span className="text-xs text-muted">{e.label}</span>
                        <span className="tabular text-[15px] text-ink-2">
                          {e.from} → <strong style={{ color: e.color }}>{e.to}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {paydayPreview && (
                  <span className="text-[13px] text-pretty text-ink-2">
                    This cycle: {shortDate(paydayPreview.now.startStr)} – {shortDate(paydayPreview.now.endStr)}. Next
                    cycle: {shortDate(paydayPreview.next.startStr)} – {shortDate(paydayPreview.next.endStr)}. Nothing
                    you’ve logged moves.
                  </span>
                )}
                {error && (
                  <span role="alert" className="text-[13px] font-semibold text-danger">
                    {error}
                  </span>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => apply("next")}
                    className="h-[38px] cursor-pointer rounded-full border-0 bg-lime px-4 text-[13px] font-bold text-lime-ink disabled:opacity-60"
                  >
                    Next cycle · from {shortDate(nextFrom)}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => apply("now")}
                    className="h-[38px] cursor-pointer rounded-full border border-line-2 bg-transparent px-4 text-[13px] font-semibold text-ink disabled:opacity-60"
                  >
                    This cycle · recalculate now
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setForm(base);
                      setError(null);
                    }}
                    className="h-[38px] cursor-pointer border-0 bg-transparent px-2.5 text-[13px] font-semibold text-muted hover:text-ink"
                  >
                    Undo changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
      <span className="text-[13px] text-muted">
        Name and preferences save on their own. Plan changes wait until you choose when they apply.
      </span>

      <div id="plan-hist" tabIndex={-1} className="flex flex-col gap-2.5 pt-1.5 outline-none">
        <h3 className="eyebrow m-0">Plan history</h3>
        <Card>
          {shown.map((h) => (
            <div key={h.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3.5 max-[480px]:px-[18px]">
              <span className="tabular flex-[0_0_110px] text-[13px] text-muted">{longDate(h.date)}</span>
              <span className="tabular flex-[1_1_220px] text-sm">
                {h.field === "created" ? (
                  "Plan created during onboarding"
                ) : (
                  <>
                    {LABEL[h.field]} <span className="text-muted">{value(h.field, h.from, h.fromText)} →</span>{" "}
                    <strong>{value(h.field, h.to, h.toText)}</strong>
                  </>
                )}
              </span>
              <span className="rounded-full bg-tile-2 px-[9px] py-[3px] text-xs font-semibold text-ink-2">
                {h.applies === "start"
                  ? "Start"
                  : h.superseded
                    ? "Replaced"
                    : h.applies === "next"
                      ? "From next cycle"
                      : "Applied at once"}
              </span>
            </div>
          ))}
          {history.length === 0 && <span className="px-6 py-3.5 text-sm text-muted">No changes yet.</span>}
        </Card>
        {history.length > 4 && (
          <button type="button" onClick={() => setAllHistory(!allHistory)} className={`${BTN_LINK} self-start`}>
            {allHistory ? "Show fewer" : `Show all ${history.length}`}
          </button>
        )}
      </div>
    </>
  );
}
