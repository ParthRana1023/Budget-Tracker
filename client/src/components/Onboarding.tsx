"use client";

// Six-step setup for a new account (design handoff, Onboarding; v4 §3 adds the Goal step). Every
// step can be skipped; the answers are saved together by complete_onboarding() on the last step.

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import Logo from "./Logo";
import { createClient } from "@/utils/supabase/client";
import {
  DEFAULT_BILLS,
  ONBOARDING_CATEGORIES,
  clampDay,
  digits,
  goalPace,
  keptBills,
  onboardingPayload,
} from "@/lib/onboarding.mjs";
import { PAYDAY_OPTIONS } from "@/lib/settings.mjs";
import { currencySymbol, inr as money, showTyped, toMinor } from "@/lib/money.mjs";
import { monthLabel } from "@/lib/cycle.mjs";
import { toLocalDateString } from "@/lib/periods.mjs";
import { errorFields, reportClientError } from "@/lib/log.mjs";

const STEPS: Array<[eyebrow: string, title: string, em: string, lede: string]> = [
  [
    "Step 1 · Income",
    "What lands",
    "each month?",
    "Regular take-home pay only. Bonuses and incentives are added later, when they arrive. Not sure yet? Skip it and add it from the dashboard.",
  ],
  [
    "Step 2 · Savings",
    "Pay yourself",
    "first.",
    "This comes out the day your salary lands, before anything counts as safe to spend.",
  ],
  [
    "Step 3 · Goal",
    "What are you",
    "saving for?",
    "One goal is enough to start. It’s paid from the savings you just set, and you can add more goals later.",
  ],
  [
    "Step 4 · Fixed bills",
    "What’s",
    "already spoken for?",
    "Rent, EMIs, insurance, utilities. Fill in the ones you know. Anything left blank is skipped, and you can add it later.",
  ],
  [
    "Step 5 · Flexible spending",
    "Where the rest",
    "usually goes.",
    "Pick the categories you use. Only add a limit where you’re sure of it. After a few months of entries, SaveFirst suggests limits from what you actually spend.",
  ],
  [
    "Step 6 · Ready",
    "Your first cycle",
    "starts today.",
    "Here’s how your salary splits. You can adjust any of this from the dashboard.",
  ],
];

/** Rupees (not paise) here: onboarding works in whole rupees. */
const inr = (whole: number) => money(toMinor(whole));
const FIELD =
  "rounded-[10px] border border-line-2 bg-tile-2 text-[15px] text-ink outline-none focus:border-lime focus-visible:outline-none";

/** Handoff v4 §3 presets, in whole units of the base currency (always INR at sign-up). */
const GOAL_PRESETS: Array<[string, string]> = [
  ["Emergency fund", "100000"],
  ["Holiday", "60000"],
  ["New phone", "40000"],
  ["Something else", ""],
];
const NO_GOAL = { preset: -1, name: "", amt: "", dated: true, by: "" };
const LABEL = "eyebrow leading-4";
const INPUT48 = `${FIELD} h-12 w-full min-w-0 px-3.5 focus:shadow-[0_0_0_3px_var(--lime-soft)]`;

