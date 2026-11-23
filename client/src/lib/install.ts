"use client";

// Install SaveFirst (design handoff v3, PWA): Chrome/Edge hand us `beforeinstallprompt` for our
// own Install button; iPhone/iPad Safari has none, so the card explains Share › Add to Home
// Screen. The card shows from the second visit, hides for 30 days when dismissed, and never
// again once installed or when already running as the installed app. Per device (localStorage).

import { useEffect, useState } from "react";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
export type InstallKind = "prompt" | "ios";

const VISITS_KEY = "sf-visits";
const DISMISSED_KEY = "sf-install-dismissed";
const INSTALLED_KEY = "sf-installed";
const SESSION_KEY = "sf-visit-counted";
export const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

let deferred: PromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/** Called once from the root layout (PwaRegister), early enough to catch the prompt. */
export function startInstallWatch() {
  if (started) return;
  started = true;
  try {
    if (!sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.setItem(SESSION_KEY, "1");
      write(VISITS_KEY, String(Number(read(VISITS_KEY) ?? 0) + 1));
    }
  } catch {}
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    write(INSTALLED_KEY, "1");
    emit();
  });
}

/** How this browser can install the app, if it can and hasn't. */
function installKind(): InstallKind | null {
  if (isStandalone() || read(INSTALLED_KEY)) return null;
  if (deferred) return "prompt";
  return isIos() ? "ios" : null;
}

export function useInstall() {
  const [, rerender] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    setMounted(true); // picks up a prompt that arrived before mount
    return () => void listeners.delete(l);
  }, []);
  // Server render and first client render agree: nothing to offer yet.
  if (!mounted) return { kind: null, cardDue: false } as const;

  const kind = installKind();
  const dismissedAt = Number(read(DISMISSED_KEY) ?? 0);
  return {
    /** null: nothing to offer (installed, standalone, or the browser can't install). */
    kind,
    /** The Home card: second visit on, not dismissed in the last 30 days. */
    cardDue: !!kind && Number(read(VISITS_KEY) ?? 0) >= 2 && Date.now() - dismissedAt > DISMISS_MS,
  };
}

/** Opens the browser's install sheet; true when the user accepted. */
export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  await e.prompt();
  const { outcome } = await e.userChoice;
  deferred = null;
  if (outcome === "accepted") write(INSTALLED_KEY, "1");
  emit();
  return outcome === "accepted";
}

export function dismissInstall() {
  write(DISMISSED_KEY, String(Date.now()));
  emit();
}

/** More › Install app and the account menu bring the card back. */
export function reopenInstall() {
  write(DISMISSED_KEY, null);
  if (Number(read(VISITS_KEY) ?? 0) < 2) write(VISITS_KEY, "2");
  emit();
}
