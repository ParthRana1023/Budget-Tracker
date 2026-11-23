"use client";

// Offline (design handoff v3, PWA): a banner, and a shell with dashes in place of every amount,
// so nobody acts on old numbers. Navigation keeps working; adding and editing need a connection.

import { WifiOff } from "lucide-react";
import { currencySymbol } from "@/lib/money.mjs";

export function OfflineBanner({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-[14px] border border-line bg-warn-soft py-3 pr-3 pl-4"
    >
      <WifiOff size={18} aria-hidden className="flex-none text-warn" />
      <span className="flex min-w-0 flex-[1_1_220px] flex-col">
        <span className="text-sm font-bold text-warn">You’re offline</span>
        <span className="text-[13px] text-pretty text-ink-2">
          Amounts are hidden until you reconnect. Adding and editing need a connection.
        </span>
      </span>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="h-10 cursor-pointer rounded-full border border-line-2 bg-tile px-4 text-[13px] font-semibold hover:border-ink-2"
      >
        {retrying ? "Checking…" : "Try again"}
      </button>
    </div>
  );
}

const TILES = ["Until payday", "On hold", "Annual bills reserve"];

/** "Last synced today, 9:12 am" / "Last synced 23 Nov, 9:12 am". */
export function syncedLabel(at: Date, now = new Date()) {
  const time = at.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  const day =
    at.toDateString() === now.toDateString()
      ? "today"
      : at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `Last synced ${day}, ${time}`;
}

export function OfflineShell({
  eyebrow,
  syncedAt,
  tiles,
}: {
  eyebrow: string;
  syncedAt: Date | null;
  /** Home also shows dashes for its smaller cards. */
  tiles: boolean;
}) {
  return (
    <>
      <section
        aria-label="Numbers hidden while offline"
        className="flex flex-col gap-[18px] rounded-[18px] border border-line bg-tile p-[clamp(20px,4vw,32px)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="eyebrow">{eyebrow}</span>
          {syncedAt && <span className="text-xs text-muted">{syncedLabel(syncedAt)}</span>}
        </div>
        <span
          aria-hidden
          className="font-serif text-[clamp(58px,17vw,128px)] leading-[.86] tracking-[-0.025em] text-line-2"
        >
          {currencySymbol()} ——
        </span>
        <p className="m-0 max-w-[540px] font-serif text-[clamp(19px,2.2vw,23px)] leading-[1.3] text-pretty text-ink-2 italic">
          Your numbers load when you’re back online, so you never act on old ones. Nothing you logged has been lost.
        </p>
        <span aria-hidden className="h-3.5 rounded-md bg-track" />
      </section>
      {tiles && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3.5">
          {TILES.map((t) => (
            <div key={t} className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-tile px-[22px] py-5">
              <span className="eyebrow">{t}</span>
              <span aria-hidden className="font-serif text-4xl leading-none text-line-2">
                ——
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
