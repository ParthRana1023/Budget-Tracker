import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import Onboarding from "@/components/Onboarding";

export const metadata: Metadata = { title: "Set up · SaveFirst" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Onboarding runs once: running it again would switch off categories set up since.
  const { data: settings } = await supabase
    .from("user_settings")
    .select("onboarded_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settings?.onboarded_at) redirect("/dashboard");

  return <Onboarding />;
}
