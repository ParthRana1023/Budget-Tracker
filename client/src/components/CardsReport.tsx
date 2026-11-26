"use client";

// Reports › Credit cards (handoff v4 §1, Reports.dc.html): spend, payments and what's owed on each
// card, and whether the last bills were paid on time (lib/cards.mjs). Card payments are transfers,
// so this panel is the only place in Reports that shows them.

import { inr } from "@/lib/money.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import { cardHistory, cardsSummary } from "@/lib/cards.mjs";
import type { CreditCard, Tx } from "./dashboard/types";

/** One colour per card, in order (as in the handoff). */
const COLOURS = ["var(--lime)", "#8fb4ff", "#f0a6ff", "#ffb547", "#7fe0d0"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATE = {
  on_time: { c: "var(--lime)", fc: "var(--muted)", say: "paid on time" },
  late: { c: "var(--warn)", fc: "var(--warn)", say: "paid late" },
  none: { c: "var(--track)", fc: "var(--muted)", say: "no payment logged" },
} as const;

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-tile-2 p-3.5">
      <span className="eyebrow">{label}</span>
      <span className="tabular truncate font-serif text-[28px] leading-[1.1]">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

export default function CardsReport({ cards, entries, today }: { cards: CreditCard[]; entries: Tx[]; today: string }) {
  const { cards: list } = cardsSummary(cards, entries, today);
  if (!list.length) return null;
  // In the order the cards were added, so each keeps its colour.
  const rows = cards
    .filter((c) => !c.archived_at)
    .map((c, i) => {
      const s = list.find((x) => x.id === c.id)!;
      const bills = cardHistory(c, entries, today, 6);
      const logged = bills.filter((b) => b.state !== "none").length,
        ok = bills.filter((b) => b.state === "on_time").length;
      return { ...s, colour: COLOURS[i % COLOURS.length], bills, logged, ok };
    });
  const multi = rows.length > 1;
  const owedAll = rows.reduce((t, r) => t + Math.max(0, r.owed), 0);
  const payN = rows.reduce((t, r) => t + r.payments, 0);
  const next = rows.filter((r) => r.owed > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const okAll = rows.reduce((t, r) => t + r.ok, 0),
    loggedAll = rows.reduce((t, r) => t + r.logged, 0);
  const shares = rows
    .filter((r) => r.owed > 0)
    .map((r) => ({ ...r, pct: Math.round((r.owed / owedAll) * 100), w: `${((r.owed / owedAll) * 100).toFixed(2)}%` }));

  return (
    <section
      aria-labelledby="cc-h"
      className="flex flex-col gap-5 rounded-[18px] border border-line bg-tile p-[clamp(20px,4vw,26px)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <h2 id="cc-h" className="m-0 font-serif text-[30px] font-normal">
          Credit cards
        </h2>
        <span className="text-[13px] text-muted">{multi ? `${rows.length} cards` : rows[0].name}</span>
      </div>
      <div className="flex flex-col gap-3">
        <span className="eyebrow">All cards</span>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
          <Stat label="Card spend" value={inr(rows.reduce((t, r) => t + r.spend, 0))} sub="Already in spending" />
          <Stat
            label="Paid"
            value={inr(rows.reduce((t, r) => t + r.paid, 0))}
            sub={payN === 1 ? "1 payment" : `${payN} payments`}
          />
          <Stat
            label="Still owed"
            value={inr(owedAll)}
            sub={next ? `Next due ${shortDate(next.dueDate)}` : "Nothing owed"}
          />
        </div>
        {multi && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-[13px]">
              <span className="text-ink-2">Share of what’s owed</span>
              <span className="text-muted">{loggedAll ? `${okAll} of ${loggedAll} bills paid on time` : ""}</span>
            </div>
            <div
              role="img"
              aria-label={shares.map((s) => `${s.name} ${s.pct}%`).join(", ") || "Nothing owed"}
              className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-track"
            >
              {shares.map((s) => (
                <span key={s.id} className="sf-grow" style={{ width: s.w, background: s.colour }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
              {shares.map((s) => (
                <span key={s.id} className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: s.colour }} />
                  {s.name} · {s.pct}%
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {rows.map((r) => (
        <div key={r.id} className="flex flex-col gap-3 border-t border-line pt-[18px]">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="flex min-w-0 items-center gap-2 text-lg font-semibold">
              {multi && (
                <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: r.colour }} />
              )}
              <span className="truncate">{r.name}</span>
            </span>
            <span className="text-[13px] text-muted">
              {r.owed > 0 ? `Due ${shortDate(r.dueDate)}` : r.owed < 0 ? "In credit" : "Nothing owed"}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
            <Stat label="Spend" value={inr(r.spend)} />
            <Stat label="Paid" value={inr(r.paid)} />
            <Stat label="Owed" value={r.owed < 0 ? `${inr(-r.owed)} credit` : inr(r.owed)} />
          </div>
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
            <span className="eyebrow">Last 6 bills</span>
            <span className="text-[13px] text-ink-2">
              {r.logged ? `${r.ok} of ${r.logged} paid on time` : "No payments logged yet"}
            </span>
          </div>
          <div
            role="list"
            aria-label={`Last 6 bills for ${r.name}`}
            className="grid grid-cols-[repeat(6,minmax(0,1fr))] gap-1.5"
          >
            {r.bills.map((b) => {
              const st = STATE[b.state],
                m = MON[Number(b.dueDate.slice(5, 7)) - 1];
              return (
                <div
                  key={b.dueDate}
                  role="listitem"
                  aria-label={`${m}: ${st.say}`}
                  className="flex flex-col items-center gap-1.5"
                >
                  <span className="h-2 w-full rounded-full" style={{ background: st.c }} />
                  <span className="text-xs" style={{ color: st.fc, fontWeight: b.state === "late" ? 600 : 400 }}>
                    {m}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-lime" />
          Paid on time
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-warn" />
          Paid late
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-line-2 bg-track" />
          No payment logged
        </span>
      </div>
      <p className="m-0 text-[13px] text-pretty text-muted">
        Card payments aren’t counted as spending. Your purchases already appear under their categories.
      </p>
    </section>
  );
}
