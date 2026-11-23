"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, WifiOff, X } from "lucide-react";
import { startInstallWatch } from "@/lib/install";
import { useOnline } from "./ui/useOnline";

// Registers the service worker (public/sw.js) and offers "New version ready" when a deploy
// lands (design handoff v3, PWA); starts watching for the browser's install prompt; shows a
// bar while offline on pages that don't have their own offline banner.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
/** These pages show their own offline banner and hide every amount. */
const OWN_OFFLINE = ["/dashboard", "/ledger", "/more", "/bills", "/budgets", "/goals"];

/** True while a Dialog or sheet is open, so the update toast never interrupts an entry. */
function useModalOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('[role="dialog"][aria-modal="true"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true });
    return () => mo.disconnect();
  }, []);
  return open;
}

let reloadOnSwap = false;

export default function PwaRegister() {
  const pathname = usePathname();
  const online = useOnline();
  const modalOpen = useModalOpen();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    startInstallWatch();
    if (!("serviceWorker" in navigator)) return;
    // Only after "Refresh": the first install also changes controller (clients.claim).
    const onSwap = () => reloadOnSwap && window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onSwap);

    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD)}`)
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setWaiting(worker);
          });
        });
      })
      .catch((err) => console.debug("ServiceWorker registration failed:", err));
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onSwap);
  }, []);

  const refresh = () => {
    if (!waiting) return;
    setUpdating(true);
    reloadOnSwap = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <>
      {waiting && !modalOpen && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-1/2 z-72 flex w-[min(calc(100vw-24px),460px)] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink py-2 pr-1.5 pl-4 text-bg shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)] min-[720px]:bottom-[calc(20px+env(safe-area-inset-bottom))]"
        >
          <Sparkles size={18} aria-hidden className="flex-none" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-bold">New version ready</span>
            <span className="text-xs opacity-75">Refresh to update. Takes a second.</span>
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={updating}
            className="h-10 flex-none cursor-pointer rounded-full border-0 bg-lime px-4 text-sm font-bold text-lime-ink active:scale-[.97]"
          >
            {updating ? "Updating…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => setWaiting(null)}
            aria-label="Update later"
            className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-inherit opacity-70"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {!online && !OWN_OFFLINE.some((p) => pathname?.startsWith(p)) && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-80 flex items-center justify-center gap-2 bg-warn px-4 pt-[calc(6px+env(safe-area-inset-top))] pb-1.5 text-[13px] font-semibold text-bg"
        >
          <WifiOff size={14} aria-hidden />
          You’re offline. Changes need a connection to save.
        </div>
      )}
    </>
  );
}
