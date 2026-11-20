"use client";

import { useEffect, useState } from "react";
import StatusPage from "@/components/StatusPage";
import { errorFields, reportClientError } from "@/lib/log.mjs";

export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reference] = useState(() => error.digest ?? `AU-${Date.now().toString(36).slice(-6).toUpperCase()}`);
  useEffect(
    () => reportClientError("page_crash", { ...errorFields(error), digest: reference, route: "/auth" }),
    [error, reference],
  );

  return (
    <StatusPage
      eyebrow="Sign in error"
      title="Something went"
      em="wrong."
      body="We couldn’t process your authentication request. Please try again."
      primary={{ label: "Try again", onRetry: reset }}
      secondary={{ label: "Sign in", href: "/login" }}
      code="500"
      cardLabel="Authentication error"
      cardNote="If you’re having trouble signing in, check your connection or try resetting your password."
      tone="danger"
      bar="62%"
      reference={reference}
    />
  );
}
