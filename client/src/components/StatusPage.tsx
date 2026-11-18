"use client";

import Link from "next/link";
import { useState } from "react";

export type StatusPageProps = {
  eyebrow: string;
  title: string;
  /** Italic, muted end of the title. */
  em: string;
  body: string;
  /** Primary action: a link, or a retry callback (label switches to "Retrying…"). */
  primary: { label: string; href: string } | { label: string; onRetry: () => void };
  secondary?: { label: string; href: string };
  code: string;
  cardLabel: string;
  cardNote: string;
  tone: "muted" | "danger" | "warn";
  /** How full the card's bar is, e.g. "30%". */
  bar: string;
  reference?: string;
};

const TONE = { muted: "var(--muted)", danger: "var(--danger)", warn: "var(--warn)" };

/** Logo used in page headers. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-ink hover:text-ink">
      <span aria-hidden className="h-[9px] w-[9px] rounded-full bg-lime shadow-[0_0_0_4px_var(--lime-soft)]" />
      <span className="font-serif text-[28px] leading-none tracking-[-0.01em]">SaveFirst</span>
    </Link>
  );
}

/** Header + centred main used by every status page (design handoff, Status Pages). */
export function StatusShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-2.5 border-b border-line px-6">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12">{children}</main>
    </div>
  );
}

/** 404 / 500 / offline / session-expired page. */
export default function StatusPage(p: StatusPageProps) {
  const [retrying, setRetrying] = useState(false);
  const tone = TONE[p.tone];
  const primaryClass =
    "flex h-[50px] cursor-pointer items-center gap-2.5 rounded-full border-0 bg-lime px-6 text-[15px] font-bold text-lime-ink transition-[transform,opacity] duration-150 hover:-translate-y-0.5 hover:text-lime-ink active:scale-[.97]";

  return (
    <StatusShell>
      <div className="flex w-full max-w-[1100px] flex-wrap items-center gap-x-16 gap-y-10">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[22px]">
          <span className="eyebrow" style={{ color: tone }}>
            {p.eyebrow}
          </span>
          <h1 className="m-0 font-serif text-[clamp(48px,8vw,88px)] leading-[.95] font-normal tracking-[-0.02em] text-balance">
            {p.title} <em className="text-muted">{p.em}</em>
          </h1>
          <p className="m-0 max-w-[480px] text-lg text-pretty text-ink-2">{p.body}</p>
          <div className="flex flex-wrap gap-2.5">
            {"href" in p.primary ? (
              <Link href={p.primary.href} className={primaryClass}>
                {p.primary.label}
              </Link>
            ) : (
              <button
                type="button"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  (p.primary as { onRetry: () => void }).onRetry();
                }}
                className={`${primaryClass} disabled:opacity-70`}
              >
                {retrying ? "Retrying…" : p.primary.label}
              </button>
            )}
            {p.secondary && (
              <Link
                href={p.secondary.href}
                className="flex h-[50px] items-center rounded-full border border-line-2 px-[22px] text-[15px] font-semibold text-ink transition-colors hover:border-ink-2 hover:text-ink"
              >
                {p.secondary.label}
              </Link>
            )}
          </div>
          {p.reference && <span className="tabular text-[13px] text-muted">Reference {p.reference}</span>}
        </div>
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 rounded-[20px] border border-line bg-tile p-[26px]">
          <span className="eyebrow">{p.cardLabel}</span>
          <span
            className="tabular font-serif text-[clamp(72px,14vw,120px)] leading-[.86] tracking-[-0.025em]"
            style={{ color: p.code === "500" ? "var(--danger)" : "var(--ink)" }}
          >
            {p.code}
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-track">
            <div className="sf-grow h-full rounded-full" style={{ width: p.bar, background: tone }} />
          </div>
          <p className="m-0 border-t border-line pt-3.5 text-sm text-pretty text-ink-2">{p.cardNote}</p>
        </div>
      </div>
    </StatusShell>
  );
}
