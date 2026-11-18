"use client";

import { inr } from "@/lib/money.mjs";
import Reveal from "../ui/Reveal";
import { CARD_H2, LINK_BUTTON, PILL_LINE, type Category } from "./types";

/** Budgets card: flexible categories, spent against their limits. */
export default function Budgets({
  flex,
  spentByCat,
  flexSpent,
  flexBudget,
  onManage,
}: {
  flex: Category[];
  spentByCat: Map<string, number>;
  flexSpent: number;
  flexBudget: number;
  onManage: () => void;
}) {
  return (
    <Reveal className="flex min-w-0 flex-[3_1_520px] flex-col rounded-[18px] border border-line bg-tile p-[clamp(18px,5vw,24px)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line-2 pb-2.5">
        <h2 className={`${CARD_H2} flex items-baseline gap-3`}>
          Budgets
          <button type="button" onClick={onManage} className={`${LINK_BUTTON} font-sans`}>
            Manage
          </button>
        </h2>
        <span className="tabular text-[13px] whitespace-nowrap text-muted">
          {inr(flexSpent)} of {inr(flexBudget)}
        </span>
      </div>
      {flex.map((c, i) => {
        const spent = spentByCat.get(c.id) ?? 0,
          limit = Number(c.monthly_limit);
        const over = limit > 0 && spent > limit,
          hot = limit > 0 && spent / limit >= 0.75;
        const tone = over ? "var(--danger)" : hot ? "var(--warn)" : "var(--ink)";
        return (
          <div
            key={c.id}
            className="flex flex-col gap-[7px] border-b border-line py-[11px]"
            data-testid="budget-row"
            data-name={c.name}
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-medium">{c.name}</span>
              <span aria-hidden className="flex-[1_1_24px] -translate-y-1 border-b border-dotted border-line-2" />
              <span className="tabular text-sm">
                <strong className="font-semibold" style={{ color: tone }}>
                  {inr(spent)}
                </strong>
                <span className="text-muted">{limit ? ` / ${inr(limit)}` : " · no limit"}</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-track">
              <div
                className="rv-bar h-full rounded-full"
                style={{
                  width: limit ? `${Math.min(100, (spent / limit) * 100)}%` : "0%",
                  background: over ? "var(--danger)" : hot ? "var(--warn)" : "var(--lime)",
                  transitionDuration: "1.1s",
                  transitionDelay: `${0.7 + i * 0.07}s`,
                }}
              />
            </div>
          </div>
        );
      })}
      {flex.length === 0 && (
        <div className="flex flex-col gap-2.5 pt-[18px] pb-1">
          <p className="m-0 font-serif text-xl text-pretty text-ink-2 italic">
            No flexible categories yet. Add groceries, dining or fuel to see where the rest of your salary goes.
          </p>
          <button type="button" onClick={onManage} className={`${PILL_LINE} h-9 self-start`}>
            Add a category
          </button>
        </div>
      )}
    </Reveal>
  );
}
