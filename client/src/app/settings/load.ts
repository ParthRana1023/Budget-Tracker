import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { addDaysStr } from "@/lib/cycle.mjs";
import { toLocalDateString } from "@/lib/periods.mjs";
import { SETTINGS_SELECT } from "@/lib/settings.mjs";
import type { SettingsPageData } from "@/components/settings/SettingsClient";

/** Rows for /settings and /settings/account (both protected like /dashboard). */
export async function loadSettingsPage(): Promise<SettingsPageData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Entries only feed the Categories popup ("spent this cycle"); a cycle is at most ~2 months.
  const since = addDaysStr(toLocalDateString(), -70);
  const [settings, categories, recurring, transactions] = await Promise.all([
    supabase.from("user_settings").select(SETTINGS_SELECT).eq("user_id", user.id).maybeSingle(),
    supabase.from("categories").select("*").eq("user_id", user.id).order("name"),
    supabase.from("recurring_items").select("*").eq("user_id", user.id).order("created_at"),
    supabase
      .from("transactions")
      .select("*, category:categories(name, type)")
      .eq("user_id", user.id)
      .gte("date", since)
      .order("date", { ascending: false }),
  ]);
  const failed = [settings, categories, recurring, transactions].find((r) => r.error);
  if (failed) throw new Error(`Could not load your settings: ${failed.error!.message}`);
  // No plan yet: set one up first. Same rule as the Dashboard (app/dashboard/page.tsx): a
  // database without the onboarded_at column counts as onboarded.
  const s = settings.data;
  if (!s || ("onboarded_at" in s && !s.onboarded_at)) redirect("/onboarding");

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      verified: !!user.email_confirmed_at,
      createdAt: user.created_at,
      providers: (user.identities ?? []).map((i) => i.provider),
    },
    settings: settings.data,
    categories: categories.data ?? [],
    recurringItems: recurring.data ?? [],
    transactions: transactions.data ?? [],
  };
}

/** `?s=<section>&f=<field id>` from a search result on the other view. */
export const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
