import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://clfeauivpjqwkbsqcwiq.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_qUCtsDH2mNhVuzP1aV9Dqg_uXW2wiGk";

export const createClient = () =>
  createBrowserClient(
    supabaseUrl,
    supabaseKey,
  );

