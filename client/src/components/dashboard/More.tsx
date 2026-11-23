"use client";

// More (design handoff v3, Mobile; phones only): Plan rows (Bills, Budgets, Goals) with a live
// summary, then You (Settings, Account profile, Theme, Sign out).

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ChevronRight,
  Gauge,
  LogOut,
  Settings as SettingsIcon,
  SunMoon,
  Target,
  User,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { savePreferences } from "@/lib/settings.mjs";
import { useThemeToggle } from "../ThemeToggle";
import { SignOutDialog } from "../AppHeader";

export type MoreView = "bills" | "budgets" | "goals";

const ROW_Y =
  "flex min-h-14 w-full cursor-pointer items-center gap-3.5 border-0 border-t border-line bg-transparent pr-3.5 pl-4 text-left text-[15px] font-medium text-ink transition-colors duration-150 first:border-t-0 hover:bg-tile-2 hover:text-ink active:bg-tile-2";
const CARD = "flex flex-col overflow-hidden rounded-[18px] border border-line bg-tile";
const chevron = <ChevronRight size={18} aria-hidden className="flex-none text-muted" />;

export default function More({
  plan,
  verified,
  onGo,
}: {
  /** Summary line under each Plan row. */
  plan: Record<MoreView, string>;
  verified: boolean;
  onGo: (view: MoreView) => void;
}) {
  const { theme, toggleTheme } = useThemeToggle((t) => void savePreferences(createClient(), { theme: t }));
  const [signOut, setSignOut] = useState(false);
  const planRow = (view: MoreView, name: string, icon: ReactNode) => (
    <button
      key={view}
      type="button"
      onClick={() => onGo(view)}
      className="flex min-h-[68px] w-full cursor-pointer items-center gap-3.5 border-0 border-t border-line bg-transparent py-3 pr-3.5 pl-4 text-left text-ink transition-colors duration-150 first:border-t-0 hover:bg-tile-2 active:bg-tile-2"
    >
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-tile-2 text-ink-2">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold">{name}</span>
        <span className="tabular text-[13px] text-muted">{plan[view]}</span>
      </span>
      {chevron}
    </button>
  );

  return (
    <>
      <h1 className="m-0 mt-0.5 mb-1 font-serif text-[40px] leading-none font-normal">More</h1>
      <span className="eyebrow px-1 pt-1.5">Plan</span>
      <section className={CARD}>
        {planRow("bills", "Bills & recurring", <CalendarClock size={18} aria-hidden />)}
        {planRow("budgets", "Budgets", <Gauge size={18} aria-hidden />)}
        {planRow("goals", "Goals", <Target size={18} aria-hidden />)}
      </section>
      <span className="eyebrow px-1 pt-2.5">You</span>
      <section className={CARD}>
        <Link href="/settings" className={ROW_Y}>
          <SettingsIcon size={18} aria-hidden className="flex-none text-ink-2" />
          <span className="flex-1">Settings</span>
          {chevron}
        </Link>
        <Link href="/settings/account" className={ROW_Y}>
          <User size={18} aria-hidden className="flex-none text-ink-2" />
          <span className="flex-1">Account profile</span>
          {!verified && (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">Verify email</span>
          )}
          {chevron}
        </Link>
        <button type="button" onClick={toggleTheme} className={ROW_Y}>
          <SunMoon size={18} aria-hidden className="flex-none text-ink-2" />
          <span className="flex-1">Theme</span>
          <span className="text-sm text-muted">{theme === "dark" ? "Dark" : "Light"}</span>
        </button>
        <button type="button" onClick={() => setSignOut(true)} className={`${ROW_Y} text-ink-2`}>
          <LogOut size={18} aria-hidden className="flex-none" />
          <span className="flex-1">Sign out</span>
        </button>
      </section>
      <SignOutDialog open={signOut} onClose={() => setSignOut(false)} />
    </>
  );
}
