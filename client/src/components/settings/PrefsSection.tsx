"use client";

// Settings › Preferences (design handoff v2): theme, base currency (until the first entry),
// number format and week start. Each saves on its own.

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { ChevronDown } from "lucide-react";
import { currencySymbol, minorDigits, NUMBER_LOCALES } from "@/lib/money.mjs";
import { nextCycleStart, savePreferences } from "@/lib/settings.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import type { PayDayEntry } from "@/lib/periods.mjs";
import { CurrencyList, currencyName } from "../dashboard/popups/currency";
import { syncSavedTheme, THEME_EVENT, THEME_KEY, type Theme } from "@/lib/theme";
import type { Settings } from "../dashboard/types";
import { Card, Row, SaveState, SELECT, SectionHead, useSave } from "./parts";

type Format = NonNullable<Settings["number_format"]>;
const SAMPLES: [string, number, number][] = [
  ["Salary", 123456.78, 2],
  ["Spent today", 2500, 0],
  ["Over a limit", -840, 0],
];

export default function PrefsSection({
  settings,
  schedule,
  today,
  onSaved,
  onBaseChanged,
}: {
  settings: Settings;
  schedule: PayDayEntry[];
  today: string;
  /** Keeps the page's copy in step (number format shows straight away). */
  onSaved: (patch: Partial<Settings>) => void;
  /** A base switch was scheduled or cancelled: reload settings (and plan history). */
  onBaseChanged: () => Promise<unknown>;
}) {
  const db = createClient();
  const theme = useSave(),
    number = useSave(),
    week = useSave();
  const [themePref, setThemePref] = useState<Theme>(settings.theme ?? "dark");
  // This device's choice when the account has none yet; the header's theme button changes it too.
  useEffect(() => {
    const read = () => {
      try {
        const t = window.localStorage.getItem(THEME_KEY);
        if (t === "dark" || t === "light" || t === "system") setThemePref(t);
      } catch {}
    };
    if (!settings.theme) read();
    window.addEventListener(THEME_EVENT, read);
    return () => window.removeEventListener(THEME_EVENT, read);
  }, []);

  // Base currency (design handoff v3, Currency): no entries yet -> applies now; with entries ->
  // pending until the next cycle starts (set_base_currency checks too). Picking the current base
  // again cancels a pending switch.
  const currencySave = useSave();
  const currency = settings.currency ?? "INR";
  const next = settings.currency_next ?? null;
  const [curOpen, setCurOpen] = useState(false);
  const [hasEntries, setHasEntries] = useState<boolean | null>(null);
  useEffect(() => {
    db.from("transactions")
      .select("id", { count: "exact", head: true })
      .then(({ count, error }) => setHasEntries(error ? true : (count ?? 0) > 0));
  }, []);
  const pickBase = (code: string) => {
    setCurOpen(false);
    if (code === (next ?? currency)) return;
    void currencySave.run(async () => {
      const r = await db.rpc(
        "set_base_currency",
        hasEntries ? { p_currency: code, p_from: nextCycleStart(schedule, today) } : { p_currency: code },
      );
      if (r.error) return r;
      // No entries: stored amounts were rescaled on the server, so load them fresh.
      if (!hasEntries) window.location.reload();
      else await onBaseChanged();
      return r;
    });
  };

  const format: Format = settings.number_format ?? "indian";
  const loc = NUMBER_LOCALES[format];
  const pickTheme = (t: Theme) => {
    setThemePref(t);
    syncSavedTheme(t);
    void theme.run(() => savePreferences(db, { theme: t }));
  };

  return (
    <>
      <SectionHead title="Preferences" lede="How SaveFirst looks and how numbers are written." />
      <Card>
        <Row label="Theme">
          <SaveState status={theme.status} />
          <div role="radiogroup" aria-label="Theme" className="flex gap-0.5 rounded-full border border-line p-[3px]">
            {(
              [
                ["dark", "Dark"],
                ["light", "Light"],
                ["system", "System"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={themePref === v}
                onClick={() => pickTheme(v)}
                className="h-8 cursor-pointer rounded-full border-0 px-3.5 text-[13px] font-semibold transition-colors duration-200"
                style={{
                  background: themePref === v ? "var(--ink)" : "transparent",
                  color: themePref === v ? "var(--bg)" : "var(--muted)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row
          label="Base currency"
          help={
            hasEntries
              ? "A change starts with your next cycle. Past cycles stay in the currency they were tracked in."
              : "Every total, budget and goal is shown in this. No entries yet, so a change applies straight away."
          }
        >
          {!currencySave.status && next && settings.currency_from ? (
            <span className="text-xs font-semibold text-muted">From {shortDate(settings.currency_from)}</span>
          ) : (
            <SaveState status={currencySave.status} />
          )}
          <button
            type="button"
            aria-label={`Base currency: ${currency}`}
            aria-expanded={curOpen}
            disabled={hasEntries === null}
            onClick={() => setCurOpen((o) => !o)}
            className={`${SELECT} flex h-11 flex-[0_1_260px] items-center gap-2 text-left text-[15px] disabled:opacity-60`}
            style={curOpen ? { borderColor: "var(--lime)" } : undefined}
          >
            <span className="font-bold">{currency}</span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{currencyName(currency)}</span>
            <span className="text-muted">{currencySymbol(currency)}</span>
            <ChevronDown size={16} aria-hidden className={curOpen ? "rotate-180" : ""} />
          </button>
        </Row>
        {(curOpen || next) && (
          <div className="-mt-2 flex flex-col gap-3 px-6 pb-5">
            {curOpen && <CurrencyList value={next ?? currency} onPick={pickBase} onClose={() => setCurOpen(false)} />}
            {next && settings.currency_from && (
              <div
                role="status"
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-lime-soft p-4"
              >
                <span className="flex min-w-0 flex-[1_1_220px] flex-col gap-0.5">
                  <span className="text-sm font-bold">
                    Switches to {next} on {shortDate(settings.currency_from)}
                  </span>
                  <span className="text-[13px] text-pretty text-ink-2">
                    When your next cycle starts. This cycle stays in {currency} so its totals don’t change. Your salary,
                    budgets and bills will show in {next} from then; anything set in {currency} is converted at that
                    cycle’s rate.
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => pickBase(currency)}
                  className="h-10 cursor-pointer rounded-full border border-line-2 bg-tile px-3.5 text-[13px] font-semibold hover:border-ink-2"
                >
                  Keep {currency}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-col gap-3 px-6 py-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <label htmlFor="f-num" className="flex-[1_1_200px] text-sm font-semibold">
              Number format
            </label>
            <SaveState status={number.status} />
            <select
              id="f-num"
              value={format}
              onChange={(e) => {
                const v = e.target.value as Format;
                onSaved({ number_format: v });
                void number.run(() => savePreferences(db, { number_format: v }));
              }}
              className={`${SELECT} tabular h-11 flex-[0_1_260px] text-[15px]`}
            >
              <option value="indian">1,00,000.00 (Indian)</option>
              <option value="international">100,000.00</option>
              <option value="european">100.000,00</option>
            </select>
          </div>
          <div aria-live="polite" className="flex flex-wrap gap-2">
            {SAMPLES.map(([label, n, dp]) => (
              <span key={label} className="flex flex-col gap-px rounded-[10px] bg-tile-2 px-3 py-2">
                <span className="text-[11px] text-muted">{label}</span>
                <span className="tabular text-base font-semibold">
                  {n < 0 ? "−" : ""}
                  {currencySymbol(currency)}
                  {Math.abs(n).toLocaleString(loc, {
                    minimumFractionDigits: Math.min(dp, minorDigits(currency)),
                    maximumFractionDigits: Math.min(dp, minorDigits(currency)),
                  })}
                </span>
              </span>
            ))}
          </div>
        </div>
        <Row label="Week starts on" htmlFor="f-wk" help="Used by the Reports weekday chart and calendar.">
          <SaveState status={week.status} />
          <select
            id="f-wk"
            value={settings.week_start ?? 1}
            onChange={(e) => {
              const v = +e.target.value as 0 | 1;
              onSaved({ week_start: v });
              void week.run(() => savePreferences(db, { week_start: v }));
            }}
            className={`${SELECT} h-11 flex-[0_1_260px] text-[15px]`}
          >
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
          </select>
        </Row>
      </Card>
    </>
  );
}
