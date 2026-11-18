"use client";

// Building blocks of the sign-in screens (design handoff, Landing and Auth).

import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { CircleAlert, Eye, EyeOff, MailCheck } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { PASSWORD_HINTS, passwordScore } from "@/lib/auth.mjs";

export type AuthError = { message: string; action?: "forgot" | "verify" | "resend" };

const INPUT =
  "h-[50px] w-full rounded-xl border bg-tile px-4 text-[15px] text-ink outline-none transition-[border-color,box-shadow] duration-200 focus:shadow-[0_0_0_3px_var(--lime-soft)] focus-visible:outline-none";

export function AuthHeading({ eyebrow, title, em, children }: { eyebrow: string; title: string; em: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="eyebrow">{eyebrow}</span>
      <h1 className="m-0 font-serif text-[clamp(40px,12vw,52px)] leading-[.95] font-normal tracking-[-0.015em]">
        {title} <em>{em}</em>
      </h1>
      {children && <p className="m-0 text-pretty text-ink-2">{children}</p>}
    </div>
  );
}

export function VerifyHeading({ email }: { email: string }) {
  return (
    <div className="flex flex-col gap-3.5">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lime text-lime-ink">
        <MailCheck size={20} />
      </span>
      <h1 className="m-0 font-serif text-[clamp(40px,12vw,52px)] leading-[.95] font-normal tracking-[-0.015em]">
        Check your <em>inbox.</em>
      </h1>
      <p className="m-0 text-pretty text-ink-2">
        We sent a confirmation link and a 6-digit code to <strong className="font-semibold text-ink">{email || "your email"}</strong>.
      </p>
    </div>
  );
}

export function Field({ label, id, ...input }: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <input id={id} className={clsx(INPUT, "border-line-2 focus:border-lime")} {...input} />
    </div>
  );
}

/** Password with show/hide, and optionally the strength meter or a "Forgot password?" link. */
export function PasswordField({
  id,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  placeholder,
  strength = false,
  forgotHref,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder: string;
  strength?: boolean;
  forgotHref?: string;
}) {
  const score = passwordScore(value);
  const color = score <= 1 ? "var(--danger)" : score === 2 ? "var(--warn)" : "var(--lime)";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="eyebrow">
        Password
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={clsx(INPUT, "border-line-2 pr-[50px] focus:border-lime")}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute top-[5px] right-[5px] flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted hover:text-ink"
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {forgotHref && (
        <Link href={forgotHref} className="self-end py-0.5 text-[13px] font-semibold text-lime-text hover:text-ink">
          Forgot password?
        </Link>
      )}
      {strength && (
        <div className="flex items-center gap-2.5 pt-0.5">
          <div aria-hidden className="grid flex-1 grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-1 rounded-full transition-colors duration-300" style={{ background: value && i < score ? color : "var(--track)" }} />
            ))}
          </div>
          <span className="text-right text-xs whitespace-nowrap text-muted">{PASSWORD_HINTS[value ? score : 0]}</span>
        </div>
      )}
    </div>
  );
}

export function ConfirmPasswordField({ id, value, password, onChange, show }: { id: string; value: string; password: string; onChange: (v: string) => void; show: boolean }) {
  const match = value ? value === password : null;
  const border = match === false && value.length >= password.length ? "var(--danger)" : match ? "var(--lime)" : "var(--line-2)";
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="eyebrow">
        Confirm password
      </label>
      <input
        id={id}
        type={show ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type it again"
        className={INPUT}
        style={{ borderColor: border }}
      />
      {match !== null && (
        <span className="text-xs" style={{ color: match ? "var(--lime-text)" : "var(--muted)" }}>
          {match ? "Passwords match" : "Doesn’t match yet"}
        </span>
      )}
    </div>
  );
}

