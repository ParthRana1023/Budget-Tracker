"use client";

// Card bills tile (handoff v4 §1, Dashboard.dc.html): what's owed on the user's credit cards,
// most urgent first. The numbers come from lib/cards.mjs; card spend was already counted in safe
// to spend when it was logged, so this only tracks the bill.

import Link from "next/link";
import { inr } from "@/lib/money.mjs";
import { shortDate } from "@/lib/cycle.mjs";
import { cardsSummary, type cardStatus } from "@/lib/cards.mjs";
import type { CreditCard, Tx } from "./types";

export type CardState = ReturnType<typeof cardStatus>;

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
/** "Due 18 Dec", or "Was due 5 Dec" once it's overdue. */
export const dueLabel = (c: CardState) => `${c.status === "overdue" ? "Was due" : "Due"} ${shortDate(c.dueDate)}`;
/** The status chip: "Overdue · 4 days", "Due in 2 days", "Due today", "Due 18 Dec", "In credit", "Paid". */
export function cardChip(c: CardState) {
  if (c.status === "overdue") return `Overdue · ${days(-c.daysToDue)}`;
  if (c.status === "soon") return c.daysToDue === 0 ? "Due today" : `Due in ${days(c.daysToDue)}`;
  if (c.status === "due") return dueLabel(c);
  return c.status === "credit" ? "In credit" : "Paid";
}
export const cardTone = (c: CardState) =>
  c.status === "overdue"
    ? "var(--danger)"
    : c.status === "soon"
      ? "var(--warn)"
      : c.status === "credit"
        ? "var(--lime-text)"
        : "var(--muted)";
/** "₹1,200" owed, or "₹35 credit". */
export const owedText = (c: CardState) => (c.owed < 0 ? `${inr(-c.owed)} credit` : inr(c.owed));

export default function CardBills({
  cards,
  entries,
  today,
  onPay,
}: {
  cards: CreditCard[];
  /** Entries in today's base. */
  entries: Tx[];
  today: string;
  /** Opens "Card bill paid" for that card, or the most urgent one. */
  onPay: (cardId?: string) => void;
}) {
  const { cards: list, total, urgent } = cardsSummary(cards, entries, today);
  const top = urgent && urgent.owed > 0 ? urgent : null;
  const multi = list.length > 1;
  const credit = list.reduce((s, c) => s + Math.max(0, -c.owed), 0);
  const tone = top?.status ?? "due";
  const accent = tone === "overdue" ? "var(--danger)" : tone === "soon" ? "var(--warn)" : null;

  const shell = "sf-rise flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-[18px] border bg-tile p-[22px]";
  if (!list.length)
    return (
      <section
        aria-labelledby="card-h"
        className={`${shell} border-dashed border-line-2`}
        style={{ animationDelay: ".58s" }}
      >
        <span id="card-h" className="eyebrow">
          Card bill
        </span>
        <span className="font-serif text-[28px] leading-[1.1]">Track your card bill</span>
        <p className="m-0 text-sm text-pretty text-ink-2">
          See what you owe on each credit card and when it’s due. Card spend already lowers safe to spend, so this only
          tracks the bill.
        </p>
        <Link
          href="/settings?s=card"
          className="mt-auto self-start text-[13px] font-semibold text-lime-text hover:text-ink"
        >
          Set up card tracking
        </Link>
      </section>
    );

  const chip = top
    ? multi
      ? top.status === "overdue"
        ? `${top.name} overdue`
        : `Next ${cardChip(top).toLowerCase()}`
      : cardChip(top)
    : credit > 0
      ? "In credit"
      : "All paid";
  const chipColor = top
    ? tone === "due"
      ? "var(--ink-2)"
      : cardTone(top)
    : credit > 0
      ? "var(--lime-text)"
      : "var(--muted)";
  const one = list[0];

  return (
    <section
      aria-labelledby="card-h"
      className={shell}
      style={{ animationDelay: ".58s", borderColor: (top && accent) || "var(--line)" }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <span
          id="card-h"
          className="eyebrow min-w-0 flex-[1_1_auto] truncate"
          style={{ color: (top && accent) || "var(--muted)" }}
        >
          {multi ? `Card bills · ${list.length} cards` : `Card bill · ${one.name}`}
        </span>
        <span
          className="flex-none rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
          style={{ borderColor: chipColor, color: chipColor }}
        >
          {chip}
        </span>
      </div>

      {top ? (
        <>
          <span className="tabular font-serif text-[44px] leading-none">{inr(total)}</span>
          <p className="m-0 text-sm text-pretty text-ink-2">
            {multi
              ? "Owed across your cards. Already counted in safe to spend."
              : tone === "overdue"
                ? "Owed on your card. Already counted in safe to spend."
                : `Due ${shortDate(top.dueDate)}. Already counted in safe to spend.`}
          </p>
          <div className="flex flex-col text-sm">
            {multi
              ? list.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5 border-t border-line py-[9px]">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-semibold">{c.name}</span>
                      <span
                        className="text-xs whitespace-nowrap"
                        style={{ color: c.status === "overdue" || c.status === "soon" ? cardTone(c) : "var(--muted)" }}
                      >
                        {c.status === "due" ? dueLabel(c) : cardChip(c)}
                      </span>
                    </div>
                    <span className="tabular font-semibold">{owedText(c)}</span>
                    {c.owed > 0 && (
                      <button
                        type="button"
                        onClick={() => onPay(c.id)}
                        aria-label={`Mark ${c.name} bill paid`}
                        className="h-8 cursor-pointer rounded-full border border-line-2 bg-transparent px-3 text-xs font-semibold whitespace-nowrap hover:border-ink-2"
                      >
                        Mark paid
                      </button>
                    )}
                  </div>
                ))
              : (
                  [
                    ["Opening balance", inr(one.opening)],
                    [`Card spend (${one.spendCount} ${one.spendCount === 1 ? "entry" : "entries"})`, inr(one.spend)],
                    ["Paid", inr(one.paid)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 border-t border-line py-2 text-ink-2">
                    <span>{k}</span>
                    <span className="tabular">{v}</span>
                  </div>
                ))}
          </div>
          {tone === "overdue" && (
            <p
              role="status"
              className="m-0 rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13px] font-semibold text-pretty text-danger"
            >
              {top.name} was due {shortDate(top.dueDate)}. Late fees and interest may apply.
            </p>
          )}
          <button
            type="button"
            onClick={() => onPay()}
            className="mt-auto h-[38px] cursor-pointer self-start rounded-full border px-4 text-[13px] font-bold whitespace-nowrap transition-transform active:scale-[.97]"
            style={{
              borderColor: tone === "due" ? "var(--line-2)" : "transparent",
              background: tone === "overdue" ? "var(--danger)" : tone === "soon" ? "var(--lime)" : "transparent",
              color: tone === "overdue" ? "var(--danger-ink)" : tone === "soon" ? "var(--lime-ink)" : "var(--ink)",
            }}
          >
            Mark bill paid
          </button>
        </>
      ) : (
        <>
          <span className="tabular font-serif text-[32px] leading-[1.1]">
            {credit > 0 ? `${inr(credit)} credit` : "Nothing owed"}
          </span>
          <p className="m-0 text-sm text-pretty text-muted">
            {credit > 0
              ? "You overpaid. It comes off your next card spend."
              : "Card spend you log shows up here, ready for the next statement."}
          </p>
        </>
      )}
    </section>
  );
}
