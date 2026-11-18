"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/utils/supabase/client";
import { authErrorFor, isValidEmail } from "@/lib/auth.mjs";
import {
  AuthAlert,
  AuthHeading,
  Field,
  LinkButton,
  SubmitButton,
  SwitchLine,
  useResendTimer,
  type AuthError,
} from "@/components/auth/AuthParts";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const resend = useResendTimer();

  const send = async () => {
    setError(null);
    setBusy("Sending link…");
    // The link signs them in through /auth/confirm, then opens the new-password screen.
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });
    setBusy(null);
    if (error) return setError(authErrorFor(error));
    setSent(true);
    resend.start();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isValidEmail(email)) return setError({ message: "Enter the email you signed up with." });
    send();
  };

  return (
    <>
      <AuthHeading eyebrow="Reset password" title="Forgot it?" em="Happens.">
        {sent
          ? `If ${email.trim()} has an account, a reset link is on its way. It works for 30 minutes.`
          : "Enter the email you signed up with and we’ll send a link to set a new password."}
      </AuthHeading>
      {error && <AuthAlert error={error} />}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {!sent && (
          <Field
            label="Email"
            id="forgot-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <SubmitButton busy={busy} label={sent ? "Send it again" : "Email me a reset link"} />
      </form>
      {sent && (
        <span className="text-sm text-muted">
          Didn’t get it?{" "}
          <LinkButton disabled={resend.left > 0} onClick={send}>
            {resend.label}
          </LinkButton>
        </span>
      )}
      <SwitchLine text="Remembered it?" href="/login" link="Back to sign in" />
    </>
  );
}
