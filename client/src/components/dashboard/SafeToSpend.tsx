"use client";

import { inr } from "@/lib/money.mjs";
import { Legend } from "../DemoSplit";
import CountUp from "../ui/CountUp";
import Reveal from "../ui/Reveal";
import type { buildCycleModel } from "@/lib/cycleModel.mjs";

type Model = ReturnType<typeof buildCycleModel>;

/** Hero: safe to spend this cycle, the per-day line and the pay-yourself-first bar. */
export default function SafeToSpend({ model, daysLeft }: { model: Model; daysLeft: number }) {
  const bar: Array<[number, string]> = [
    [model.bar.savings, "var(--lime)"],
    [model.bar.bills, "var(--fixed)"],
    [model.bar.spent, "var(--flex)"],
    [model.bar.safe, "var(--ink)"],
  ];
  // Income can be below the parts (none recorded yet, or overspent): scale to whichever is bigger.
  const base = Math.max(
    model.income,
    bar.reduce((s, [v]) => s + Math.max(0, v), 0),
    1,
  );
  const pct = (v: number) => `${((Math.max(0, v) / base) * 100).toFixed(2)}%`;

  return (
    <Reveal
      immediate
      className="flex min-w-0 flex-[2_1_420px] flex-col gap-[22px] rounded-[18px] border border-line bg-tile p-[30px] max-[480px]:p-[22px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Safe to spend this cycle</span>
        <span className="rounded-full bg-lime-soft px-2.5 py-[3px] text-xs font-semibold text-lime-text">
          Savings set aside first
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        <span
          className="tabular font-serif text-[clamp(58px,17vw,128px)] leading-[.86] tracking-[-0.025em]"
          data-testid="safe-to-spend"
        >
          <CountUp rupees={model.safe / 100} />
        </span>
        <p className="m-0 max-w-[540px] font-serif text-[clamp(20px,2.2vw,25px)] leading-[1.25] text-pretty text-ink-2">
          That’s <em className="text-ink">{inr(model.perDay)} a day</em> for the next {daysLeft} days, after{" "}
          {inr(model.savedTotal)} to savings and {inr(model.unpaidBills)} in bills still due.
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        <div aria-hidden className="flex h-3.5 gap-[3px] overflow-hidden">
          {bar.map(([v, c], i) => (
            <div
              key={c}
              className="rv-bar rounded-md"
              style={{ width: pct(v), background: c, transitionDelay: `${0.3 + i * 0.15}s` }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Legend
            items={[
              ["var(--lime)", "Savings", inr(model.savedTotal)],
              ["var(--fixed)", "Bills", inr(model.fixedCommitted)],
              ["var(--flex)", "Spent", inr(model.flexSpent)],
              ["var(--ink)", "Safe", inr(model.safe)],
            ]}
          />
          <span className="tabular text-[13px] whitespace-nowrap text-muted">
            of <strong className="font-semibold text-ink">{inr(model.income)}</strong> income
          </span>
        </div>
      </div>
    </Reveal>
  );
}
