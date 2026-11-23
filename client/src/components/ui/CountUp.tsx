"use client";

import { useEffect, useRef, useState } from "react";
import { inr, toMinor } from "@/lib/money.mjs";

/**
 * A money amount (whole units of the base currency) that counts up from 0 on first show, then glides from its old value
 * to the new one when it changes (design handoff: hero count-up, ease-out cubic).
 * Shows the final value straight away under prefers-reduced-motion.
 */
export default function CountUp({ rupees, duration = 1500 }: { rupees: number; duration?: number }) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);

  useEffect(() => {
    const set = (v: number) => {
      shownRef.current = v;
      setShown(v);
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return set(rupees);
    const from = shownRef.current;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      set(from + (rupees - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rupees, duration]);

  return <>{inr(toMinor(shown))}</>;
}
