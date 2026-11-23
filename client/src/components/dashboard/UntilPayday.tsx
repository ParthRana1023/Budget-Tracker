"use client";

// "Until payday" card (design handoff, Dashboard → Until payday chart).

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { inr } from "@/lib/money.mjs";
import { addDaysStr, shortDate } from "@/lib/cycle.mjs";
import { monotonePath, projectUntilPayday } from "@/lib/untilPayday.mjs";
import type { buildCycleModel } from "@/lib/cycleModel.mjs";
import type { RecurringItem, Tx } from "./types";
import Reveal from "../ui/Reveal";
import Slider from "../ui/Slider";

type Model = ReturnType<typeof buildCycleModel>;
type Period = { startStr: string; totalDays: number; daysElapsed: number };

export default function UntilPayday({
  model,
  period,
  today,
  transactions,
  recurringItems,
}: {
  model: Model;
  period: Period;
  today: string;
  transactions: Tx[];
  recurringItems: RecurringItem[];
}) {
  const [dailySpend, setDailySpend] = useState<number | null>(null);
  const [weekPattern, setWeekPattern] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const p = useMemo(
    () => projectUntilPayday({ model, period, today, transactions, recurringItems, dailySpend, weekPattern }),
    [model, period, today, transactions, recurringItems, dailySpend, weekPattern],
  );
  const DAY = period.daysElapsed,
    N = period.totalDays;

  // Chart space: x 0-100 across the cycle, y 4-96 from the highest value to the lowest (or ₹0).
  const all = [...p.pastPoints, ...p.futurePoints].map(([, v]) => v);
  const lo = Math.min(0, ...all),
    hi = Math.max(p.openValue, p.todayValue, 1),
    span = hi - lo || 1;
  const X = (k: number) => (k / N) * 100;
  const Y = (v: number) => 4 + (1 - (v - lo) / span) * 92;
  const toChart = (pts: Array<[number, number]>) => pts.map(([k, v]) => [X(k), Y(v)] as [number, number]);
  const pastPath = monotonePath(toChart(p.pastPoints)),
    futurePath = monotonePath(toChart(p.futurePoints));
  const base = Y(lo).toFixed(2),
    todayX = X(DAY).toFixed(2);
  const short = p.shortDay !== null;
  const stroke = short ? "var(--danger)" : "var(--lime)";
  const dateOf = (k: number) => shortDate(addDaysStr(period.startStr, k - 1));
  const weekdayOf = (k: number) => {
    const [y, m, d] = addDaysStr(period.startStr, k - 1)
      .split("-")
      .map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "short" });
  };
  const paceOk = model.paceDiff >= 0;
  const changed = dailySpend !== null && Math.round(dailySpend) !== Math.round(p.pace);

  // Hover / keyboard guide.
  const dayAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = plotRef.current!.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * N);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = hover ?? DAY;
    const next = { ArrowRight: Math.min(N, k + 1), ArrowLeft: Math.max(0, k - 1), Home: 0, End: N }[e.key];
    if (e.key === "Escape") setHover(null);
    else if (next !== undefined) {
      e.preventDefault();
      setHover(next);
    }
  };
  const hv = hover === null ? 0 : hover === 0 ? p.openValue : (p.eod.get(hover) ?? 0);
  const lines: Array<[string, string]> = [];
  if (hover === 0) lines.push(["Salary in, savings set aside", ""]);
  else if (hover !== null && hover <= DAY) {
    const day = p.past.get(hover);
    if (day?.flex) lines.push(["Everyday spending", `−${inr(day.flex)}`]);
    day?.items.forEach((it) => lines.push([it.label, `${it.amount > 0 ? "+" : "−"}${inr(Math.abs(it.amount))}`]));
    if (!day) lines.push(["Nothing spent", ""]);
  } else if (hover !== null) {
    lines.push(["Everyday spending (est.)", `−${inr(p.spendOn(hover))}`]);
    (p.bills.get(hover) ?? []).forEach((b) =>
      lines.push([`${b.name}${b.overdue ? " (overdue)" : b.recurring ? " (recurring)" : ""}`, `−${inr(b.amount)}`]),
    );
    if (hover === N) lines.push(["Salary arrives next morning", ""]);
  }
  const hDate =
    hover === null
      ? ""
      : hover === 0
        ? `Start of cycle, ${dateOf(1)}`
        : `${hover === DAY ? "Today, " : `End of ${weekdayOf(hover)}, `}${dateOf(hover)}${hover > DAY ? " · estimate" : ""}`;
  const hx = hover === null ? 0 : X(hover);

  const label = (text: string, v: string, extra = "") => (
    <>
      <span className="text-muted">{text}</span> <strong className={`tabular ${extra}`}>{v}</strong>
    </>
  );

  return (
    <Reveal
      immediate
      aria-labelledby="run-h"
      className="flex min-w-0 flex-[3_1_520px] flex-col gap-4 rounded-[18px] border border-line bg-tile p-[clamp(18px,5vw,24px)]"
      style={{ transitionDelay: ".5s" }}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2.5 border-b border-line-2 pb-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span id="run-h" className="eyebrow">
              Until payday · {N + 1 - DAY} days
            </span>
            <span
              className="rounded-full px-2.5 py-[3px] text-xs font-semibold"
              style={{
                background: paceOk ? "var(--lime-soft)" : "var(--warn-soft)",
                color: paceOk ? "var(--lime-text)" : "var(--warn)",
              }}
              title={
                paceOk
                  ? `${inr(model.paceDiff)} under where you’d expect to be by today.`
                  : `${inr(-model.paceDiff)} over where you’d expect to be by today.`
              }
            >
              {paceOk ? "On track" : "Burning fast"}
            </span>
          </span>
          <span
            className="font-serif text-[clamp(30px,4vw,40px)] leading-none text-pretty"
            style={{ color: short ? "var(--danger)" : "var(--ink)" }}
          >
            {short ? `Runs short around ${dateOf(p.shortDay!)}` : `${inr(p.finalValue)} left on payday`}
          </span>
          <span className="text-[13px] text-pretty text-ink-2">
            {short
              ? `At ${inr(p.burn)} a day you’d need ${inr(-p.finalValue)} more to reach payday. Try a lower daily amount.`
              : `At ${inr(p.burn)} a day on average, after the bills and recurring payments marked on the line. Income on hold isn’t counted.`}
          </span>
        </div>
        <div className="flex min-w-[220px] flex-[0_1_280px] flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="run-burn" className="text-[13px] text-ink-2">
              If I spend <strong className="tabular text-ink">{inr(p.burn)}</strong> a day on average
            </label>
            {changed && (
              <button
                type="button"
                onClick={() => setDailySpend(null)}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-lime-text"
              >
                Use my pace
              </button>
            )}
          </div>
          <Slider
            id="run-burn"
            min={0}
            max={p.sliderMax}
            step={5000}
            value={Math.round(p.burn)}
            onChange={setDailySpend}
            valueText={`${inr(p.burn)} a day`}
            mark={p.pace}
            danger={short}
          />
          <span className="text-xs text-muted">Your pace so far: {inr(p.pace)} a day</span>
          <div
            role="radiogroup"
            aria-label="Spread spending"
            className="flex gap-0.5 self-start rounded-full border border-line p-[3px]"
          >
            {(
              [
                [true, "My week", "Heavier on the weekdays you usually spend more"],
                [false, "Even", "Same amount every day"],
              ] as const
            ).map(([on, text, title]) => (
              <button
                key={text}
                type="button"
                role="radio"
                aria-checked={weekPattern === on}
                title={title}
                onClick={() => setWeekPattern(on)}
                className="h-7 cursor-pointer rounded-full border-0 px-3 text-xs font-semibold"
                style={{
                  background: weekPattern === on ? "var(--tile-2)" : "transparent",
                  color: weekPattern === on ? "var(--ink)" : "var(--muted)",
                }}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-ink-2">
        <span>
          Today you have <strong className="tabular text-ink">{inr(p.todayValue)}</strong>
        </span>
        <span className="text-muted">=</span>
        <span>
          <strong className="tabular text-ink">{inr(model.safe)}</strong> safe to spend
        </span>
        <span className="text-muted">+</span>
        <span>
          <strong className="tabular text-ink">{inr(model.unpaidBills)}</strong> kept for bills still to pay
        </span>
        {p.dots.some((d) => d.bill.recurring) && (
          <span className="text-muted">· recurring payments due later come out of safe to spend</span>
        )}
      </div>

      <div
        ref={plotRef}
        tabIndex={0}
        role="img"
        aria-label={`Money left this cycle: ${inr(p.openValue)} at the start, ${inr(p.todayValue)} today, about ${inr(p.finalValue)} by payday at ${inr(p.burn)} a day${p.dots.length ? `, with ${p.dots.length} payment${p.dots.length > 1 ? "s" : ""} still to come` : ""}. Use arrow keys to step through days.`}
        onPointerMove={(e) => setHover(dayAt(e))}
        onPointerDown={(e) => setHover(dayAt(e))}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover(DAY)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
        className="relative mx-2 mt-7 h-[210px] cursor-crosshair touch-pan-y rounded-lg outline-none focus-visible:shadow-[0_0_0_2px_var(--lime)] focus-visible:outline-none"
      >
        {lo < 0 && (
          <>
            <span className="absolute inset-x-0 border-t border-dashed border-line-2" style={{ top: `${Y(0)}%` }} />
            <span className="absolute left-0 -translate-y-[130%] text-[11px] text-muted" style={{ top: `${Y(0)}%` }}>
              {inr(0)}
            </span>
          </>
        )}
        <span className="absolute inset-y-0 border-l border-dashed border-line-2" style={{ left: `${todayX}%` }} />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <path
            d={`${pastPath} L${todayX} ${base} L0 ${base} Z`}
            style={{ fill: "var(--lime-soft)", stroke: "none" }}
          />
          <path
            d={`${futurePath} L100 ${base} L${todayX} ${base} Z`}
            style={{ fill: "var(--lime-soft)", stroke: "none", opacity: short ? 0 : 0.5 }}
          />
          <path
            d={pastPath}
            style={{ fill: "none", stroke: "var(--ink-2)", strokeWidth: 2.25, strokeLinejoin: "round" }}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={futurePath}
            style={{ fill: "none", stroke, strokeWidth: 2.25, strokeDasharray: "6 5", strokeLinejoin: "round" }}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {p.dots.map((d, i) => {
          const x = X(d.day);
          return (
            <span key={`${d.day}-${d.bill.name}`}>
              <span
                className="absolute -mt-[5.5px] -ml-[5.5px] h-[11px] w-[11px] rounded-full border-2 bg-tile"
                style={{
                  left: `${x}%`,
                  top: `${Y(d.value)}%`,
                  borderColor: d.bill.overdue ? "var(--warn)" : "var(--ink-2)",
                }}
              />
              <span
                className="pointer-events-none absolute rounded-md bg-tile px-[7px] py-0.5 text-[11px] leading-[1.3] whitespace-nowrap text-ink-2"
                style={{
                  left: `${x}%`,
                  top: `${Y(d.value)}%`,
                  transform: `translate(${x > 80 ? "calc(-100% - 6px)" : "-50%"}, ${i % 2 ? "10px" : "calc(-100% - 10px)"})`,
                }}
              >
                <strong className="text-ink">{d.bill.name}</strong> −{inr(d.bill.amount)}
              </span>
            </span>
          );
        })}
        <span
          className="absolute left-0 -mt-1 -ml-1 h-2 w-2 rounded-full bg-ink-2"
          style={{ top: `${Y(p.openValue)}%` }}
        />
        <span
          className="pointer-events-none absolute left-0 translate-x-1.5 -translate-y-[150%] text-xs whitespace-nowrap"
          style={{ top: `${Y(p.openValue)}%` }}
        >
          {label(dateOf(1), inr(p.openValue))}
        </span>
        <span
          className="absolute -mt-[5.5px] -ml-[5.5px] h-[11px] w-[11px] rounded-full border-2 border-tile bg-ink"
          style={{ left: `${todayX}%`, top: `${Y(p.todayValue)}%` }}
        />
        <span
          className="pointer-events-none absolute translate-x-2 -translate-y-[150%] text-xs whitespace-nowrap"
          style={{ left: `${todayX}%`, top: `${Y(p.todayValue)}%` }}
        >
          {label("Today", inr(p.todayValue))}
        </span>
        <span
          className="absolute left-full -mt-[5px] -ml-[5px] h-2.5 w-2.5 rounded-full"
          style={{ top: `${Y(p.finalValue)}%`, background: stroke }}
        />
        <span
          className="pointer-events-none absolute right-0 text-xs whitespace-nowrap"
          style={{ top: `${Y(p.finalValue)}%`, transform: `translate(0, ${Y(p.finalValue) > 80 ? "-160%" : "60%"})` }}
        >
          <span className="text-muted">Payday</span>{" "}
          <strong className="tabular" style={{ color: short ? "var(--danger)" : "var(--ink)" }}>
            {inr(p.finalValue)}
          </strong>
        </span>
        {hover !== null && (
          <>
            <span
              className="pointer-events-none absolute inset-y-0 w-0 border-l border-ink-2 opacity-50"
              style={{ left: `${hx}%` }}
            />
            <span
              className="pointer-events-none absolute -mt-1.5 -ml-1.5 h-3 w-3 rounded-full border-2 border-tile bg-ink"
              style={{ left: `${hx}%`, top: `${Y(hv)}%` }}
            />
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none absolute -top-[22px] z-[2] flex min-w-[170px] flex-col gap-1 rounded-xl border border-line-2 bg-bg px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,.25)]"
              style={{ left: `${hx}%`, transform: `translateX(${hx < 18 ? "0%" : hx > 82 ? "-100%" : "-50%"})` }}
            >
              <span className="text-xs font-semibold text-muted">{hDate}</span>
              <span
                className="tabular font-serif text-2xl leading-none"
                style={{ color: hv < 0 ? "var(--danger)" : "var(--ink)" }}
              >
                {inr(hv)} left
              </span>
              {lines.map(([a, b], i) => (
                <span key={i} className="flex justify-between gap-3 text-xs text-ink-2">
                  <span>{a}</span>
                  <span className="tabular">{b}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="relative mx-2 h-[18px] text-xs text-muted">
        <span className="absolute left-0">{dateOf(1)}</span>
        <span
          className="absolute -translate-x-1/2 font-semibold whitespace-nowrap text-ink-2"
          style={{ left: `${todayX}%` }}
        >
          Today · {dateOf(DAY)}
        </span>
        <span className="absolute right-0">Payday · {dateOf(N + 1)}</span>
      </div>
      <div className="flex flex-wrap gap-x-[18px] gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="w-[18px] border-t-2 border-ink-2" />
          What happened
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-[18px] border-t-2 border-dashed border-lime" />
          {weekPattern ? "Projection, following your usual week" : "Projection, same amount each day"}
        </span>
        <span>Hover, tap or use arrow keys to see any day</span>
      </div>
    </Reveal>
  );
}
