"use client";

// Marketing landing page (design handoff, Landing and Auth → Landing). All figures are
// the handoff's sample account, not real data.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus, Repeat, ShieldCheck } from "lucide-react";
import SiteHeader from "./SiteHeader";
import DemoSplit, { Legend } from "./DemoSplit";
import Reveal from "./ui/Reveal";
import CountUp from "./ui/CountUp";
import Logo from "./Logo";

const H2 = "m-0 font-serif text-[clamp(40px,5vw,64px)] leading-none font-normal tracking-[-0.015em] text-balance";
const CARD = "rounded-[20px] border border-line bg-tile";
const PRIMARY =
  "flex h-[50px] items-center gap-2.5 rounded-full bg-lime px-6 text-[15px] font-bold text-lime-ink transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:text-lime-ink hover:shadow-[0_12px_30px_-12px_var(--lime)] active:scale-[.97]";

const HERO_CATS: Array<[string, number, number]> = [
  ["Groceries", 6200, 10000],
  ["Dining out", 3950, 5000],
  ["Fuel", 1600, 4000],
];
// [n, title, description, bar left, bar width, colour, amount, amount colour]
const STEPS: Array<[string, string, string, string, string, string, string, string]> = [
  [
    "i",
    "Salary lands",
    "Confirmed take-home pay starts the cycle.",
    "0%",
    "100%",
    "var(--ink-2)",
    "₹95,000",
    "var(--ink)",
  ],
  [
    "ii",
    "Savings come out first",
    "Your monthly target goes straight to your goals.",
    "68.42%",
    "31.58%",
    "var(--lime)",
    "−30,000",
    "var(--ink)",
  ],
  [
    "iii",
    "Fixed bills are reserved",
    "Rent, EMIs, insurance and utilities.",
    "31.26%",
    "37.16%",
    "var(--fixed)",
    "−35,300",
    "var(--ink)",
  ],
  [
    "iv",
    "The rest is safe to spend",
    "₹990 a day across a 30-day cycle.",
    "0%",
    "31.26%",
    "var(--flex)",
    "₹29,700",
    "var(--lime-text)",
  ],
];
const DEMO_CATS = ["Groceries", "Dining out", "Fuel", "Shopping", "Health", "Travel"];
const CHART: Array<[string, number, number]> = [
  ["Jun", 61.2, 24],
  ["Jul", 64.7, 22],
  ["Aug", 59.1, 26],
  ["Sep", 66.5, 36],
  ["Oct", 63.3, 24],
  ["Nov", 48.2, 30],
];
const FAQ: Array<[string, string]> = [
  [
    "Do I need to connect my bank?",
    "No. You record income and expenses yourself, and logging takes three taps. Nothing links to your bank account.",
  ],
  [
    "What counts as safe to spend?",
    "Confirmed income, minus your savings target, minus fixed bills not yet paid, minus flexible spending so far. Divided by the days left, it becomes your daily number.",
  ],
  [
    "How are bonuses and incentives handled?",
    "They stay marked as expected and don’t count until you mark them received. Then you split them across savings, annual bills and spending.",
  ],
  [
    // Handoff README: recurring items never record themselves; they show as due until you tap Record.
    "Can rent and subscriptions repeat every month?",
    "Yes. Mark an expense as monthly and pick a day from 1 to 28. On that day it shows as due, and it’s added only when you tap Record, so nothing is counted twice.",
  ],
  ["Is it free?", "Yes. Create an account with your email and start your first cycle today."],
];

