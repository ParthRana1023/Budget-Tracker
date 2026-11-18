"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { authErrorFor } from "@/lib/auth.mjs";
import {
  AuthAlert,
  LinkButton,
  OtpInput,
  SubmitButton,
  VerifyHeading,
  useResendTimer,
  type AuthError,
} from "@/components/auth/AuthParts";

/** After sign-up: enter the 6-digit code from the confirmation email (or open its link). */
function VerifyForm() {
  const router = useRouter();
  const email = useSearchParams().get("email")?.trim() ?? "";
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<AuthError | null>(null);
  const resend = useResendTimer(true);

  const verify = async (code: string) => {
    if (!email) return setError({ message: "Open the link in the email, or sign up again to get a new code." });
    setBusy("Verifying…");
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      setBusy(null);
      return setError(authErrorFor(error));
    }
    router.push("/dashboard");
    router.refresh();
  };
  const sendAgain = async () => {
    setError(null);
    setOtp("");
    resend.start();
    const { error } = await createClient().auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard` },
    });
    if (error) setError(authErrorFor(error));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (otp.length < 6) return setError({ message: "Enter all 6 digits from the email." });
    verify(otp);
  };

  return (
    <>
      <VerifyHeading email={email} />
      {error && <AuthAlert error={error} onAction={() => sendAgain()} />}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <OtpInput value={otp} onChange={setOtp} onComplete={verify} />
        <SubmitButton busy={busy} label="Verify email" />
      </form>
      <div className="flex flex-col gap-2 text-sm text-muted">
        <span>
          Didn’t get it?{" "}
          <LinkButton disabled={resend.left > 0 || !email} onClick={sendAgain}>
            {resend.label}
          </LinkButton>
        </span>
        <span>
          Wrong address?{" "}
          <Link href="/signup" className="font-semibold text-lime-text hover:text-ink">
            Change email
          </Link>
        </span>
      </div>
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
