import type { Metadata } from "next";
import StatusPage from "@/components/StatusPage";

export const metadata: Metadata = { title: "Page not found · SaveFirst" };

export default function NotFound() {
  return (
    <StatusPage
      eyebrow="Error 404"
      title="This page isn’t"
      em="in the budget."
      body="The link may be old or mistyped. Your savings and entries are untouched."
      primary={{ label: "Back to dashboard", href: "/dashboard" }}
      secondary={{ label: "Home", href: "/" }}
      code="404"
      cardLabel="Page not found"
      cardNote="If you followed a link from an email, it may have expired. Sign in again to get a fresh one."
      tone="muted"
      bar="30%"
    />
  );
}
