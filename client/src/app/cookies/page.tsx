import type { Metadata } from "next";
import { StatusShell } from "@/components/StatusPage";

export const metadata: Metadata = { title: "Cookies & storage · SaveFirst" };

type Row = [name: string, purpose: string, kept: string];

// Everything SaveFirst stores in the browser (keep in step with lib/consent.mjs and the *_KEY
// constants). Plain on purpose until the design handoff restyles it.
const NECESSARY: Row[] = [
  ["sb-…-auth-token", "Keeps you signed in (Supabase). Split into .0/.1 when long.", "Until you sign out"],
  ["sb-…-auth-token-code-verifier", "Finishes a Google or email-link sign-in.", "A few minutes"],
  ["sf_consent", "Your cookie choice, so we don't ask again.", "180 days"],
];
const SETTINGS: Row[] = [
  ["sf-theme-d (savefirst-theme)", "Light, dark or system theme.", "Until cleared"],
  ["sf-ledger-open", "Whether the ledger is open.", "Until cleared"],
  ["sf-notices-hidden", "Whether notices are hidden.", "Until cleared"],
  ["sf-notes-off", "Notices you dismissed.", "Until cleared"],
  ["sf-last-method", "Payment method you used last, picked first next time.", "Until cleared"],
  ["sf-visits, sf-install-dismissed, sf-installed", "When to offer installing the app.", "Until cleared"],
  ["sf-visit-counted (session storage)", "Counts a visit once per tab.", "Until the tab closes"],
  ["Service worker cache", "App files and the offline page. Never your money or entries.", "Until the next update"],
];
const ANALYTICS: Row[] = [
  [
    "Vercel Analytics, Speed Insights",
    "Anonymous page views and load times. No cookies, no ads, nothing sold. Only after you accept.",
    "Not stored in your browser",
  ],
];

function Table({ title, note, rows }: { title: string; note: string; rows: Row[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[18px] font-bold text-ink">{title}</h2>
      <p className="text-[14px] text-ink-2">{note}</p>
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-line-2 text-muted">
            <th className="py-2 pr-4 font-semibold">Name</th>
            <th className="py-2 pr-4 font-semibold">What it does</th>
            <th className="py-2 font-semibold">Kept</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, purpose, kept]) => (
            <tr key={name} className="border-b border-line align-top">
              <td className="py-2.5 pr-4 font-mono text-[13px] text-ink">{name}</td>
              <td className="py-2.5 pr-4 text-ink-2">{purpose}</td>
              <td className="py-2.5 whitespace-nowrap text-muted">{kept}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function CookiesPage() {
  return (
    <StatusShell>
      <div className="flex w-full max-w-[760px] flex-col gap-8">
        <div className="flex flex-col gap-3">
          <span className="eyebrow">Cookies &amp; storage</span>
          <h1 className="text-[32px] leading-tight font-bold text-ink">What SaveFirst keeps in your browser</h1>
          <p className="text-[15px] text-ink-2">
            SaveFirst uses only what it needs to sign you in and remember your settings. Analytics stays off unless
            you turn it on, and you can change that any time in Settings.
          </p>
        </div>
        <Table title="Necessary" note="Always on: the app can't sign you in without these." rows={NECESSARY} />
        <Table
          title="Your settings"
          note="Choices you make on this device, kept in local storage. Part of Necessary."
          rows={SETTINGS}
        />
        <Table title="Analytics" note="Off until you accept." rows={ANALYTICS} />
      </div>
    </StatusShell>
  );
}
