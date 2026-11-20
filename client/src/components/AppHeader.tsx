"use client";

// Signed-in header (Dashboard, Reports, Settings, Account): logo, the Dashboard / Reports pill,
// the page's own actions, theme, Settings and Sign out (with a confirm).

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { LogOut, Settings as SettingsIcon } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { savePreferences } from "@/lib/settings.mjs";
import ThemeToggle from "./ThemeToggle";
import Dialog from "./ui/Dialog";
import Logo from "./Logo";

export type Tab = "dashboard" | "reports";

const TAB =
  "flex h-[30px] cursor-pointer items-center rounded-full border-0 px-3.5 text-[13px] font-semibold transition-colors duration-200 hover:text-ink";
const ROUND =
  "flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-ink-2 transition-colors hover:border-ink-2 hover:text-ink";

/**
 * `onTab` switches tabs in place (the Dashboard); without it the tabs are links back to it.
 * `onSettings` marks the Settings button as the current page.
 */
export default function AppHeader({
  current = null,
  onTab,
  onSettings = false,
  children,
}: {
  current?: Tab | null;
  onTab?: (tab: Tab) => void;
  onSettings?: boolean;
  children?: ReactNode;
}) {
  const [signOutOpen, setSignOutOpen] = useState(false);
  const tab = (t: Tab, text: string) => {
    const props = {
      className: TAB,
      "aria-current": current === t ? ("page" as const) : undefined,
      style: {
        background: current === t ? "var(--tile-2)" : "transparent",
        color: current === t ? "var(--ink)" : "var(--muted)",
      },
    };
    return onTab ? (
      <button type="button" onClick={() => onTab(t)} {...props}>
        {text}
      </button>
    ) : (
      <Link href={t === "reports" ? "/dashboard?view=reports" : "/dashboard"} {...props}>
        {text}
      </Link>
    );
  };
  const signOut = async () => {
    await fetch("/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      {/* From 1100px the nav sits dead centre (1fr | auto | 1fr); narrower, the header wraps. */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-0.5 pb-2.5 min-[1100px]:grid min-[1100px]:grid-cols-[1fr_auto_1fr]">
        <Link href="/dashboard" aria-label="SaveFirst, go to Dashboard" className="justify-self-start text-ink">
          <Logo />
        </Link>
        <nav className="flex gap-0.5 justify-self-center rounded-full border border-line p-[3px]">
          {tab("dashboard", "Dashboard")}
          {tab("reports", "Reports")}
        </nav>
        <div className="ml-auto flex items-center gap-2 justify-self-end">
          {children}
          <ThemeToggle onChange={(theme) => void savePreferences(createClient(), { theme })} />
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            aria-current={onSettings ? "page" : undefined}
            className={ROUND}
            style={onSettings ? { borderColor: "var(--lime)", color: "var(--ink)" } : undefined}
          >
            <SettingsIcon size={15} />
          </Link>
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            aria-label="Sign out"
            title="Sign out"
            className={ROUND}
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>
      <Dialog
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        eyebrow="SaveFirst"
        title="Sign out?"
        size="sm"
        submitLabel="Sign out"
        submitTone="ink"
        onSubmit={signOut}
        hint=""
      >
        <p className="m-0 font-serif text-[22px] leading-[1.3] text-pretty text-ink-2">
          You’ll need your email and password, or a sign-in link, to get back in. Everything you’ve logged stays saved.
        </p>
      </Dialog>
    </>
  );
}
