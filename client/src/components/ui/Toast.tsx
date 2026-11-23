"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Check, CircleAlert, Info, WifiOff, X } from "lucide-react";

type ToastOptions = {
  /** Shows an Undo button. A rejected promise turns the toast into "Couldn't undo". */
  undo?: () => void | Promise<void>;
  error?: boolean;
  /** Another button, e.g. "Refresh" when a new version is ready. Clicking it hides the toast. */
  action?: { label: string; onClick: () => void };
  /** Stays until dismissed or replaced instead of hiding after 6s. */
  sticky?: boolean;
  /** Status toast (design handoff v3, PWA): icon chip in this tone, an ×, hides after 5s. */
  tone?: "done" | "offline" | "info";
};
type ToastState = ToastOptions & { msg: string; id: number };
type ShowToast = (msg: string, options?: ToastOptions) => void;

const HIDE_MS = 6000;
const STATUS_HIDE_MS = 5000;
const TONES = {
  done: { bg: "var(--lime)", fg: "var(--lime-ink)", Icon: Check },
  offline: { bg: "var(--warn)", fg: "var(--bg)", Icon: WifiOff },
  info: { bg: "var(--line-2)", fg: "var(--ink)", Icon: Info },
};
const ToastContext = createContext<ShowToast>(() => {});

/** Bottom toast that auto-hides after 6s, with optional Undo (handoff "Toast"). */
export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [shown, setShown] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextId = useRef(0);

  const hide = useCallback(() => {
    setShown(false);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setToast(null), 300);
  }, []);

  const show = useCallback<ShowToast>(
    (msg, options) => {
      clearTimeout(hideTimer.current);
      setShown(false);
      setToast({ msg, ...options, id: ++nextId.current });
      if (!options?.sticky) hideTimer.current = setTimeout(hide, options?.tone ? STATUS_HIDE_MS : HIDE_MS);
    },
    [hide],
  );

  // Two frames so the enter transition starts from the hidden position.
  useEffect(() => {
    if (!toast) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => setShown(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [toast?.id]);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const undo = async () => {
    if (!toast?.undo) return;
    try {
      await toast.undo();
      hide();
    } catch {
      show("Couldn’t undo. Check your connection and try again.", { error: true });
    }
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          role="status"
          className={clsx(
            "fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-1/2 z-70 flex w-[min(calc(100vw-32px),460px)] items-center gap-3 rounded-2xl border border-line-2 bg-tile-2 py-2.5 pr-2.5 pl-3.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)] transition-[opacity,transform] duration-300 ease-sheet min-[720px]:bottom-[calc(20px+env(safe-area-inset-bottom))]",
            shown ? "-translate-x-1/2 translate-y-0 opacity-100" : "-translate-x-1/2 translate-y-4 opacity-0",
          )}
        >
          {toast.tone ? (
            <ToneChip tone={toast.tone} />
          ) : (
            <span
              aria-hidden
              className={clsx(
                "flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full text-lime-ink",
                toast.error ? "bg-danger" : "bg-lime",
              )}
            >
              {toast.error ? <CircleAlert size={13} /> : <Check size={13} />}
            </span>
          )}
          <span className="min-w-0 flex-1 text-sm font-medium text-pretty">{toast.msg}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={undo}
              className="h-[34px] flex-none cursor-pointer rounded-full border border-line-2 bg-transparent px-3.5 text-[13px] font-semibold transition-colors hover:border-ink-2"
            >
              Undo
            </button>
          )}
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                hide();
              }}
              className="h-[34px] flex-none cursor-pointer rounded-full border-0 bg-lime px-3.5 text-[13px] font-bold text-lime-ink active:scale-[.97]"
            >
              {toast.action.label}
            </button>
          )}
          {(toast.sticky || toast.tone) && (
            <button
              type="button"
              onClick={hide}
              aria-label="Dismiss"
              className="flex h-10 w-10 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:text-ink"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

function ToneChip({ tone }: { tone: keyof typeof TONES }) {
  const { bg, fg, Icon } = TONES[tone];
  return (
    <span
      aria-hidden
      className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full"
      style={{ background: bg, color: fg }}
    >
      <Icon size={13} />
    </span>
  );
}
