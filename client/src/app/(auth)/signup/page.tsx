"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { authErrorFor, isValidEmail } from "@/lib/auth.mjs";
import {
  AuthAlert,
  AuthHeading,
  ConfirmPasswordField,
  Field,
  GoogleButton,
  PasswordField,
  SubmitButton,
  SwitchLine,
  type AuthError,
} from "@/components/auth/AuthParts";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isValidEmail(email)) return setError({ message: "Enter a valid email address." });
    if (password.length < 6) return setError({ message: "Use at least 6 characters for your password." });
    if (password !== confirm) return setError({ message: "The two passwords don’t match." });
    setError(null);
    setBusy("Creating account…");
    const { data, error } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard` },
    });
    if (error) {
      setBusy(null);
      return setError(authErrorFor(error));
    }
    // Signed in straight away when email confirmation is off; otherwise confirm first.
    if (data.session) {
      router.push("/dashboard");
      router.refresh();
    } else {
      router.push(`/verify?email=${encodeURIComponent(email.trim())}`);
    }
  };

  return (
    <>
      <AuthHeading eyebrow="Create account" title="Pay yourself" em="first.">
        Takes a minute. Your first cycle starts today.
      </AuthHeading>
      <GoogleButton onError={setError} />
      {error && <AuthAlert error={error} />}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field
          label="Email"
          id="signup-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          id="signup-password"
          value={password}
          onChange={setPassword}
          show={showPw}
          onToggle={() => setShowPw((s) => !s)}
          autoComplete="new-password"
          placeholder="At least 6 characters"
          strength
        />
        <ConfirmPasswordField
          id="signup-confirm-password"
          value={confirm}
          password={password}
          onChange={setConfirm}
          show={showPw}
        />
        <SubmitButton id="signup-submit-btn" busy={busy} label="Create account" />
      </form>
      <SwitchLine text="Already have an account?" href="/login" link="Sign in" />
    </>
  );
}
