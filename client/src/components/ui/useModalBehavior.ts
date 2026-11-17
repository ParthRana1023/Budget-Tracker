"use client";

import { useEffect, useRef, useState } from "react";

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const EXIT_MS = 240;

// Open modals, newest last. Only the top one reacts to Esc / Tab, and the page
// scroll stays locked until the last one closes.
const stack: object[] = [];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Shared behaviour for Dialog and Drawer (handoff "Popups"):
 * enter/exit transition, background scroll lock, focus moved in on open and
 * returned to the opener on close, Tab trapped inside, Esc calls onEscape.
 */
export function useModalBehavior<T extends HTMLElement>(open: boolean, onEscape: () => void) {
  const ref = useRef<T>(null);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const token = {};
    const opener = document.activeElement as HTMLElement | null;
    stack.push(token);
    document.body.style.overflow = "hidden";
    setMounted(true);

    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        setShown(true);
        const el = ref.current;
        if (el && !el.contains(document.activeElement)) {
          // An explicit autofocus wins, then the first field, then anything (e.g. the Close button).
          const target =
            el.querySelector<HTMLElement>("[autofocus]") ??
            el.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),textarea:not([disabled])") ??
            el.querySelector<HTMLElement>(FOCUSABLE);
          target?.focus();
        }
      });
    });

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== token) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onEscapeRef.current();
        return;
      }
      const el = ref.current;
      if (e.key !== "Tab" || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(token), 1);
      if (!stack.length) document.body.style.overflow = "";
      setShown(false);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  // Keep the element rendered while its exit transition plays.
  useEffect(() => {
    if (open || !mounted) return;
    const t = setTimeout(() => setMounted(false), reducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [open, mounted]);

  return { ref, mounted, shown };
}
