"use client";

import { useEffect, useState } from "react";

/** Taller than any browser toolbar change, so only an on-screen keyboard counts as "open". */
const KEYBOARD_MIN = 120;

/**
 * How much of the layout viewport the on-screen keyboard covers, from visualViewport
 * (0 on desktop or with no keyboard). Bottom sheets lift by this much so the footer stays
 * above the keyboard.
 */
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      setInset(covered > KEYBOARD_MIN ? covered : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}
