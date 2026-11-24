import { StatusShell } from "@/components/StatusPage";

const STEPS = [
  "Confirming your salary",
  "Setting aside savings",
  "Reserving fixed bills",
  "Working out today’s number",
];
// Decorative split of the pay-yourself-first bar: savings, fixed bills, spent, safe.
const SEGS: Array<[string, string]> = [
  ["31.6%", "var(--lime)"],
  ["37.2%", "var(--fixed)"],
  ["13.6%", "var(--flex)"],
  ["17.6%", "var(--ink)"],
];
/** Seconds per step. */
const STEP = 0.7;

/**
 * Shown while the dashboard's data loads (design handoff, Status Pages → Loading). Pure CSS: it
 * arrives before the page's JavaScript, so a timer in React would sit still until the dashboard
 * replaced it. Each step finishes STEP seconds after the last (globals.css sf-late / sf-gone /
 * sf-step-*); styles here are the finished state, which reduced motion shows straight away.
 */
export default function DashboardLoading() {
  const done = (i: number) => `${(i + 1) * STEP}s`;
  return (
    <StatusShell>
      <div role="status" aria-live="polite" className="flex w-full max-w-[520px] flex-col gap-[22px]">
        <span className="eyebrow">Loading your cycle</span>
        <h1 className="m-0 grid font-serif text-[clamp(44px,9vw,72px)] leading-[.95] font-normal tracking-[-0.02em] text-balance">
          <span className="col-start-1 row-start-1 opacity-0" style={{ animation: `sf-gone ${done(3)} both` }}>
            Paying yourself first…
          </span>
          <span aria-hidden className="col-start-1 row-start-1" style={{ animation: `sf-late ${done(3)} both` }}>
            Almost there.
          </span>
        </h1>
        <div aria-hidden className="flex h-3.5 gap-[3px]">
          {SEGS.map(([w, c], i) => (
            <span
              key={c}
              className="rounded-md"
              style={{ width: w, background: c, animation: `sf-grow ${STEP}s var(--ease-soft) ${done(i)} both` }}
            />
          ))}
        </div>
        <ol className="m-0 flex list-none flex-col border-t border-line-2 p-0">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className="flex items-center gap-3 border-b border-line py-3 text-ink"
              style={{ animation: `sf-step-ink ${done(i)} both` }}
            >
              <span
                aria-hidden
                className="h-2 w-2 flex-none rounded-full bg-lime"
                style={{ animation: `sf-step-dot ${done(i)} both` }}
              />
              <span className="flex-1 font-medium">{label}</span>
              <span aria-hidden className="grid justify-items-end font-serif text-[17px] text-muted italic">
                {/* "working" from the step's start to its end, then "done". */}
                <span className="col-start-1 row-start-1" style={{ animation: `sf-late ${i * STEP}s both` }}>
                  <span className="opacity-0" style={{ animation: `sf-gone ${done(i)} both` }}>
                    working
                  </span>
                </span>
                <span className="col-start-1 row-start-1" style={{ animation: `sf-late ${done(i)} both` }}>
                  done
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </StatusShell>
  );
}
