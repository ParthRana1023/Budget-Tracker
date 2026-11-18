import type { Metadata } from "next";
import StatusPage from "@/components/StatusPage";

export const metadata: Metadata = { title: "Session expired · SaveFirst" };

// The proxy sends a request here when its sign-in cookie no longer gives a valid session.
export default function SessionExpiredPage() {
  return (
    <StatusPage
      eyebrow="Signed out"
      title="Your session"
      em="has ended."
      body="For your security we sign you out after a while. Sign in again to pick up where you left off."
      primary={{ label: "Sign in again", href: "/login" }}
      secondary={{ label: "Home", href: "/" }}
      code="401"
      cardLabel="Session expired"
      cardNote="Nothing was lost. Your data is saved to your account."
      tone="warn"
      bar="80%"
    />
  );
}
