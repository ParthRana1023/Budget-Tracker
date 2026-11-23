"use client";

// Phone navigation (design handoff v3, Mobile): Home · Reports · [Add] · Ledger · More,
// under 720px only. On the Dashboard the tabs switch in place (onGo / onAdd); elsewhere
// (Settings, Account) they are links back to it.

import Link from "next/link";
import { ChartColumn, Ellipsis, House, List, Plus, type LucideIcon } from "lucide-react";

export type NavTab = "home" | "reports" | "ledger" | "more";

const HREF: Record<NavTab, string> = {
  home: "/dashboard",
  reports: "/dashboard?view=reports",
  ledger: "/ledger",
  more: "/more",
};
const TABS: Array<[NavTab, string, LucideIcon]> = [
  ["home", "Home", House],
  ["reports", "Reports", ChartColumn],
  ["ledger", "Ledger", List],
  ["more", "More", Ellipsis],
];
const TAB =
  "flex h-16 min-w-0 cursor-pointer flex-col items-center justify-center gap-[3px] border-0 bg-transparent p-0 text-[11px] font-semibold transition-colors duration-200 [-webkit-tap-highlight-color:transparent]";

export default function BottomNav({
  current,
  onGo,
  onAdd,
  addDisabled = false,
}: {
  current: NavTab | null;
  onGo?: (tab: NavTab) => void;
  onAdd?: () => void;
  /** Offline: Add stays tappable (aria-disabled) so onAdd can explain why it can't add. */
  addDisabled?: boolean;
}) {
  const tab = ([key, label, Icon]: (typeof TABS)[number]) => {
    const on = current === key;
    const body = (
      <>
        <span
          className="flex h-[30px] w-[52px] items-center justify-center rounded-full transition-colors duration-200"
          style={{ background: on ? "var(--lime-soft)" : "transparent", color: on ? "var(--lime-text)" : undefined }}
        >
          <Icon size={20} aria-hidden />
        </span>
        {label}
      </>
    );
    const props = {
      "aria-current": on ? ("page" as const) : undefined,
      className: TAB,
      style: { color: on ? "var(--ink)" : "var(--muted)" },
    };
    return onGo ? (
      <button key={key} type="button" onClick={() => onGo(key)} {...props}>
        {body}
      </button>
    ) : (
      <Link key={key} href={HREF[key]} {...props}>
        {body}
      </Link>
    );
  };
  const addClass =
    "-mt-4 flex h-[58px] w-[58px] cursor-pointer items-center justify-center rounded-full border-4 border-bg bg-lime p-0 text-lime-ink shadow-[0_8px_24px_-10px_var(--lime)] transition-transform duration-150 active:scale-[.93]";

  return (
    <>
      <div aria-hidden className="h-[calc(64px+env(safe-area-inset-bottom))] flex-none min-[720px]:hidden" />
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(64px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-bg px-1 pb-[env(safe-area-inset-bottom)] min-[720px]:hidden"
      >
        {TABS.slice(0, 2).map(tab)}
        <div className="flex flex-col items-center">
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              aria-label={addDisabled ? "Add an entry, needs a connection" : "Add an entry"}
              aria-disabled={addDisabled || undefined}
              className={`${addClass} aria-disabled:bg-tile-2 aria-disabled:text-muted aria-disabled:shadow-none`}
            >
              <Plus size={24} aria-hidden />
            </button>
          ) : (
            <Link href="/dashboard?add=expense" aria-label="Add an entry" className={addClass}>
              <Plus size={24} aria-hidden />
            </Link>
          )}
          <span aria-hidden className="mt-px text-[11px] font-semibold text-muted">
            Add
          </span>
        </div>
        {TABS.slice(2).map(tab)}
      </nav>
    </>
  );
}
