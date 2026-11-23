"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { WifiOff } from "lucide-react";
import { useToast } from "./ui/Toast";

// Registers the service worker (public/sw.js), offers "New version ready" when a deploy lands,
// suggests installing the app on the Dashboard, and shows a bar while offline.
const BUILD = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";
const HINT_KEY = "savefirst-install-hint";
// shortcut: the toast doesn't report a dismissal, so the hint simply waits this long before it shows again.
const HINT_EVERY_MS = 30 * 24 * 60 * 60 * 1000;

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const hintDue = () => {
  try {
    return Date.now() - Number(localStorage.getItem(HINT_KEY) ?? 0) > HINT_EVERY_MS;
  } catch {
    return false;
  }
};
const hintShown = () => {
  try {
    localStorage.setItem(HINT_KEY, String(Date.now()));
  } catch {}
};

export default function PwaRegister() {
  const toast = useToast();
  const pathname = usePathname();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reloadOnSwap = false;
    const offer = (worker: ServiceWorker) =>
      toast("A new version of SaveFirst is ready.", {
        sticky: true,
        action: {
          label: "Refresh",
          onClick: () => {
            reloadOnSwap = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    // Only after "Refresh": the first install also changes controller (clients.claim).
    const onSwap = () => reloadOnSwap && window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", onSwap);

    navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD)}`)
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
          });
        });
      })
      .catch((err) => console.debug("ServiceWorker registration failed:", err));
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onSwap);
  }, [toast]);

  useEffect(() => {
    const onDashboard = () => window.location.pathname.startsWith("/dashboard");
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    // Android / desktop Chrome and Edge: keep the browser's install prompt for our own button.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (!onDashboard() || !hintDue()) return;
      hintShown();
      const prompt = e as InstallPromptEvent;
      toast("Install SaveFirst for one-tap access from your home screen.", {
        sticky: true,
        action: { label: "Install", onClick: () => void prompt.prompt().catch(() => {}) },
      });
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iPhone/iPad Safari has no install prompt; explain the Share menu instead.
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios && onDashboard() && hintDue()) {
      hintShown();
      toast("Install SaveFirst: tap Share, then Add to Home Screen.", { sticky: true });
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [toast]);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // The Dashboard has its own offline notice with Retry (Notices).
  if (!offline || pathname?.startsWith("/dashboard")) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-80 flex items-center justify-center gap-2 bg-warn px-4 pt-[calc(6px+env(safe-area-inset-top))] pb-1.5 text-[13px] font-semibold text-bg"
    >
      <WifiOff size={14} aria-hidden />
      You’re offline. Figures may be out of date, and changes need a connection to save.
    </div>
  );
}
