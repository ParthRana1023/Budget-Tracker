"use client";

import { useEffect, useState } from "react";
import StatusPage from "@/components/StatusPage";
import { errorFields, reportClientError } from "@/lib/log.mjs";

export default function SettingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [reference] = useState(() => error.digest ?? `ST-${Date.now().toString(36).slice(-6).toUpperCase()}`);
  useEffect(
    () => reportClientError("page_crash", { ...errorFields(error), digest: reference, route: "/settings" }),
    [error, reference],
  );

  return (
    <StatusPage
      eyebrow="Settings error"
      title="Couldn’t load"
      em="your settings."
      body="We ran into a problem loading your settings or account data. Nothing you’ve entered has been lost."
      primary={{ label: "Try again", onRetry: reset }}
      secondary={{ label: "Dashboard", href: "/dashboard" }}
      code="500"
      cardLabel="Settings error"
      cardNote="If this keeps happening, wait a minute and reload. Your account details and preferences are safe."
      tone="danger"
      bar="62%"
      reference={reference}
    />
  );
}
