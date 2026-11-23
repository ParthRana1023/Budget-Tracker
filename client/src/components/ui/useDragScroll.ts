"use client";

import { useRef, type MouseEvent, type PointerEvent } from "react";

/**
 * Horizontal chip rows (design handoff v3, Mobile): touch already swipes; this adds a mouse
 * drag. More than 5px starts a drag (cursor grabbing), and a drag never counts as a click.
 * Spread the result on the scrolling element.
 */
export function useDragScroll<T extends HTMLElement>() {
  const start = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const end = (e: PointerEvent<T>) => {
    if (start.current?.moved) dragged.current = true;
    start.current = null;
    e.currentTarget.style.cursor = "";
  };
  return {
    onPointerDown: (e: PointerEvent<T>) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      start.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
      dragged.current = false;
    },
    onPointerMove: (e: PointerEvent<T>) => {
      const s = start.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (!s.moved) {
        if (Math.abs(dx) <= 5) return;
        s.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.style.cursor = "grabbing";
      }
      e.currentTarget.scrollLeft = s.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e: MouseEvent<T>) => {
      if (!dragged.current) return;
      dragged.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
