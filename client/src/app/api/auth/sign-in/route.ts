import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { recordSignIn } from "@/utils/supabase/admin";
import { isValidEmail } from "@/lib/auth.mjs";
import { errorFields, log } from "@/lib/log.mjs";

// Password and email-code sign-in run here, not in the browser, so every attempt (failed ones
// too) lands in the user's sign-in history with the city from the host's geo header.
// The session cookies are set on this response, as with /auth/confirm.
const PER_MINUTE = 10;
// shortcut: the rate limit is per server instance (in memory); Supabase's own auth limits still apply.
const hits = new Map<string, { n: number; at: number }>();

type Body = { method?: unknown; email?: unknown; password?: unknown; token?: unknown };

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const h = hits.get(ip);
  if (h && now - h.at < 60_000) {
    if (++h.n > PER_MINUTE) return NextResponse.json({ error: { code: "over_request_rate_limit" } }, { status: 429 });
  } else {
    if (hits.size > 5_000) hits.clear();
    hits.set(ip, { n: 1, at: now });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const method = body?.method;
  const secret = method === "password" ? body?.password : body?.token;
  if (
    (method !== "password" && method !== "code") ||
    !isValidEmail(email) ||
    typeof secret !== "string" ||
    !secret ||
    secret.length > 200
  ) {
    return NextResponse.json({ error: { message: "Enter your email and password." } }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } =
    method === "password"
      ? await supabase.auth.signInWithPassword({ email, password: secret })
      : await supabase.auth.verifyOtp({ email, token: secret, type: "email" });
  await recordSignIn(request.headers, {
    email,
    method,
    success: !error,
    accessToken: data.session?.access_token,
  });
  if (error) {
    if (!error.status || error.status >= 500)
      log.error("sign_in_failed", { ...errorFields(error), route: "/api/auth/sign-in" });
    // Only what lib/auth.mjs authErrorFor needs to word the message.
    return NextResponse.json(
      { error: { code: error.code, status: error.status, name: error.name, message: error.message } },
      { status: error.status && error.status < 500 ? error.status : 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
