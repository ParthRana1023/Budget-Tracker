"use client";

import { useEffect, useState } from "react";

const inr = (rupees: number) => `${rupees < 0 ? "−" : ""}₹${Math.round(Math.abs(rupees)).toLocaleString("en-IN")}`;

/**
 * A rupee amount that counts up from 0 with an ease-out cubic (design handoff: hero
 * count-up). Shows the final value straight away under prefers-reduced-motion.
 */
export default function CountUp({ rupees, duration = 1500 }: { rupees: number; duration?: number }) {
  const [k, setK] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setK(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setK(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    setK(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rupees, duration]);

  return <>{inr(rupees * k)}</>;
}
