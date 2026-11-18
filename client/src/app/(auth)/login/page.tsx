"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { authErrorFor, errorFromQuery, isValidEmail } from "@/lib/auth.mjs";
import {
  AuthAlert,
  AuthHeading,
  AuthNotice,
  Field,
  GoogleButton,
  LinkButton,
  OtpInput,
  PasswordField,
  SubmitButton,
  SwitchLine,
  type AuthError,
} from "@/components/auth/AuthParts";

type Mode = "password" | "magic";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [otp, setOtp] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(() => errorFromQuery(params.get("error")));

  const toDashboard = () => {
    router.push("/dashboard");
    router.refresh();
  };
  const fail = (e: AuthError) => {
    setBusy(null);
    setError(e);
  };
  const sendLink = async () => {
    setBusy("Sending link…");
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard` },
    });
    if (error) return fail(authErrorFor(error));
    setBusy(null);
    setOtp("");
    setLinkSent(true);
  };
  const verify = async (code: string) => {
    setBusy("Verifying…");
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ email: email.trim(), token: code, type: "email" });
    if (error) return fail(authErrorFor(error));
    toDashboard();
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === "password") {
      if (!isValidEmail(email)) return setError({ message: "Enter the email you signed up with." });
      if (!password) return setError({ message: "Enter your password." });
      setBusy("Signing in…");
      const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (error) return fail(authErrorFor(error));
      return toDashboard();
    }
    if (!linkSent) {
      if (!isValidEmail(email)) return setError({ message: "Enter your email to get a sign-in link." });
      return sendLink();
    }
    if (otp.length < 6) return setError({ message: "Enter all 6 digits from the email." });
    return verify(otp);
  };

  const onAction = async (action: NonNullable<AuthError["action"]>) => {
    if (action === "forgot") return router.push("/forgot-password");
    if (action === "resend") {
      setError(null);
      return sendLink();
    }
    // Unconfirmed email: send a fresh confirmation, then take them to enter its code.
    setBusy("Sending link…");
    const { error } = await createClient().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard` },
    });
    if (error) return fail(authErrorFor(error));
    router.push(`/verify?email=${encodeURIComponent(email.trim())}`);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setLinkSent(false);
    setOtp("");
  };
  const magic = mode === "magic";

  return (
    <>
      <AuthHeading eyebrow="Sign in" title="Welcome" em="back.">
        Sign in to see today’s safe-to-spend.
      </AuthHeading>
      <GoogleButton onError={setError} />
      <div role="tablist" aria-label="Sign-in method" className="flex gap-0.5 rounded-full border border-line p-[3px]">
        {(
          [
            ["password", "Password"],
            ["magic", "Email link"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className="h-[34px] flex-1 cursor-pointer rounded-full border-0 text-[13px] font-semibold transition-colors duration-200"
            style={{
              background: mode === m ? "var(--tile-2)" : "transparent",
              color: mode === m ? "var(--ink)" : "var(--muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <AuthAlert error={error} onAction={onAction} />}
      {magic && linkSent && !error && (
        <AuthNotice>Link sent to {email.trim()}. Open it, or enter the 6-digit code.</AuthNotice>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {!(magic && linkSent) && (
          <Field
            label="Email"
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        {!magic && (
          <PasswordField
            id="password"
            value={password}
            onChange={setPassword}
            show={showPw}
            onToggle={() => setShowPw((s) => !s)}
            autoComplete="current-password"
            placeholder="Your password"
            forgotHref="/forgot-password"
          />
        )}
        {magic && linkSent && <OtpInput value={otp} onChange={setOtp} onComplete={verify} />}
        <SubmitButton
          id="login-submit-btn"
          busy={busy}
          label={!magic ? "Sign in" : linkSent ? "Verify and continue" : "Email me a sign-in link"}
        />
      </form>

      {magic && linkSent && (
        <LinkButton muted onClick={() => switchMode("magic")}>
          Use a different email
        </LinkButton>
      )}
      <SwitchLine text="New to SaveFirst?" href="/signup" link="Create an account" />
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
