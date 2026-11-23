"use client";

// Install SaveFirst card on Home (design handoff v3, PWA). Chrome/Edge: Install app opens the
// browser's sheet. iPhone: Share › Add to Home Screen steps. Dismiss hides it for 30 days.

import { useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { dismissInstall, promptInstall, useInstall } from "@/lib/install";
import { useToast } from "../ui/Toast";

/** The app icon: the mark on the dark tile, as on the home screen. */
export function AppIcon({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="block flex-none">
      <rect width="512" height="512" rx="116" fill="#0b0b0c" />
      <g transform="translate(92 92) scale(5.125)">
        <rect x="14" y="6" width="36" height="10" rx="5" fill="#c6f432" />
        <rect x="6" y="21" width="52" height="15" rx="7.5" fill="#f2f2ee" />
        <rect x="6" y="41" width="52" height="15" rx="7.5" fill="#f2f2ee" opacity=".45" />
      </g>
    </svg>
  );
}

const STEP = "flex items-center gap-2.5";
const NUM = "flex h-6 w-6 flex-none items-center justify-center rounded-full bg-tile-2 text-xs font-bold";
const KEY = "inline-flex items-center gap-1 rounded-lg border border-line-2 px-2 py-0.5 font-semibold";

export default function InstallCard() {
  const { kind, cardDue } = useInstall();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!kind || !cardDue) return null;

  const dismiss = () => {
    dismissInstall();
    const where = window.matchMedia("(min-width: 720px)").matches ? "the account menu" : "More";
    toast(`Hidden for 30 days. You can install any time from ${where}.`, { tone: "info" });
  };
  const install = async () => {
    setBusy(true);
    const accepted = await promptInstall().catch(() => false);
    setBusy(false);
    if (accepted) toast("SaveFirst is installed. Open it from your home screen.", { tone: "done" });
  };

  return (
    <section
      aria-labelledby="inst-h"
      className="flex flex-col gap-3 rounded-[18px] border border-line bg-tile py-4 pr-2 pl-4"
    >
      <div className="flex items-start gap-3.5">
        <AppIcon />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <span id="inst-h" className="text-[15px] font-bold">
            Install SaveFirst
          </span>
          <span className="text-[13px] text-pretty text-ink-2">
            {kind === "ios"
              ? "Log faster from your Home Screen. On iPhone, bill reminders only work once it’s added there."
              : "Open it from your home screen, full screen, with bill reminders."}
          </span>
          {kind === "ios" && (
            <>
              <ol className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0 text-sm">
                <li className={STEP}>
                  <span className={NUM}>1</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    Tap
                    <span className={KEY}>
                      <Share size={14} aria-hidden />
                      Share
                    </span>
                    in Safari
                  </span>
                </li>
                <li className={STEP}>
                  <span className={NUM}>2</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    Choose
                    <span className={KEY}>
                      <SquarePlus size={14} aria-hidden />
                      Add to Home Screen
                    </span>
                  </span>
                </li>
              </ol>
              <div className="pt-2.5">
                <button
                  type="button"
                  onClick={() => {
                    dismissInstall();
                    toast("Once it’s on your Home Screen, open SaveFirst from there.", { tone: "done" });
                  }}
                  className="h-11 cursor-pointer rounded-full border border-line-2 bg-transparent px-[18px] text-sm font-semibold hover:border-ink-2"
                >
                  Got it
                </button>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install suggestion"
          className="-mt-1.5 flex h-11 w-11 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>
      {kind === "prompt" && (
        <div className="-mt-1 flex items-center gap-2 pr-2 pl-[62px]">
          <button
            type="button"
            onClick={install}
            disabled={busy}
            className="flex h-10 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-lime px-3.5 text-[13px] font-bold whitespace-nowrap text-lime-ink active:scale-[.97] disabled:cursor-default"
          >
            <Download size={14} aria-hidden className="flex-none" />
            <span className="truncate">{busy ? "Waiting…" : "Install app"}</span>
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="h-10 flex-none cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold whitespace-nowrap text-ink-2 hover:border-ink-2 hover:text-ink"
          >
            Not now
          </button>
        </div>
      )}
    </section>
  );
}
