"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { authErrorFor } from "@/lib/auth.mjs";
import { AuthAlert, AuthHeading, ConfirmPasswordField, PasswordField, SubmitButton, SwitchLine, type AuthError } from "@/components/auth/AuthParts";

/** Reached from the reset email (already signed in by /auth/confirm); the proxy keeps everyone else out. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 6) return setError({ message: "Use at least 6 characters for your password." });
    if (password !== confirm) return setError({ message: "The two passwords don’t match." });
    setError(null);
    setBusy("Saving password…");
    const { error } = await createClient().auth.updateUser({ password });
    if (error) {
      setBusy(null);
      return setError(authErrorFor(error));
    }
    // They stay signed in on this device, so go straight to the dashboard.
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <>
      <AuthHeading eyebrow="New password" title="Choose a" em="new one.">
        You’ll stay signed in on this device after saving.
      </AuthHeading>
      {error && <AuthAlert error={error} />}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <PasswordField
          id="reset-password"
          value={password}
          onChange={setPassword}
          show={showPw}
          onToggle={() => setShowPw((s) => !s)}
          autoComplete="new-password"
          placeholder="At least 6 characters"
          strength
        />
        <ConfirmPasswordField id="reset-confirm-password" value={confirm} password={password} onChange={setConfirm} show={showPw} />
        <SubmitButton busy={busy} label="Save new password" />
      </form>
      <SwitchLine text="Remembered it?" href="/login" link="Back to sign in" />
    </>
  );
}
