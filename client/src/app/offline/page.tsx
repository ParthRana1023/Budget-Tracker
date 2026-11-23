"use client";

import { useEffect } from "react";
import StatusPage from "@/components/StatusPage";

// Served by the service worker (public/sw.js) when a page can't load without a connection
// (design handoff v3, Status Pages › Offline). Reconnects on its own when the network is back.
export default function OfflinePage() {
  useEffect(() => {
    const back = () => window.location.reload();
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);
  return (
    <StatusPage
      eyebrow="No connection"
      title="You’re"
      em="offline."
      body="SaveFirst needs a connection to show your numbers and save entries. Nothing you logged has been lost."
      primary={{ label: "Try again", onRetry: () => window.location.reload() }}
      secondary={{ label: "Home", href: "/" }}
      code="₹ ——"
      cardLabel="Waiting for network"
      cardNote="Amounts stay hidden while you’re offline, so you never act on old numbers. This page reconnects on its own when the network is back."
      tone="warn"
      bar="45%"
    />
  );
}
