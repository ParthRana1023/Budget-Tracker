"use client";

// Settings › Security (design handoff v2): signed-in devices (sign one out, or all others)
// and the latest sign-in attempts, failed ones in red.

import { useCallback, useEffect, useState } from "react";
import { Laptop, Smartphone } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { deviceName, isMobile, listSessions, revokeSession, signInHistory, signOutOthers } from "@/lib/settings.mjs";
import { useToast } from "../ui/Toast";
import { BTN_LINE, BTN_LINK, Card, SectionHead, ago } from "./parts";

type Session = { id: string; user_agent: string | null; city: string | null; last_active: string; current: boolean };
type SignIn = {
  id: string;
  created_at: string;
  method: string;
  success: boolean;
  user_agent: string | null;
  city: string | null;
};
const METHOD: Record<string, string> = {
  password: "Password",
  google: "Google",
  code: "Email code",
  link: "Email link",
};
const SHOWN = 5;
const FAILED = "Couldn’t reach SaveFirst. Check your connection and try again.";

export default function SecuritySection({ onChangePassword }: { onChangePassword: () => void }) {
  const toast = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [history, setHistory] = useState<SignIn[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = createClient();
    const [s, h] = await Promise.all([listSessions(db), signInHistory(db)]);
    setFailed(!!(s.error || h.error));
    if (!s.error) setSessions(s.data);
    if (!h.error) setHistory(h.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const end = async (id: string | "others") => {
    setBusy(id);
    const db = createClient();
    const { error } = id === "others" ? await signOutOthers(db) : await revokeSession(db, id);
    setBusy(null);
    if (error) return toast(FAILED, { error: true });
    toast(id === "others" ? "Signed out of every other device" : "That device is signed out");
    await load();
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;
  const shown = all ? history : history?.slice(0, SHOWN);
  return (
    <>
      <SectionHead title="Security" lede="Where you’re signed in, and every recent sign-in." />
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <span className="flex-1">{FAILED}</span>
          <button type="button" onClick={load} className={`${BTN_LINK} text-danger`}>
            Try again
          </button>
        </div>
      )}
      <Card>
        {sessions === null && !failed && <span className="px-6 py-5 text-sm text-muted">Loading your devices…</span>}
        {sessions?.map((s) => {
          const Icon = isMobile(s.user_agent) ? Smartphone : Laptop;
          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-6 py-[18px] max-[480px]:px-[18px]"
              data-testid="session-row"
            >
              <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-xl bg-tile-2 text-ink-2">
                <Icon size={17} />
              </span>
              <div className="flex min-w-0 flex-[1_1_220px] flex-col">
                <span className="text-sm font-semibold">{deviceName(s.user_agent)}</span>
                <span className="text-[13px] text-muted">
                  {s.city ?? "Location unknown"} · {s.current ? "this device" : ago(s.last_active)}
                </span>
              </div>
              {s.current ? (
                <span className="flex h-[26px] items-center rounded-full bg-lime-soft px-2.5 text-xs font-bold text-lime-text">
                  This device
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => end(s.id)}
                  disabled={!!busy}
                  aria-label={`Sign out ${deviceName(s.user_agent)}`}
                  className={`${BTN_LINE} h-[34px] px-3.5`}
                >
                  {busy === s.id ? "Signing out…" : "Sign out"}
                </button>
              )}
            </div>
          );
        })}
      </Card>
      {sessions &&
        (others > 0 ? (
          <button
            type="button"
            onClick={() => end("others")}
            disabled={!!busy}
            className={`${BTN_LINE} h-[42px] self-start px-[18px] text-sm`}
          >
            {busy === "others" ? "Signing out…" : "Sign out of all other devices"}
          </button>
        ) : (
          <span className="text-[13px] text-muted">Only this device is signed in.</span>
        ))}

      <div className="flex flex-col gap-2.5 pt-2.5">
        <h3 className="eyebrow m-0">Sign-in history</h3>
        <Card>
          {history?.length === 0 && <span className="px-6 py-3.5 text-sm text-muted">No sign-ins recorded yet.</span>}
          {shown?.map((e) => {
            const d = new Date(e.created_at);
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3.5 max-[480px]:px-[18px]">
                <span className="tabular flex-[0_0_150px] text-[13px] text-muted">
                  {d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·{" "}
                  {d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <div className="flex min-w-0 flex-[1_1_200px] flex-col">
                  <span className="text-sm font-semibold">{deviceName(e.user_agent)}</span>
                  <span className="text-[13px] text-muted">
                    {e.city ?? "Location unknown"} · {METHOD[e.method] ?? e.method}
                  </span>
                </div>
                <span
                  className="rounded-full px-[9px] py-[3px] text-xs font-bold"
                  style={{
                    background: e.success ? "var(--tile-2)" : "var(--danger-soft)",
                    color: e.success ? "var(--ink-2)" : "var(--danger)",
                  }}
                >
                  {e.success ? "Signed in" : "Failed attempt"}
                </span>
              </div>
            );
          })}
        </Card>
        {(history?.length ?? 0) > SHOWN && (
          <button type="button" onClick={() => setAll(!all)} className={`${BTN_LINK} self-start`}>
            {all ? "Show fewer" : `Show all ${history!.length}`}
          </button>
        )}
        <span className="text-[13px] text-muted">
          Don’t recognise one?{" "}
          <button type="button" onClick={onChangePassword} className={BTN_LINK}>
            Change your password
          </button>{" "}
          and sign out of other devices.
        </span>
      </div>
    </>
  );
}
