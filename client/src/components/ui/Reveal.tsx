"use client";

import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { clsx } from "clsx";

type RevealProps = HTMLAttributes<HTMLDivElement> & {
  /** Reveal right after mount (above-the-fold content) instead of on scroll. */
  immediate?: boolean;
};

/**
 * Fades and lifts its content in when it scrolls into view (design handoff: cards rise
 * in once). Inside it, `.rv-bar` (width) and `.rv-barh` (height) fill from empty at the
 * same moment. See the .rv rules in globals.css.
 */
export default function Reveal({ immediate = false, className, ...rest }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (immediate || !el || !("IntersectionObserver" in window)) {
      const t = setTimeout(() => setOn(true), 60);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [immediate]);

  return <div ref={ref} className={clsx("rv", on && "rv-on", className)} {...rest} />;
}
