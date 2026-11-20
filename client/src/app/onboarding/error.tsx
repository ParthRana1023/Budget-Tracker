"use client";

import { useEffect, useState } from "react";
import StatusPage from "@/components/StatusPage";
import { errorFields, reportClientError } from "@/lib/log.mjs";

export default function OnboardingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reference] = useState(() => error.digest ?? `OB-${Date.now().toString(36).slice(-6).toUpperCase()}`);
  useEffect(
    () => reportClientError("page_crash", { ...errorFields(error), digest: reference, route: "/onboarding" }),
    [error, reference],
  );

  return (
    <StatusPage
      eyebrow="Setup error"
      title="Setup couldn’t"
      em="load."
      body="We ran into a problem loading the onboarding steps. You can try again or return home."
      primary={{ label: "Try again", onRetry: reset }}
      secondary={{ label: "Home", href: "/" }}
      code="500"
      cardLabel="Setup error"
      cardNote="If this keeps happening, wait a moment and try again."
      tone="danger"
      bar="62%"
      reference={reference}
    />
  );
}
