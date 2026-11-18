"use client";

// Notices card (design handoff): Offline, recurring items Due, and budget warnings.

import { useEffect, useState } from "react";
import Link from "next/link";
import { inr } from "@/lib/money.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import { PILL_LIME, PILL_LINE, type RecurringItem } from "./types";

const HIDDEN_KEY = "sf-notices-hidden";
const ROW = "flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line py-3";
const TAG = "flex-[0_0_108px] text-xs font-bold tracking-[.09em] uppercase";

export type DueRow = { item: RecurringItem; dueDate: string };
export type Warning = { key: string; name: string; level: "80" | "over"; pct: number; spent: number; limit: number };

export default function Notices({
  offline,
  retrying,
  onRetry,
  due,
  warnings,
  daysLeft,
  today,
  onRecord,
  onSkip,
  onDismiss,
}: {
  offline: boolean;
  retrying: boolean;
  onRetry: () => void;
  due: DueRow[];
  warnings: Warning[];
  daysLeft: number;
  today: string;
  onRecord: (item: RecurringItem) => void;
  onSkip: (item: RecurringItem) => void;
  onDismiss: (key: string) => void;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(HIDDEN_KEY) !== "1");
    } catch {}
  }, []);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(HIDDEN_KEY, open ? "1" : "0");
    } catch {}
  };

  const count = (offline ? 1 : 0) + due.length + warnings.length;
  if (!count) return null;
  const summary = [
    offline && "Offline",
    due.length && `${due.length} due`,
    warnings.map((w) => (w.level === "over" ? "over limit" : "note")).join(", "),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label="Notices"
      className="sf-rise flex flex-col rounded-[14px] border border-line bg-tile px-5 py-1.5"
      style={{ animationDelay: ".1s" }}
    >
      <div className="flex items-center gap-2.5 py-2">
        <span className="eyebrow flex-none whitespace-nowrap">Notices · {count}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{open ? "" : summary}</span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="cursor-pointer border-0 bg-transparent py-1 text-[13px] font-semibold text-lime-text hover:text-ink"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <>
          {offline && (
            <div role="status" className={ROW}>
              <span className={`${TAG} text-warn`}>Offline</span>
              <span className="min-w-0 flex-[1_1_240px] font-serif text-xl text-pretty">
                Showing what was saved last. Logging and edits need a connection.
              </span>
              <span className="flex items-center gap-3">
                <Link href="/offline" className="text-[13px] font-semibold text-lime-text hover:text-ink">
                  Details
                </Link>
                <button type="button" onClick={onRetry} disabled={retrying} className={PILL_LINE}>
                  {retrying ? "Checking…" : "Retry"}
                </button>
              </span>
            </div>
          )}
          {due.map(({ item, dueDate }) => (
            <div key={item.id} role="status" className={ROW}>
              <span className={`${TAG} text-warn`}>Due</span>
              <span className="flex min-w-0 flex-[1_1_240px] flex-col">
                <span className="font-serif text-xl leading-[1.2]">{item.name}</span>
                <span className="tabular text-[13px] text-muted">
                  {item.type === "income" ? "+ " : "− "}
                  {inr(item.amount)} · {dueDate === today ? "due today" : `due ${shortDate(dueDate)}`} · not added until
                  you record it
                </span>
              </span>
              <span className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onRecord(item)}
                  aria-label={`Record ${item.name}`}
                  className={PILL_LIME}
                >
                  Record
                </button>
                <button
                  type="button"
                  onClick={() => onSkip(item)}
                  aria-label={`Skip ${item.name} this month`}
                  className={PILL_LINE}
                >
                  Skip this month
                </button>
              </span>
            </div>
          ))}
          {warnings.map((w) => (
            <div key={w.key} className={ROW}>
              <span className={TAG} style={{ color: w.level === "over" ? "var(--danger)" : "var(--warn)" }}>
                {w.level === "over" ? "Over limit" : "Note"}
              </span>
              <span className="min-w-0 flex-[1_1_240px] font-serif text-xl text-pretty">
                {w.level === "over"
                  ? `${w.name} is ${inr(w.spent - w.limit)} over its limit, with ${daysLeft} days to go.`
                  : `${w.name} has reached ${w.pct}% of its limit, with ${inr(w.limit - w.spent)} left for ${daysLeft} days.`}
              </span>
              <button type="button" onClick={() => onDismiss(w.key)} className={PILL_LINE}>
                Dismiss
              </button>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
