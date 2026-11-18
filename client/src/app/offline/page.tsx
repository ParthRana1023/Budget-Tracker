"use client";

import StatusPage from "@/components/StatusPage";

// Served by the service worker (public/sw.js) when a page can't load without a connection.
export default function OfflinePage() {
  return (
    <StatusPage
      eyebrow="No connection"
      title="You’re"
      em="offline."
      body="Reconnect to see today’s safe-to-spend. Anything you log will need a connection to save."
      primary={{ label: "Retry connection", onRetry: () => window.location.reload() }}
      secondary={{ label: "Home", href: "/" }}
      code="—"
      cardLabel="Waiting for network"
      cardNote="Your last loaded numbers may be out of date until you’re back online."
      tone="warn"
      bar="45%"
    />
  );
}
