import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { errorFields, log } from "@/lib/log.mjs";

// Account › Password: checks the current password, sets the new one, then signs every other
// device out. The check runs on a throwaway client so this browser's session is untouched.
const MIN_LENGTH = 8;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";
  if (!current) return NextResponse.json({ error: { message: "Enter your current password." } }, { status: 400 });
  if (next.length < MIN_LENGTH || next.length > 200)
    return NextResponse.json({ error: { message: "New password needs at least 8 characters." } }, { status: 400 });
  if (next === current)
    return NextResponse.json(
      { error: { message: "Choose a password you haven’t used here before." } },
      { status: 400 },
    );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email)
    return NextResponse.json({ error: { message: "Sign in again to change your password." } }, { status: 401 });

  const check = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: wrong } = await check.auth.signInWithPassword({ email: user.email, password: current });
  if (wrong) {
    const status = wrong.status && wrong.status < 500 ? 400 : 503;
    return NextResponse.json(
      {
        error: {
          message:
            status === 400
              ? "Your current password isn’t right."
              : "We couldn’t check your password. Try again in a minute.",
        },
      },
      { status },
    );
  }
  await check.auth.signOut({ scope: "local" }); // ends only the check's own session (the default, global, would sign this browser out too)

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    log.warn("password_change_failed", { ...errorFields(error), route: "/api/account/password", userId: user.id });
    return NextResponse.json(
      {
        error: {
          message:
            error.code === "weak_password"
              ? "Choose a stronger password."
              : "Couldn’t change your password. Check your connection and try again.",
        },
      },
      { status: 400 },
    );
  }
  await supabase.auth.signOut({ scope: "others" });
  return NextResponse.json({ ok: true });
}
