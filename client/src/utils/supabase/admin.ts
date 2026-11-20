// Server-only Supabase access with the project's secret key, for the one thing the app may
// not do as the user: writing sign-in history (log_sign_in). Never import this from a
// client component; SUPABASE_SECRET_KEY has no NEXT_PUBLIC_ prefix, so it never reaches
// the browser bundle anyway.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { errorFields, log } from "@/lib/log.mjs";

type Method = "password" | "google" | "code" | "link";

/** Session id from an access token's claims (no signature check: it came from Supabase just now). */
function sessionIdOf(accessToken?: string | null) {
  try {
    const payload = JSON.parse(Buffer.from(accessToken!.split(".")[1], "base64url").toString());
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Records a sign-in attempt for Settings › Security. City comes from Vercel's geo header
 * (absent locally). Never throws: a failed log must not block signing in.
 */
export async function recordSignIn(
  headers: Headers,
  attempt: { email: string; method: Method; success: boolean; accessToken?: string | null },
) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    log.warn("sign_in_log_skipped", { message: "SUPABASE_SECRET_KEY is not set" });
    return;
  }
  const city = headers.get("x-vercel-ip-city");
  const admin = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.rpc("log_sign_in", {
    p_email: attempt.email,
    p_method: attempt.method,
    p_success: attempt.success,
    p_user_agent: headers.get("user-agent"),
    p_city: city ? decodeURIComponent(city) : null,
    p_session_id: sessionIdOf(attempt.accessToken),
  });
  if (error) log.warn("sign_in_log_failed", { ...errorFields(error), rpc: "log_sign_in" });
}
