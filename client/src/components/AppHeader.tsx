"use client";

// Signed-in header (design handoff v2, navbar): logo | centred Dashboard / Reports pill |
// theme, the page's own actions and the account menu. Three flex parts (1 1 0 | none | 1 1 0)
// keep the pill centred; on narrow screens they wrap.

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { LogOut, MailWarning, Settings as SettingsIcon, User } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { savePreferences } from "@/lib/settings.mjs";
import { clearDeviceOnSignOut } from "@/lib/push.mjs";
import ThemeToggle from "./ThemeToggle";
import Dialog from "./ui/Dialog";
import Logo from "./Logo";
import { Avatar } from "./settings/parts";

export type Tab = "dashboard" | "reports";
/** Who is signed in, for the avatar and its menu. */
export type HeaderAccount = { name: string | null; email: string; avatarUrl: string | null; verified: boolean };

const TAB =
  "flex h-full cursor-pointer items-center rounded-full border-0 px-4 text-sm font-semibold transition-colors duration-200 hover:text-ink";
const ITEM =
  "flex h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-3 text-left text-sm font-medium text-ink outline-none hover:bg-tile-2 hover:text-ink focus-visible:bg-tile-2";
const RING = "0 0 0 2px var(--bg), 0 0 0 4px var(--lime)";

/**
 * `onTab` switches tabs in place (the Dashboard); without it the tabs are links back to it.
 * `inAccount` marks the avatar while on Settings or Account.
 */
export default function AppHeader({
  account,
  current = null,
  onTab,
  inAccount = false,
  children,
}: {
  account: HeaderAccount;
  current?: Tab | null;
  onTab?: (tab: Tab) => void;
  inAccount?: boolean;
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
    await clearDeviceOnSignOut(createClient());
    await fetch("/auth/signout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-0.5 pb-2.5 max-[559px]:gap-2">
        <Link
          href="/dashboard"
          aria-label="SaveFirst, go to Dashboard"
          className="flex min-w-max flex-[1_1_0] self-center text-ink hover:text-ink"
        >
          <Logo wordClassName="max-[559px]:hidden" />
        </Link>
        <nav
          aria-label="Main"
          className="box-border flex h-[38px] flex-none gap-0.5 rounded-full border border-line p-[3px]"
        >
          {tab("dashboard", "Dashboard")}
          {tab("reports", "Reports")}
        </nav>
        <div className="flex min-w-max flex-[1_1_0] items-center justify-end gap-2">
          <ThemeToggle onChange={(theme) => void savePreferences(createClient(), { theme })} />
          {children}
          <AccountMenu account={account} inAccount={inAccount} onSignOut={() => setSignOutOpen(true)} />
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

/** Round avatar (photo or initials) opening Account profile, Settings and Sign out. */
function AccountMenu({
  account,
  inAccount,
  onSignOut,
}: {
  account: HeaderAccount;
  inAccount: boolean;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    const list = items(),
      i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      list[e.key === "Home" ? 0 : list.length - 1]?.focus();
    }
  };

  const name = account.name || account.email.split("@")[0];
  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={account.verified ? "Account menu" : "Account menu, email not verified"}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-[38px] w-[38px] cursor-pointer items-center justify-center overflow-hidden rounded-full border border-line-2 bg-lime-soft p-0 text-[13px] font-bold text-lime-text transition-shadow duration-200 hover:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--line-2)]"
        style={open || inAccount ? { boxShadow: RING } : undefined}
      >
        <Avatar url={account.avatarUrl} name={name} size={36} />
      </button>
      {!account.verified && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-warn"
        />
      )}
      {open && (
        <>
          <div aria-hidden onClick={() => close(false)} className="fixed inset-0 z-[55]" />
          <div
            ref={menu}
            role="menu"
            aria-label="Account"
            onKeyDown={onKey}
            className="absolute top-12 right-0 z-[56] flex w-[min(260px,calc(100vw-32px))] flex-col rounded-2xl border border-line-2 bg-tile p-1.5 shadow-[0_8px_24px_rgba(0,0,0,.25)]"
          >
            <div className="mb-1 flex flex-col border-b border-line px-3 pt-3 pb-2.5">
              <span className="text-sm font-semibold">{name}</span>
              <span className="text-[13px] [overflow-wrap:anywhere] text-muted">{account.email}</span>
            </div>
            {!account.verified && (
              <Link
                role="menuitem"
                href="/settings/account"
                onClick={() => close(false)}
                className={`${ITEM} mb-1 bg-warn-soft font-semibold text-warn hover:bg-warn-soft hover:text-warn focus-visible:bg-warn-soft`}
              >
                <MailWarning size={15} className="flex-none" />
                Verify your email
              </Link>
            )}
            <Link role="menuitem" href="/settings/account" onClick={() => close(false)} className={ITEM}>
              <User size={15} className="flex-none" />
              Account profile
            </Link>
            <Link role="menuitem" href="/settings" onClick={() => close(false)} className={ITEM}>
              <SettingsIcon size={15} className="flex-none" />
              Settings
            </Link>
            <span aria-hidden className="mx-1.5 my-1 h-px bg-line" />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close(false);
                onSignOut();
              }}
              className={`${ITEM} text-ink-2`}
            >
              <LogOut size={15} className="flex-none" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
