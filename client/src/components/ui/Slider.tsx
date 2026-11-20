"use client";

import { useState } from "react";

/**
 * Slider (design handoff v2): 6px track with a fill up to the thumb, an optional tick (e.g. the
 * user's own pace) and an 18px thumb. A native range input sits on top at opacity 0, so
 * keyboard, touch and screen readers work as usual. Hit area 36px tall.
 */
export default function Slider({
  id,
  min,
  max,
  step,
  value,
  onChange,
  valueText,
  mark,
  danger = false,
}: {
  id?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** Screen-reader value, e.g. "₹1,200 a day". */
  valueText?: string;
  /** Tick on the track at this value. */
  mark?: number;
  /** Fill turns --danger (e.g. the projection runs short). */
  danger?: boolean;
}) {
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const pct = (v: number) => `${max > min ? Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)) : 0}%`;
  const fill = danger ? "var(--danger)" : "var(--lime)";

  return (
    <div className="relative my-0.5 h-9">
      <span className="absolute inset-x-0 top-[15px] h-1.5 rounded-full bg-track" />
      <span
        className="absolute top-[15px] left-0 h-1.5 rounded-full transition-[background] duration-250"
        style={{ width: pct(value), background: fill }}
      />
      {mark !== undefined && (
        <span
          aria-hidden
          className="absolute top-2.5 -ml-px h-4 w-0.5 rounded-[2px] bg-ink-2 opacity-70"
          style={{ left: pct(mark) }}
        />
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute top-[9px] -ml-[9px] box-border h-[18px] w-[18px] rounded-full border-4 bg-ink transition-[box-shadow,transform,border-color] duration-150 motion-reduce:transition-none"
        style={{
          left: pct(value),
          borderColor: fill,
          boxShadow: focus || drag ? `0 0 0 3px var(--bg), 0 0 0 5px ${fill}` : "0 2px 8px rgba(0,0,0,.35)",
          transform: `scale(${drag ? 1.12 : 1})`,
        }}
      />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(+e.target.value)}
        onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setFocus(false)}
        onPointerDown={() => setDrag(true)}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        aria-valuetext={valueText}
        className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
