import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@/utils/supabase/server";
import { errorFields, log } from "@/lib/log.mjs";
import { subscriptionGone, TEST_PUSH, testProblem } from "@/lib/pushTest.mjs";

// Settings › Notifications › Send a test: one push to this device now, even in quiet hours.
// Sends only to a subscription the signed-in user owns (RLS on push_subscriptions), and drops
// it when the push service says it's gone.
// shortcut: the per-user limit lives in this server instance's memory, so separate serverless
// instances each allow one test per 30s; move it to the database if abuse ever shows up.
const lastSent = new Map<string, number>();

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "";

const fail = (status: number, message: string) => NextResponse.json({ error: { message } }, { status });

export async function POST(request: Request) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) return fail(503, "Push isn’t set up on this server yet.");

  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const problem = testProblem({
    userId: user?.id,
    endpoint: body?.endpoint,
    lastSentAt: user ? lastSent.get(user.id) : undefined,
    now: Date.now(),
  });
  if (problem) return fail(problem.status, problem.message);

  const { data: sub, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("endpoint", body!.endpoint as string)
    .maybeSingle();
  if (error) {
    log.warn("push_test_lookup_failed", { ...errorFields(error), route: "/api/push/test", userId: user!.id });
    return fail(503, "Couldn’t send. Check your connection, then try again.");
  }
  if (!sub) return fail(404, "Turn push on for this device first.");

  lastSent.set(user!.id, Date.now());
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(TEST_PUSH),
      { vapidDetails: { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE }, TTL: 60 },
    );
  } catch (err) {
    if (subscriptionGone(err)) {
      await supabase.from("push_subscriptions").delete().eq("id", sub.id);
      return fail(410, "This device’s subscription expired. Turn push off and on again.");
    }
    log.warn("push_test_failed", { ...errorFields(err), route: "/api/push/test", userId: user!.id });
    return fail(502, "Couldn’t send. Check your connection, then try again.");
  }
  return NextResponse.json({ ok: true });
}
