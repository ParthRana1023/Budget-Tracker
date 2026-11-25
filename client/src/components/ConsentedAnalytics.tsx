"use client";

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { analyticsAllowed, CONSENT_EVENT } from "@/lib/consent.mjs";

/**
 * Vercel Analytics and Speed Insights, only after the visitor said yes (lib/consent.mjs). Read in the
 * browser, not the root layout, so pages stay static; nothing renders until the cookie is read.
 */
export default function ConsentedAnalytics() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(analyticsAllowed(document.cookie));
    read();
    window.addEventListener(CONSENT_EVENT, read);
    return () => window.removeEventListener(CONSENT_EVENT, read);
  }, []);
  return on ? (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  ) : null;
}
