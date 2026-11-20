"use client";

import { useEffect, useState } from "react";
import StatusPage from "@/components/StatusPage";
import { errorFields, reportClientError } from "@/lib/log.mjs";

export default function ServerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The digest matches the server log entry; without one, a short id still helps a report.
  const [reference] = useState(() => error.digest ?? `SF-${Date.now().toString(36).slice(-6).toUpperCase()}`);
  useEffect(
    () => reportClientError("page_crash", { ...errorFields(error), digest: reference, route: location.pathname }),
    [error, reference],
  );

  return (
    <StatusPage
      eyebrow="Error 500"
      title="Something broke"
      em="on our side."
      body="We couldn’t load your numbers just now. Nothing you entered has been lost."
      primary={{ label: "Try again", onRetry: reset }}
      secondary={{ label: "Home", href: "/" }}
      code="500"
      cardLabel="Server error"
      cardNote="If this keeps happening, wait a minute and reload. Entries you saved before the error are safe."
      tone="danger"
      bar="62%"
      reference={reference}
    />
  );
}
