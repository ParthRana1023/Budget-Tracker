"use client";

// Settings › Preferences (design handoff v2): theme, currency (INR only for now), number
// format and week start. Each saves on its own.

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { NUMBER_LOCALES } from "@/lib/money.mjs";
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
        <Row label="Currency">
          <div id="f-cur" tabIndex={-1} className="flex flex-[0_1_260px] flex-col gap-0.5 outline-none">
            <span className="flex h-11 items-center rounded-xl border border-line bg-tile-2 px-3 text-[15px]">
              ₹ Indian rupee
            </span>
            <span className="text-xs text-muted">More currencies are coming later.</span>
          </div>
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
                  {n < 0 ? "−" : ""}₹
                  {Math.abs(n).toLocaleString(loc, { minimumFractionDigits: dp, maximumFractionDigits: dp })}
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
