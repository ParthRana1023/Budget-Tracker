"use client";

// Account (design handoff v2): the unverified-email banner, Password and Linked accounts.
// Email change lives in ProfileSection. All of it goes through Supabase Auth.

import { useEffect, useState, type FormEvent } from "react";
import { MailWarning } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import type { UserIdentity } from "@supabase/supabase-js";
import { authErrorFor } from "@/lib/auth.mjs";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import { BTN_LINE, INPUT, SectionHead } from "./parts";

export const GOOGLE_ON = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";
const COOLDOWN = 30;
const confirmUrl = () => `${window.location.origin}/auth/confirm?next=/settings/account`;

/** "Verify your email" with Resend (30-second cooldown, counting down). */
export function VerifyBanner({ email }: { email: string }) {
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const left = sentAt ? Math.max(0, COOLDOWN - Math.floor((now - sentAt) / 1000)) : 0;
  useEffect(() => {
    if (!left) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [left]);

  const resend = async () => {
    if (left) return;
    setError(null);
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: confirmUrl() },
    });
    if (error) {
      reportClientError("verify_resend_failed", { ...errorFields(error) });
      return setError(authErrorFor(error).message);
    }
    setSentAt(Date.now());
    setNow(Date.now());
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[14px] border border-[color-mix(in_oklch,var(--warn)_35%,transparent)] bg-warn-soft px-[18px] py-3.5"
    >
      <MailWarning size={18} className="flex-none text-warn" />
      <div className="flex flex-[1_1_240px] flex-col gap-0.5">
        <span className="text-sm font-bold">Verify your email</span>
        <span className="text-[13px] text-pretty text-ink-2">
          {error ??
            (sentAt
              ? `We sent a new link to ${email}. It can take a minute to arrive; check spam too.`
              : `We sent a link to ${email} when you signed up. Open it to confirm the address is yours.`)}
        </span>
      </div>
      <button
        type="button"
        onClick={resend}
        disabled={left > 0}
        className={`${BTN_LINE} bg-tile font-bold whitespace-nowrap`}
      >
        {left > 0 ? `Resend in ${left}s` : sentAt ? "Resend again" : "Resend link"}
      </button>
    </div>
  );
}

/** Account › Password: current, new, confirm; other devices are signed out after a change. */
export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError(null);
    setDone(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = !form.current
      ? "Enter your current password."
      : form.next.length < 8
        ? "New password needs at least 8 characters."
        : form.next !== form.confirm
          ? "The new passwords don’t match."
          : null;
    if (problem) return setError(problem);
    setBusy(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current: form.current, next: form.next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      reportClientError("password_change_request_failed", { status: res?.status });
      return setError(body?.error?.message ?? body?.error ?? "Couldn’t change your password. Check your connection and try again.");
    }
    setForm({ current: "", next: "", confirm: "" });
    setDone(true);
  };

  if (!hasPassword)
    return (
      <>
        <SectionHead title="Password" lede="You sign in with Google, so there’s no password to change." />
        <a href="/forgot-password" className="text-[13px] font-semibold">
          Set a password by email instead
        </a>
      </>
    );
  const fields = [
    ["Current password", "current", "current-password"],
    ["New password", "next", "new-password"],
    ["Confirm new password", "confirm", "new-password"],
  ] as const;
  return (
    <>
      <SectionHead title="Password" lede="Changing it signs you out everywhere else." />
      <form
        onSubmit={submit}
        noValidate
        className="flex max-w-[520px] flex-col gap-4 rounded-[18px] border border-line bg-tile p-6 max-[480px]:p-[18px]"
      >
        {fields.map(([label, k, ac]) => (
          <label key={k} className="flex flex-col gap-1.5 text-sm font-semibold">
            {label}
            <input
              type="password"
              autoComplete={ac}
              value={form[k]}
              onChange={set(k)}
              className={`${INPUT} font-normal`}
            />
          </label>
        ))}
        <span className="text-[13px] text-muted">At least 8 characters.</span>
        {error && (
          <span role="alert" className="text-[13px] font-semibold text-danger">
            {error}
          </span>
        )}
        {done && (
          <span role="status" className="text-[13px] font-semibold text-lime-text">
            ✓ Password changed. Other devices have been signed out.
          </span>
        )}
        <button
          type="submit"
          disabled={busy}
          className="h-[46px] cursor-pointer self-start rounded-full border-0 bg-lime px-5 text-sm font-bold text-lime-ink disabled:opacity-60"
        >
          {busy ? "Changing…" : "Change password"}
        </button>
        <a href="/forgot-password" className="text-[13px] font-semibold">
          Forgot your current password?
        </a>
      </form>
    </>
  );
}

/** Account › Linked accounts: link or unlink Google (not when it's the only way in). */
export function GoogleSection({ email }: { email: string }) {
  const [ids, setIds] = useState<UserIdentity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data, error } = await createClient().auth.getUserIdentities();
    if (error) {
      reportClientError("load_identities_failed", { ...errorFields(error) });
      return setError("Couldn’t load your linked accounts. Reload to try again.");
    }
    setIds(data.identities);
  };
  useEffect(() => {
    void load();
  }, []);

  const google = ids?.find((i) => i.provider === "google");
  const only = !!google && (ids?.length ?? 0) < 2;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    const db = createClient();
    if (!google) {
      const { error } = await db.auth.linkIdentity({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings/account&linked=1` },
      });
      if (error) {
        reportClientError("google_link_failed", { ...errorFields(error) });
        setBusy(false);
        setError("Couldn’t start linking Google. Try again.");
      }
      return; // the browser goes to Google and back
    }
    const { error } = await db.auth.unlinkIdentity(google);
    setBusy(false);
    if (error) {
      reportClientError("google_unlink_failed", { ...errorFields(error) });
      return setError("Couldn’t unlink Google. Try again.");
    }
    await load();
  };

  return (
    <>
      <SectionHead title="Linked accounts" lede="Sign in with Google instead of a password." />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[18px] border border-line bg-tile px-6 py-5">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-tile-2 text-base font-bold">
          G
        </span>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col">
          <span className="text-sm font-semibold">Google</span>
          <span className="text-[13px] text-muted">
            {ids === null
              ? "Checking…"
              : google
                ? `Linked · ${google.identity_data?.email ?? email}${only ? " · your only way to sign in" : ""}`
                : "Not linked"}
          </span>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy || ids === null || only}
          className={
            google
              ? `${BTN_LINE} font-bold`
              : "h-[38px] cursor-pointer rounded-full border-0 bg-lime px-4 text-[13px] font-bold text-lime-ink disabled:opacity-60"
          }
        >
          {busy ? "Working…" : google ? "Unlink" : "Link Google"}
        </button>
        {error && (
          <span role="alert" className="basis-full text-[13px] font-semibold text-danger">
            {error}
          </span>
        )}
      </div>
      {only && (
        <span className="text-[13px] text-muted">
          Set a password first (Account › Password) before unlinking Google, or you couldn’t sign in.
        </span>
      )}
    </>
  );
}
