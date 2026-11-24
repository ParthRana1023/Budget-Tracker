"use client";

// Building blocks for Settings and Account (design handoff v2, Settings.dc.html).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { errorFields, reportClientError } from "@/lib/log.mjs";

export const INPUT =
  "h-[46px] min-w-0 rounded-xl border border-line-2 bg-bg px-3.5 text-base text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";
export const SELECT = `${INPUT} cursor-pointer px-3`;
export const BTN_LINE =
  "flex h-[38px] cursor-pointer items-center rounded-full border border-line-2 bg-transparent px-4 text-[13px] font-semibold text-ink transition-colors duration-200 hover:border-ink-2 disabled:cursor-default disabled:opacity-60";
export const BTN_LINK =
  "cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-lime-text hover:text-ink";
export const SAVE_ERROR = "Couldn’t save. Check your connection and try again.";

/** Hands the browser a file to save. CSV gets a BOM so Excel reads ₹ and accents right. */
export function download(name: string, text: string, type: "text/csv" | "application/json") {
  const url = URL.createObjectURL(
    new Blob([type === "text/csv" ? `﻿${text}` : text], { type: `${type};charset=utf-8` }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** "2 hours ago", "6 days ago" from an ISO time. */
export function ago(iso: string, now = Date.now()) {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 2) return "active now";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Eyebrow + italic serif line above a card. */
export function SectionHead({ title, lede, danger }: { title: string; lede: string; danger?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className={clsx("eyebrow m-0", danger && "text-danger")}>{title}</h2>
      <p className="m-0 font-serif text-[22px] leading-[1.35] text-pretty text-ink-2 italic">{lede}</p>
    </div>
  );
}

/** Section card: rows inside are split by 1px lines. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col divide-y divide-line rounded-[18px] border border-line bg-tile", className)}>
      {children}
    </div>
  );
}

/** A card row: label column (with optional help) and the control. */
export function Row({
  label,
  help,
  htmlFor,
  narrow = false,
  children,
}: {
  label: string;
  help?: ReactNode;
  htmlFor?: string;
  /** Budget plan rows: a fixed 180px label, so the field and its status get the rest. */
  narrow?: boolean;
  children: ReactNode;
}) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-6 py-5">
      <div className={`flex min-w-0 flex-col ${narrow ? "flex-[0_0_180px]" : "flex-[1_1_200px]"}`}>
        <Label {...(htmlFor ? { htmlFor } : {})} className="text-sm font-semibold">
          {label}
        </Label>
        {help && <span className="text-[13px] text-pretty text-muted">{help}</span>}
      </div>
      {children}
    </div>
  );
}

export type SaveStatus = "saving" | "saved" | "error" | null;

/** Inline "Saving…" / "✓ Saved" / error next to a control. */
export function SaveState({ status, idle = "" }: { status: SaveStatus; idle?: string }) {
  return (
    <span
      aria-live="polite"
      className="min-w-[70px] text-xs font-semibold"
      style={{
        color:
          status === "error" ? "var(--danger)" : status === "saving" || !status ? "var(--muted)" : "var(--lime-text)",
      }}
    >
      {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : status === "error" ? SAVE_ERROR : idle}
    </span>
  );
}

/** Runs a save and tracks its inline status; "✓ Saved" fades after 2.4s. */
export function useSave() {
  const [status, setStatus] = useState<SaveStatus>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const run = async (write: () => PromiseLike<{ error: unknown }>) => {
    clearTimeout(timer.current);
    if (!navigator.onLine) {
      setStatus("error");
      return false;
    }
    setStatus("saving");
    const { error } = await write();
    if (error) {
      reportClientError("save_failed", { source: "useSave", ...errorFields(error) });
    }
    setStatus(error ? "error" : "saved");
    if (!error) timer.current = setTimeout(() => setStatus(null), 2400);
    return !error;
  };
  return { status, run };
}

/** Round photo or initials (navbar avatar, Account header). */
export function Avatar({
  url,
  name,
  size,
  className,
}: {
  url?: string | null;
  name: string;
  size: number;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "flex flex-none items-center justify-center overflow-hidden rounded-full bg-lime-soft text-lime-text",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials(name)}
    </span>
  );
}

export const initials = (name: string) =>
  name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
