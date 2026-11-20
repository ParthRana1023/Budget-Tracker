"use client";

import { useEffect, useState } from "react";
import StatusPage from "@/components/StatusPage";
import { errorFields, reportClientError } from "@/lib/log.mjs";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reference] = useState(() => error.digest ?? `DB-${Date.now().toString(36).slice(-6).toUpperCase()}`);
  useEffect(
    () => reportClientError("page_crash", { ...errorFields(error), digest: reference, route: "/dashboard" }),
    [error, reference],
  );

  return (
    <StatusPage
      eyebrow="Dashboard error"
      title="Couldn’t load"
      em="your numbers."
      body="We ran into a problem loading your dashboard. Nothing you’ve entered has been lost."
      primary={{ label: "Try again", onRetry: reset }}
      secondary={{ label: "Home", href: "/" }}
      code="500"
      cardLabel="Dashboard error"
      cardNote="If this keeps happening, wait a minute and reload. Entries you saved before the error are safe."
      tone="danger"
      bar="62%"
      reference={reference}
    />
  );
}
