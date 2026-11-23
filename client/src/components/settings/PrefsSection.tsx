"use client";

// Settings › Preferences (design handoff v2): theme, base currency (until the first entry),
// number format and week start. Each saves on its own.

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { CURRENCIES, currencySymbol, minorDigits, NUMBER_LOCALES } from "@/lib/money.mjs";
import { savePreferences } from "@/lib/settings.mjs";
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
  onSaved,
}: {
  settings: Settings;
  /** Keeps the page's copy in step (number format shows straight away). */
  onSaved: (patch: Partial<Settings>) => void;
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

  // Base currency: changeable until the first entry (set_base_currency checks too).
  const currencySave = useSave();
  const currency = settings.currency ?? "INR";
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  const [locked, setLocked] = useState<boolean | null>(null);
  useEffect(() => {
    db.from("transactions")
      .select("id", { count: "exact", head: true })
      .then(({ count, error }) => setLocked(error ? true : (count ?? 0) > 0));
  }, []);

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
          htmlFor="f-cur"
          help={
            locked
              ? "Locked after your first entry. Log foreign spending in its own currency instead."
              : "Every amount is kept in this currency. You can change it until your first entry."
          }
        >
          <SaveState status={currencySave.status} />
          <select
            id="f-cur"
            value={currency}
            disabled={locked !== false}
            onChange={(e) => {
              const v = e.target.value;
              void currencySave.run(async () => {
                const r = await db.rpc("set_base_currency", { p_currency: v });
                // Stored amounts were rescaled on the server; load them fresh.
                if (!r.error) window.location.reload();
                return r;
              });
            }}
            className={`${SELECT} h-11 flex-[0_1_260px] text-[15px] disabled:opacity-60`}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {currencySymbol(c)} {c} · {names.of(c)}
              </option>
            ))}
          </select>
        </Row>
        <div className="flex flex-col gap-3 px-6 py-5 max-[480px]:px-[18px]">
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
