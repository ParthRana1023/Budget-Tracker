"use client";

import { useEffect, useState } from "react";
import { StatusShell } from "@/components/StatusPage";

const STEPS = [
  "Confirming your salary",
  "Setting aside savings",
  "Reserving fixed bills",
  "Working out today’s number",
];
// Decorative split of the pay-yourself-first bar: savings, fixed bills, spent, safe.
const SEGS: Array<[string, string]> = [
  ["31.6%", "var(--lime)"],
  ["37.2%", "var(--fixed)"],
  ["13.6%", "var(--flex)"],
  ["17.6%", "var(--ink)"],
];

/** Shown while the dashboard's data loads (design handoff, Status Pages → Loading). */
export default function DashboardLoading() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const slow = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = setInterval(() => setTick((s) => (s + 1) % 6), slow ? 2000 : 700);
    return () => clearInterval(t);
  }, []);
  const step = Math.min(tick, 4);

  return (
    <StatusShell>
      <div role="status" aria-live="polite" className="flex w-full max-w-[520px] flex-col gap-[22px]">
        <span className="eyebrow">Loading your cycle</span>
        <h1 className="m-0 font-serif text-[clamp(44px,9vw,72px)] leading-[.95] font-normal tracking-[-0.02em] text-balance">
          {step >= 4 ? "Almost there." : "Paying yourself first…"}
        </h1>
        <div aria-hidden className="flex h-3.5 gap-[3px]">
          {SEGS.map(([w, c], i) => (
            <span
              key={c}
              className="rounded-md transition-[width] duration-700 ease-soft"
              style={{ width: step > i ? w : "0%", background: c }}
            />
          ))}
        </div>
        <ol className="m-0 flex list-none flex-col border-t border-line-2 p-0">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className="flex items-center gap-3 border-b border-line py-3 transition-colors duration-300"
              style={{ color: step > i ? "var(--ink)" : step === i ? "var(--ink-2)" : "var(--muted)" }}
            >
              <span
                aria-hidden
                className="h-2 w-2 flex-none rounded-full transition-colors duration-300"
                style={{ background: step > i ? "var(--lime)" : step === i ? "var(--ink-2)" : "var(--track)" }}
              />
              <span className="flex-1 font-medium">{label}</span>
              <span className="font-serif text-[17px] text-muted italic">
                {step > i ? "done" : step === i ? "working" : ""}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </StatusShell>
  );
}