export default function Landing() {
  const [tap, setTap] = useState(0);
  const [faq, setFaq] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTap((s) => (s + 1) % 5), 1300);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen w-full overflow-x-clip">
      <SiteHeader nav />

      {/* Hero */}
      <section className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-14 px-6 pt-[72px] pb-24">
        <div className="sf-rise flex min-w-0 flex-[1_1_460px] flex-col gap-[26px]">
          <span className="eyebrow">Budgeting for a monthly salary</span>
          <h1 className="m-0 font-serif text-[clamp(52px,7vw,92px)] leading-[.95] font-normal tracking-[-0.02em] text-balance">
            Know what’s safe to spend, <em className="text-lime-text">every day</em> of the month.
          </h1>
          <p className="m-0 max-w-[500px] text-lg text-pretty text-ink-2">
            SaveFirst sets aside your savings and fixed bills the day your salary lands. What’s left becomes one daily
            number you can trust.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Link href="/signup" className={PRIMARY}>
              Create free account
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/login"
              className="flex h-[50px] items-center rounded-full border border-line-2 px-[22px] text-[15px] font-semibold text-ink transition-colors hover:border-ink-2 hover:text-ink active:scale-[.97]"
            >
              Sign in
            </Link>
          </div>
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <ShieldCheck size={14} className="text-lime-text" />
            Free to use. No bank login required.
          </span>
        </div>

        <Reveal immediate className="relative min-w-0 flex-[1_1_460px]">
          <div className={`${CARD} flex flex-col gap-5 p-[26px] shadow-[0_30px_80px_-30px_rgba(0,0,0,.7)]`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="eyebrow">Safe to spend · Day 16 of 30</span>
              <span className="rounded-full bg-lime-soft px-2.5 py-[3px] text-xs font-semibold text-lime-text">
                On track
              </span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="tabular font-serif text-[clamp(54px,15vw,96px)] leading-[.86] tracking-[-0.025em]">
                <CountUp rupees={16800} />
              </span>
              <span className="font-serif text-[21px] text-ink-2">
                That’s{" "}
                <em className="text-ink">
                  <CountUp rupees={1120} /> a day
                </em>{" "}
                for the next fifteen days.
              </span>
            </div>
            <DemoSplit />
            <div className="flex flex-col border-t border-line-2">
              {HERO_CATS.map(([name, spent, limit], i) => {
                const hot = spent / limit > 0.75;
                return (
                  <div key={name} className="flex flex-col gap-[7px] border-b border-line py-[11px]">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium">{name}</span>
                      <span
                        aria-hidden
                        className="flex-[1_1_24px] -translate-y-1 border-b border-dotted border-line-2"
                      />
                      <span className="tabular text-sm">
                        <strong className="font-semibold" style={{ color: hot ? "var(--warn)" : "var(--ink)" }}>
                          ₹{spent.toLocaleString("en-IN")}
                        </strong>
                        <span className="text-muted"> / ₹{limit.toLocaleString("en-IN")}</span>
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-track">
                      <div
                        className="rv-bar h-full rounded-full"
                        style={{
                          width: `${(spent / limit) * 100}%`,
                          background: hot ? "var(--warn)" : "var(--lime)",
                          transitionDuration: "1.1s",
                          transitionDelay: `${0.5 + i * 0.12}s`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            className="sf-rise absolute -bottom-6 left-[-20px] flex max-w-[calc(100%-24px)] items-center gap-2.5 rounded-[14px] border border-line-2 bg-tile-2 px-3.5 py-2.5 text-[13px] shadow-[0_30px_80px_-30px_rgba(0,0,0,.7)] max-[600px]:left-3"
            style={{ animationDelay: "1.7s" }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime text-lime-ink">
              <Repeat size={13} />
            </span>
            <span className="flex flex-col leading-[1.3]">
              <span className="font-semibold">Rent is due today</span>
              <span className="tabular text-muted">₹28,000 · 3 Nov · Record</span>
            </span>
          </div>
        </Reveal>
      </section>

      {/* How it works */}
      <section id="how" className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-[620px] flex-col gap-3">
              <span className="eyebrow">How it works</span>
              <h2 className={H2}>
                Your salary, spent in the <em>right order.</em>
              </h2>
            </div>
            <p className="m-0 max-w-[380px] text-pretty text-ink-2">
              Most budgets start with what you spent. SaveFirst starts with what you’re keeping, so overspending shows
              up before it happens.
            </p>
          </div>
          <Reveal className={`${CARD} px-[26px] py-2`}>
            {STEPS.map(([n, title, desc, left, w, color, amt, amtColor], i) => (
              <div
                key={n}
                className="flex flex-wrap items-center gap-x-8 gap-y-3.5 border-b border-line py-[22px] last:border-b-0"
              >
                <div className="flex min-w-0 flex-[1_1_260px] items-baseline gap-3.5">
                  <span className="w-[30px] font-serif text-[28px] leading-none text-muted italic">{n}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-base font-semibold">{title}</span>
                    <span className="text-sm text-pretty text-muted">{desc}</span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-[2_1_240px] items-center gap-3.5">
                  <div className="relative h-[30px] flex-1 rounded-lg bg-track">
                    <div
                      className="rv-bar absolute inset-y-0 rounded-lg"
                      style={{ left, width: w, background: color, transitionDelay: `${0.15 + i * 0.18}s` }}
                    />
                  </div>
                  <span
                    className="tabular min-w-[84px] flex-none text-right font-serif text-2xl leading-none"
                    style={{ color: amtColor }}
                  >
                    {amt}
                  </span>
                </div>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3.5 px-6 py-24">
          <div className="flex max-w-[640px] flex-col gap-3 pb-[26px]">
            <span className="eyebrow">Features</span>
            <h2 className={H2}>
              Built around how a <em>salary</em> actually behaves.
            </h2>
          </div>

          <div className="flex flex-wrap gap-3.5">
            <Reveal className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-[22px] p-7`}>
              <div className="flex flex-col gap-2">
                <span className="eyebrow text-warn">Variable pay</span>
                <h3 className="m-0 font-serif text-[34px] leading-[1.05] font-normal">
                  Bonuses wait until they’re in your bank.
                </h3>
                <p className="m-0 text-pretty text-ink-2">
                  Incentives sit on hold, outside safe-to-spend. When one arrives, split it across savings, annual bills
                  and spending in one step.
                </p>
              </div>
              <div className="mt-auto flex flex-col gap-3.5 rounded-[14px] bg-tile-2 p-[18px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
                  <span className="font-semibold">Annual performance bonus</span>
                  <span className="font-serif text-[30px] leading-none">₹60,000</span>
                </div>
                <div aria-hidden className="flex h-3 gap-[3px]">
                  {(
                    [
                      ["50%", "var(--lime)"],
                      ["30%", "var(--fixed)"],
                      ["20%", "var(--ink)"],
                    ] as const
                  ).map(([w, c], i) => (
                    <div
                      key={c}
                      className="rv-bar rounded-md"
                      style={{ width: w, background: c, transitionDelay: `${0.2 + i * 0.15}s` }}
                    />
                  ))}
                </div>
                <Legend
                  items={[
                    ["var(--lime)", "Emergency fund", "₹30,000"],
                    ["var(--fixed)", "Annual bills", "₹18,000"],
                    ["var(--ink)", "This cycle", "₹12,000"],
                  ]}
                />
              </div>
            </Reveal>

            <Reveal
              className={`${CARD} flex min-w-0 flex-[1_1_420px] flex-col gap-[22px] p-7`}
              style={{ transitionDelay: ".1s" }}
            >
              <div className="flex flex-col gap-2">
                <span className="eyebrow text-lime-text">Logging</span>
                <h3 className="m-0 font-serif text-[34px] leading-[1.05] font-normal">
                  A chai or a grocery run, in three taps.
                </h3>
              </div>
              <div aria-hidden className="mt-auto flex flex-wrap gap-[18px]">
                <ol className="m-0 flex flex-[1_1_150px] list-none flex-col p-0">
                  {["Type the amount", "Pick a category", "Save"].map((label, i) => (
                    <li
                      key={label}
                      className="flex items-baseline gap-3 border-b border-line py-2.5 transition-colors duration-300"
                      style={{ color: tap === i + 1 ? "var(--ink)" : "var(--muted)" }}
                    >
                      <span className="w-[22px] font-serif text-xl italic">{["i", "ii", "iii"][i]}</span>
                      <span className="font-medium">{label}</span>
                      <span
                        className="ml-auto h-[7px] w-[7px] rounded-full bg-lime transition-opacity duration-300"
                        style={{ opacity: tap === i + 1 ? 1 : 0 }}
                      />
                    </li>
                  ))}
                </ol>
                <div className="flex flex-[1.4_1_220px] flex-col gap-2.5 rounded-[14px] bg-tile-2 p-3.5">
                  <div
                    className="tabular flex h-12 items-center rounded-[10px] border bg-tile px-3.5 font-serif text-[30px] transition-colors duration-300"
                    style={{ borderColor: tap === 1 ? "var(--lime)" : "var(--line-2)" }}
                  >
                    <span className="mr-1.5 text-muted">₹</span>
                    {tap >= 1 ? "240" : "0"}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-[5px]">
                    {DEMO_CATS.map((name, i) => {
                      const sel = tap >= 2 && i === 1;
                      return (
                        <span
                          key={name}
                          className="flex min-h-[34px] items-center rounded-lg border px-2 py-1.5 text-xs leading-[1.2] font-semibold [overflow-wrap:anywhere] transition-colors duration-200"
                          style={{
                            background: sel ? "var(--lime-soft)" : "var(--tile-2)",
                            borderColor: sel ? "var(--lime)" : "var(--line)",
                          }}
                        >
                          {name}
                        </span>
                      );
                    })}
                  </div>
                  <div
                    className="flex h-10 items-center justify-center rounded-full text-[13px] font-bold transition-[background,transform] duration-300"
                    style={{
                      background: tap >= 3 ? "var(--lime)" : "var(--tile-2)",
                      color: tap >= 3 ? "var(--lime-ink)" : "var(--muted)",
                      transform: `scale(${tap === 3 ? 0.97 : 1})`,
                    }}
                  >
                    {tap >= 3 ? "Logged · ₹880 left today" : "Log expense"}
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          <Reveal className={`${CARD} flex flex-wrap items-center gap-x-12 gap-y-7 p-7`}>
            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-2">
              <span className="eyebrow">Warnings</span>
              <h3 className="m-0 font-serif text-[34px] leading-[1.05] font-normal">
                Hear about overspending in week two, not week four.
              </h3>
              <p className="m-0 text-pretty text-ink-2">
                SaveFirst compares your spending with where you should be today. If the pace puts your savings at risk,
                you see it while there’s time to adjust.
              </p>
            </div>
            <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-3.5">
              <div className="relative h-2.5 rounded-full bg-track">
                <div
                  className="rv-bar absolute inset-y-0 left-0 rounded-full bg-warn"
                  style={{ width: "61%", transitionDuration: "1.2s", transitionDelay: ".2s" }}
                />
                <div aria-hidden className="absolute -top-1.5 -bottom-1.5 left-[53%] w-0.5 rounded-[1px] bg-ink" />
              </div>
              <div className="tabular flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[13px] text-muted">
                <span>₹17,100 spent</span>
                <span>Expected by today ₹14,900</span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5 rounded-[14px] bg-warn-soft px-[18px] py-3.5">
                <span className="text-xs font-bold tracking-[.09em] text-warn uppercase">Note</span>
                <span className="min-w-0 flex-[1_1_200px] font-serif text-[19px]">
                  At this pace you’ll dip ₹4,200 into savings by 30 November.
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Reports */}
      <section className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-8 px-6 py-24">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-[620px] flex-col gap-3">
              <span className="eyebrow">Reports</span>
              <h2 className={H2}>
                A savings rate bonuses <em>can’t inflate.</em>
              </h2>
            </div>
            <p className="m-0 max-w-[360px] text-pretty text-ink-2">
              Monthly trends are measured against regular take-home pay. Windfalls get their own line.
            </p>
          </div>
          <Reveal className={`${CARD} overflow-hidden`}>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] border-b border-line">
              {(
                [
                  ["Avg savings rate", "28%", "var(--ink)"],
                  ["Saved this year", "₹2,94,000", "var(--lime-text)"],
                  ["Net surplus", "₹41,600", "var(--ink)"],
                ] as const
              ).map(([label, value, color]) => (
                <div
                  key={label}
                  className="-mr-px -mb-px flex flex-col gap-1 border-r border-b border-line px-[26px] py-[22px]"
                >
                  <span className="eyebrow">{label}</span>
                  <span className="font-serif text-[44px] leading-none" style={{ color }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 px-[26px] pt-[30px] pb-[18px]">
              <div
                aria-hidden
                className="flex h-[230px] items-end gap-3.5 border-b border-line-2"
                style={{ background: "linear-gradient(var(--line) 1px, transparent 1px) 0 0 / 100% 57.5px" }}
              >
                {CHART.map(([label, spend, save], i) => (
                  <div key={label} className="flex h-full flex-1 items-end justify-center gap-[5px]">
                    <span
                      className="rv-barh max-w-[30px] flex-1 rounded-t-md bg-fixed"
                      style={{ height: `${(spend / 80) * 100}%`, transitionDelay: `${i * 0.08}s` }}
                    />
                    <span
                      className="rv-barh max-w-[30px] flex-1 rounded-t-md bg-lime"
                      style={{ height: `${(save / 80) * 100}%`, transitionDelay: `${i * 0.08 + 0.1}s` }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3.5">
                {CHART.map(([label]) => (
                  <span key={label} className="flex-1 text-center font-serif text-base text-muted italic">
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex gap-[18px] pt-1 text-[13px] text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full bg-fixed" />
                  Spent
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-[9px] w-[9px] rounded-full bg-lime" />
                  Saved
                </span>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap gap-x-16 gap-y-10 px-6 py-24">
          <div className="flex flex-[1_1_280px] flex-col gap-3">
            <span className="eyebrow">FAQ</span>
            <h2 className="m-0 font-serif text-[clamp(40px,5vw,64px)] leading-none font-normal">Questions</h2>
          </div>
          <Reveal className="min-w-0 flex-[2_1_520px] border-t border-line-2">
            {FAQ.map(([q, a], i) => {
              const open = faq === i;
              return (
                <div key={q} className="border-b border-line">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setFaq(open ? -1 : i)}
                    className="flex w-full cursor-pointer items-center gap-4 border-0 bg-transparent py-[22px] text-left text-ink"
                  >
                    <span className="min-w-0 flex-1 font-serif text-[clamp(20px,5.4vw,24px)] leading-[1.15]">{q}</span>
                    <span
                      aria-hidden
                      className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-line-2 transition-transform duration-[350ms] ease-soft"
                      style={{ transform: `rotate(${open ? 45 : 0}deg)` }}
                    >
                      <Plus size={14} />
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-[350ms] ease-soft"
                    style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <p className="m-0 pr-[clamp(0px,6vw,48px)] pb-[22px] text-pretty text-ink-2">{a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </Reveal>
        </div>
      </section>

      {/* Call to action */}
      <section className="px-6 pb-24">
        <Reveal className="mx-auto flex max-w-[1152px] flex-wrap items-end justify-between gap-8 rounded-3xl bg-lime p-[clamp(36px,6vw,72px)] text-lime-ink">
          <h2 className="m-0 max-w-[680px] font-serif text-[clamp(40px,5.6vw,72px)] leading-[.98] font-normal tracking-[-0.015em] text-balance">
            Start this month with your savings <em>already set aside.</em>
          </h2>
          <Link
            href="/signup"
            className="flex min-h-[54px] items-center gap-2.5 rounded-full bg-[#0b0b0c] px-[26px] text-base font-bold text-[#f2f2ee] transition-transform duration-150 hover:-translate-y-0.5 hover:text-[#f2f2ee] active:scale-[.97]"
          >
            Create free account
            <ArrowRight size={16} />
          </Link>
        </Reveal>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-7 gap-y-3.5 px-6 py-7 text-[13px] text-muted">
          <Logo size={24} />
          <span>Savings-first budgeting for a monthly salary.</span>
          <span className="ml-auto flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/login" className="text-muted hover:text-ink">
              Sign in
            </Link>
            <Link href="/signup" className="text-muted hover:text-ink">
              Create account
            </Link>
            <span>© 2026</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