type Bill = { name: string; amt: string; due: string };
type Cat = { name: string; limit: string; on: boolean };

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [salary, setSalary] = useState("");
  const [payDay, setPayDay] = useState("1");
  const [pct, setPct] = useState(30);
  const [bills, setBills] = useState<Bill[]>(DEFAULT_BILLS);
  const [cats, setCats] = useState<Cat[]>(ONBOARDING_CATEGORIES.map((name, i) => ({ name, limit: "", on: i < 5 })));
  const [goal, setGoal] = useState(NO_GOAL);
  const today = toLocalDateString(new Date());
  const [ty, tm] = today.split("-").map(Number);
  const minMonth = `${tm === 12 ? ty + 1 : ty}-${String((tm % 12) + 1).padStart(2, "0")}`;

  const sal = +salary || 0;
  const save = Math.round((sal * pct) / 100);
  const billTotal = bills.reduce((a, b) => a + (+b.amt || 0), 0);
  const safe = sal - save - billTotal;
  const flexPlan = cats.filter((c) => c.on).reduce((a, c) => a + (+c.limit || 0), 0);
  const gAmt = +goal.amt || 0,
    gBy = goal.dated ? goal.by : "";
  /** null = nothing entered (skip); false = half-filled (blocks Continue). */
  const goalOk = !goal.name.trim() && !goal.amt ? null : !!goal.name.trim() && gAmt > 0;
  const pace = goalPace(gAmt, save, gBy, today);
  const patchGoal = (p: Partial<typeof goal>) => {
    setErr("");
    setGoal((g) => ({ ...g, ...p }));
  };
  const w = (v: number) => `${((Math.max(0, v) / Math.max(sal, 1)) * 100).toFixed(1)}%`;

  const go = (to: number) => {
    setErr("");
    setShown(false);
    const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    setTimeout(
      () => {
        window.scrollTo(0, 0);
        setStep(to);
        setShown(true);
      },
      animate ? 180 : 0,
    );
  };

  const next = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (step === 2 && goalOk === false) return setErr("Add a target amount, or skip this step for now.");
    if (step === 3) {
      const kept = keptBills(bills);
      setBills(kept.length ? kept : [{ name: "", amt: "", due: "" }]);
    }
    if (step < 5) return go(step + 1);

    setBusy(true);
    setErr("");
    const { error } = await createClient().rpc(
      "complete_onboarding",
      onboardingPayload({
        salary,
        payDay,
        pct,
        bills,
        cats,
        ...(goalOk && { goal: { name: goal.name, target: goal.amt, by: gBy } }),
      }),
    );
    if (error) {
      reportClientError("onboarding_save_failed", { ...errorFields(error) });
      setBusy(false);
      return setErr("Couldn’t save your setup. Check your connection and try again.");
    }
    router.push("/dashboard");
    router.refresh();
  };

  const patchBill = (i: number, p: Partial<Bill>) => setBills((bs) => bs.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const patchCat = (i: number, p: Partial<Cat>) => setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const [eyebrow, title, em, lede] = STEPS[step];
  const empty =
    (step === 0 && !sal) ||
    (step === 2 && goalOk === null) ||
    (step === 3 && !billTotal) ||
    (step === 4 && !cats.some((c) => c.on));
  const nextLabel = busy
    ? "Opening dashboard…"
    : step === 5
      ? "Open my dashboard"
      : empty
        ? "Skip for now"
        : "Continue";

  const summary: Array<[string, string, string]> = [
    ["Take-home pay", sal ? inr(sal) : "Add later", sal ? "var(--ink)" : "var(--muted)"],
    [`Savings · ${pct}%`, sal ? `−${inr(save)}` : "—", sal ? "var(--ink)" : "var(--muted)"],
    [
      goalOk ? `Goal · ${goal.name.trim()}` : "Goal",
      goalOk ? `${inr(gAmt)}${gBy ? ` by ${monthLabel(`${gBy}-01`)}` : ""}` : "Add later",
      goalOk ? "var(--ink)" : "var(--muted)",
    ],
    ["Fixed bills", billTotal ? `−${inr(billTotal)}` : "None yet", billTotal ? "var(--ink)" : "var(--muted)"],
    ["Safe to spend", sal ? inr(safe) : "—", !sal ? "var(--muted)" : safe < 0 ? "var(--danger)" : "var(--lime-text)"],
    ["Flexible limits you set", flexPlan ? inr(flexPlan) : "Suggested later", "var(--muted)"],
  ];
  const overNote = (safe < 0 && sal > 0) || (step >= 4 && flexPlan > safe && safe > 0);

  return (
    <div className="flex min-h-screen w-full flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-4 border-b border-line px-6">
        <Logo size={28} />
        <span className="tabular ml-auto text-[13px] text-muted">Step {step + 1} of 6</span>
      </header>
      <div className="mx-auto w-full max-w-[1200px] px-6">
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={6}
          aria-valuenow={step + 1}
          className="h-[3px] overflow-hidden rounded-full bg-track"
        >
          <div
            className="h-full bg-lime transition-[width] duration-500 ease-soft"
            style={{ width: `${((step + 1) / 6) * 100}%` }}
          />
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-[1200px] flex-1 flex-wrap items-start gap-x-14 gap-y-8 px-6 pt-10 pb-16">
        <form
          onSubmit={next}
          noValidate
          className="flex min-w-0 flex-[3_1_460px] flex-col gap-[26px] transition-[opacity,transform] duration-300 ease-soft"
          style={{ opacity: shown ? 1 : 0, transform: `translateY(${shown ? 0 : 8}px)` }}
        >
          <div className="flex flex-col gap-2.5">
            <span className="eyebrow">{eyebrow}</span>
            <h1 className="m-0 font-serif text-[clamp(40px,6vw,60px)] leading-[.98] font-normal tracking-[-0.015em] text-balance">
              {title} <em>{em}</em>
            </h1>
            <p className="m-0 max-w-[520px] text-pretty text-ink-2">{lede}</p>
          </div>

          {step === 0 && (
            <>
              <div className="flex flex-col gap-3">
                <label htmlFor="ob-sal" className="eyebrow">
                  Monthly take-home pay
                </label>
                <div className="flex items-baseline gap-1.5 border-b-[1.5px] border-line-2 pb-1.5">
                  <span className="font-serif text-[44px] leading-none text-muted">{currencySymbol()}</span>
                  <input
                    id="ob-sal"
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={salary}
                    onChange={(e) => setSalary(digits(e.target.value, 8))}
                    placeholder="0"
                    className="tabular min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-[clamp(48px,12vw,64px)] leading-[1.05] tracking-[-0.02em] text-ink outline-none focus-visible:outline-none"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="ob-day" className="eyebrow">
                  Salary lands on
                </label>
                <select
                  id="ob-day"
                  value={payDay}
                  onChange={(e) => setPayDay(e.target.value)}
                  className="h-12 w-full max-w-[280px] cursor-pointer rounded-xl border border-line-2 bg-tile-2 px-3 text-[15px] text-ink outline-none focus:border-lime focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none"
                >
                  {PAYDAY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="text-[13px] text-muted">Your cycle starts this day each month.</span>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <button
                  type="button"
                  onClick={() => setPct((p) => Math.max(5, p - 1))}
                  aria-label="Lower savings target"
                  className="h-12 w-12 cursor-pointer rounded-full border border-line-2 bg-transparent text-[22px] hover:border-ink-2"
                >
                  −
                </button>
                <span
                  className="tabular font-serif text-[clamp(72px,14vw,112px)] leading-[.9] tracking-[-0.02em]"
                  aria-live="polite"
                >
                  {pct}%
                </span>
                <button
                  type="button"
                  onClick={() => setPct((p) => Math.min(60, p + 1))}
                  aria-label="Raise savings target"
                  className="h-12 w-12 cursor-pointer rounded-full border border-line-2 bg-transparent text-[22px] hover:border-ink-2"
                >
                  +
                </button>
                <span className="font-serif text-[22px] text-ink-2">
                  = <em className="text-ink">{inr(save)}</em> a month
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[10, 20, 30, 40].map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={pct === p}
                    onClick={() => setPct(p)}
                    className="h-[38px] cursor-pointer rounded-full border px-4 text-[13px] font-semibold"
                    style={{
                      borderColor: pct === p ? "var(--lime)" : "var(--line)",
                      background: pct === p ? "var(--lime-soft)" : "transparent",
                    }}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div role="radiogroup" aria-label="Goal presets" className="flex flex-wrap gap-2">
                {GOAL_PRESETS.map(([label, amt], i) => {
                  const on = goal.preset === i;
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => patchGoal({ preset: i, name: amt ? label : "", amt: amt || goal.amt })}
                      className="h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-[border-color,background] duration-200"
                      style={{
                        borderColor: on ? "var(--lime)" : "var(--line-2)",
                        background: on ? "var(--lime-soft)" : "transparent",
                        color: on ? "var(--lime-text)" : "var(--ink)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="ob-gn" className={LABEL}>
                  Goal name
                </label>
                <input
                  id="ob-gn"
                  type="text"
                  maxLength={60}
                  value={goal.name}
                  onChange={(e) => patchGoal({ name: e.target.value })}
                  placeholder="e.g. Wedding, laptop, house deposit"
                  className={INPUT48}
                />
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3.5">
                <div className="flex min-w-0 flex-col gap-2">
                  <label htmlFor="ob-gt" className={LABEL}>
                    Target amount
                  </label>
                  <div className="relative flex">
                    <span className="absolute top-0 left-3.5 flex h-12 items-center text-muted">
                      {currencySymbol()}
                    </span>
                    <input
                      id="ob-gt"
                      type="text"
                      inputMode="numeric"
                      value={showTyped(goal.amt)}
                      onChange={(e) => patchGoal({ amt: digits(e.target.value, 8) })}
                      placeholder="0"
                      className={`${INPUT48} tabular pl-8 font-semibold`}
                    />
                  </div>
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <span id="ob-gb-l" className={LABEL}>
                    Target month
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="ob-gb-l"
                    className="flex h-12 gap-0.5 rounded-xl border border-line-2 p-[3px]"
                  >
                    {(
                      [
                        ["By a month", true],
                        ["No end date", false],
                      ] as const
                    ).map(([label, v]) => (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={goal.dated === v}
                        onClick={() => patchGoal({ dated: v })}
                        className="min-w-0 flex-1 cursor-pointer rounded-[9px] border-0 text-[13px] font-semibold whitespace-nowrap transition-[background,color] duration-200"
                        style={{
                          background: goal.dated === v ? "var(--ink)" : "transparent",
                          color: goal.dated === v ? "var(--bg)" : "var(--ink-2)",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {goal.dated && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="ob-gb" className={LABEL}>
                    Save it by
                  </label>
                  <input
                    id="ob-gb"
                    type="month"
                    min={minMonth}
                    value={goal.by}
                    onChange={(e) => patchGoal({ by: e.target.value })}
                    className={`${INPUT48} block appearance-none`}
                  />
                </div>
              )}
              {pace && (
                <p
                  role="status"
                  aria-live="polite"
                  className="m-0 rounded-xl px-4 py-3.5 text-[15px] text-pretty"
                  style={{
                    background: pace.warn ? "var(--warn-soft)" : "var(--tile-2)",
                    color: pace.warn ? "var(--warn)" : "var(--ink)",
                  }}
                >
                  {pace.text}
                </p>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-col border-t border-line-2">
                {bills.map((b, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3">
                    <input
                      type="text"
                      aria-label="Bill name"
                      value={b.name}
                      onChange={(e) => patchBill(i, { name: e.target.value })}
                      className={`${FIELD} h-11 min-w-0 flex-[2_1_160px] px-3`}
                    />
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted">{currencySymbol()}</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${b.name || "Bill"} amount`}
                        value={b.amt}
                        onChange={(e) => patchBill(i, { amt: digits(e.target.value, 7) })}
                        className={`${FIELD} tabular h-11 w-[110px] px-2.5 text-right font-semibold`}
                      />
                    </span>
                    <span className="flex items-center gap-1.5 text-[13px] text-muted">
                      day
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={2}
                        placeholder="—"
                        aria-label={`${b.name || "Bill"} due day`}
                        value={b.due}
                        onChange={(e) => patchBill(i, { due: clampDay(e.target.value) })}
                        className={`${FIELD} h-11 w-[52px] px-2 text-center`}
                      />
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${b.name || "bill"}`}
                      onClick={() => setBills((bs) => bs.filter((_, j) => j !== i))}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-muted hover:border-danger hover:text-danger"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setBills((bs) => [...bs, { name: "", amt: "", due: "" }])}
                className="h-10 cursor-pointer self-start rounded-full border border-dashed border-line-2 bg-transparent px-4 text-[13px] font-semibold hover:border-lime"
              >
                + Add a bill
              </button>
            </>
          )}

          {step === 4 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-2">
              {cats.map((c, i) => (
                <div
                  key={c.name}
                  className="flex flex-col gap-2 rounded-[14px] border px-3.5 py-3 transition-colors duration-200"
                  style={{
                    borderColor: c.on ? "var(--lime)" : "var(--line)",
                    background: c.on ? "var(--lime-soft)" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={c.on}
                    onClick={() => patchCat(i, { on: !c.on })}
                    className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left font-semibold"
                  >
                    <span
                      aria-hidden
                      className="h-[18px] w-[18px] flex-none rounded-md border-[1.5px]"
                      style={{
                        borderColor: c.on ? "var(--lime)" : "var(--line)",
                        background: c.on ? "var(--lime)" : "transparent",
                      }}
                    />
                    {c.name}
                  </button>
                  <span className="flex items-center gap-1.5" style={{ opacity: c.on ? 1 : 0.4 }}>
                    <span className="text-muted">{currencySymbol()}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Not sure yet"
                      aria-label={`${c.name} monthly limit`}
                      disabled={!c.on}
                      value={c.limit}
                      onChange={(e) => patchCat(i, { limit: digits(e.target.value, 7) })}
                      className="tabular h-10 min-w-0 flex-1 rounded-[10px] border border-line-2 bg-tile px-2.5 text-[15px] font-semibold text-ink outline-none focus:border-lime focus-visible:outline-none"
                    />
                  </span>
                </div>
              ))}
            </div>
          )}

          {step === 5 && (
            <div className="flex flex-col border-t border-line-2">
              {summary.map(([label, value, color]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-line py-3.5">
                  <span className="text-ink-2">{label}</span>
                  <span className="tabular font-serif text-[26px] leading-none" style={{ color }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {err && (
            <span role="alert" className="text-sm font-semibold text-danger">
              {err}
            </span>
          )}
          <div className="flex flex-wrap gap-2.5 pt-1.5">
            {step === 2 && goalOk !== null && (
              <button
                type="button"
                onClick={() => {
                  setGoal(NO_GOAL);
                  go(3);
                }}
                className="order-2 h-[50px] min-w-[180px] cursor-pointer rounded-full border border-line-2 bg-transparent px-[22px] text-[15px] font-semibold hover:border-ink-2"
              >
                Skip for now
              </button>
            )}
            {step > 0 && (
              <button
                type="button"
                onClick={() => go(step - 1)}
                className="h-[50px] cursor-pointer rounded-full border border-line-2 bg-transparent px-[22px] text-[15px] font-semibold hover:border-ink-2"
              >
                Back
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="h-[50px] min-w-[180px] cursor-pointer rounded-full border-0 bg-lime px-6 text-[15px] font-bold text-lime-ink transition-transform duration-150 hover:-translate-y-px active:scale-[.97] disabled:opacity-70"
            >
              {nextLabel}
            </button>
          </div>
        </form>

        <aside className="sticky top-6 flex min-w-0 flex-[2_1_320px] flex-col gap-[18px] rounded-[20px] border border-line bg-tile p-[26px]">
          <span className="eyebrow">Safe to spend each cycle</span>
          <span
            className="tabular font-serif text-[clamp(56px,10vw,88px)] leading-[.86] tracking-[-0.025em]"
            style={{ color: !sal ? "var(--muted)" : safe < 0 ? "var(--danger)" : "var(--ink)" }}
          >
            {sal ? inr(safe) : `${currencySymbol()}—`}
          </span>
          <span className="font-serif text-xl text-ink-2">
            About <em className="text-ink">{sal ? inr(Math.max(0, safe) / 30) : `${currencySymbol()}—`} a day</em>.
          </span>
          <div aria-hidden className="flex h-3 gap-[3px]">
            <span className="rounded-md bg-lime transition-[width] duration-500 ease-soft" style={{ width: w(save) }} />
            <span
              className="rounded-md bg-fixed transition-[width] duration-500 ease-soft"
              style={{ width: w(billTotal) }}
            />
            <span className="rounded-md bg-ink transition-[width] duration-500 ease-soft" style={{ width: w(safe) }} />
          </div>
          <div className="tabular flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
            {(
              [
                ["var(--lime)", "Savings", inr(save)],
                ["var(--fixed)", "Bills", inr(billTotal)],
                ["var(--ink)", "Safe", sal ? inr(safe) : `${currencySymbol()}—`],
              ] as const
            ).map(([c, label, v]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                {label} <strong className="font-semibold text-ink">{v}</strong>
              </span>
            ))}
          </div>
          {overNote && (
            <p className="m-0 rounded-xl bg-warn-soft px-3.5 py-3 text-sm font-semibold text-pretty text-warn">
              {safe < 0
                ? `Savings and bills are ${inr(-safe)} more than your pay. Lower the savings target or a bill.`
                : `Your flexible limits add up to ${inr(flexPlan - safe)} more than what’s safe to spend.`}
            </p>
          )}
        </aside>
      </main>
    </div>
  );
}