/** Six code boxes over one invisible input (so paste and one-time-code autofill work). Calls onComplete at 6 digits. */
export function OtpInput({ value, onChange, onComplete }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void }) {
  const [focus, setFocus] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="s-otp" className="eyebrow">
        6-digit code
      </label>
      <div className="relative">
        <input
          id="s-otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={value}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            onChange(v);
            if (v.length === 6) onComplete(v);
          }}
          className="absolute inset-0 z-[1] h-full w-full cursor-text text-base opacity-0"
        />
        <div aria-hidden className="grid grid-cols-6 gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const active = focus && i === Math.min(value.length, 5);
            return (
              <span
                key={i}
                className="flex h-[60px] items-center justify-center rounded-xl border bg-tile font-serif text-[34px] [font-variant-numeric:lining-nums] transition-[border-color,box-shadow,transform] duration-150"
                style={{
                  borderColor: active ? "var(--lime)" : value[i] ? "var(--line-2)" : "var(--line)",
                  boxShadow: active ? "0 0 0 3px var(--lime-soft)" : "none",
                  transform: value[i] && i === value.length - 1 ? "scale(1.04)" : "none",
                }}
              >
                {value[i] ?? ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL = { forgot: "Reset password", verify: "Send a new link", resend: "Send a new code" };

export function AuthAlert({ error, onAction }: { error: AuthError; onAction?: (a: NonNullable<AuthError["action"]>) => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
      <CircleAlert size={14} className="mt-[3px] flex-none" />
      <span className="flex flex-1 flex-col gap-1.5">
        {error.message}
        {error.action && onAction && (
          <button
            type="button"
            onClick={() => onAction(error.action!)}
            className="cursor-pointer self-start border-0 bg-transparent p-0 text-sm font-bold text-danger underline underline-offset-[3px]"
          >
            {ACTION_LABEL[error.action]}
          </button>
        )}
      </span>
    </div>
  );
}

export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-xl bg-lime-soft px-4 py-3 text-sm font-medium text-lime-text">
      {children}
    </div>
  );
}

/** Primary submit; while busy it shows a spinner and the busy text ("Signing in…"). */
export function SubmitButton({ id, busy, label }: { id?: string; busy: string | null; label: string }) {
  return (
    <button
      id={id}
      type="submit"
      disabled={!!busy}
      className="mt-1 flex h-[52px] cursor-pointer items-center justify-center gap-2.5 rounded-full border-0 bg-lime text-[15px] font-bold text-lime-ink transition-[transform,box-shadow,opacity] duration-200 hover:-translate-y-px hover:shadow-[0_12px_28px_-12px_var(--lime)] active:scale-[.98] disabled:opacity-75"
    >
      {busy && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {busy ?? label}
    </button>
  );
}

/** "New to SaveFirst? Create an account" style line under the form. */
export function SwitchLine({ text, href, link }: { text: string; href: string; link: string }) {
  return (
    <p className="m-0 border-t border-line pt-5 text-sm text-muted">
      {text}{" "}
      <Link href={href} className="font-semibold text-lime-text hover:text-ink">
        {link}
      </Link>
    </p>
  );
}

/** Text button for small actions under the form ("Resend email", "Use a different email"). */
export function LinkButton({ children, disabled, onClick, muted }: { children: ReactNode; disabled?: boolean; onClick: () => void; muted?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "cursor-pointer border-0 bg-transparent p-0 disabled:cursor-default",
        muted ? "text-sm text-muted hover:text-ink" : "font-semibold text-lime-text disabled:text-muted",
      )}
    >
      {children}
    </button>
  );
}

/** Seconds left before "Resend" is allowed again (30s after each send). */
export function useResendTimer(startNow = false) {
  const [left, setLeft] = useState(startNow ? 30 : 0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, start: () => setLeft(30), label: left > 0 ? `Resend in 0:${String(left).padStart(2, "0")}` : "Resend email" };
}

// Shown only once the Google provider is set up in Supabase (and a Google Cloud OAuth client exists).
const GOOGLE_ON = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";

/** "Continue with Google" + the "or" divider. Renders nothing until NEXT_PUBLIC_GOOGLE_AUTH=1. */
export function GoogleButton({ onError }: { onError: (e: AuthError) => void }) {
  const [opening, setOpening] = useState(false);
  if (!GOOGLE_ON) return null;
  const go = async () => {
    setOpening(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (error) {
      setOpening(false);
      onError({ message: "Google sign-in was cancelled before it finished. Try again, or use your email." });
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={go}
        className="flex h-12 cursor-pointer items-center justify-center gap-2.5 rounded-full border border-line-2 bg-transparent text-[15px] font-semibold transition-[border-color,transform] duration-200 hover:border-ink-2 active:scale-[.98]"
      >
        <svg aria-hidden width="16" height="16" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {opening ? "Opening Google…" : "Continue with Google"}
      </button>
      <div className="flex items-center gap-3 font-serif text-[17px] text-muted italic">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
