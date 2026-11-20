// Hourly email job (Supabase Edge Function, Deno), called by pg_cron (server/supabase/cron/).
// Sends bill reminders `bill_reminder_days` ahead and, on Monday mornings, a weekly summary,
// to users who turned email on. Nothing goes out in a user's quiet hours; anything due waits
// for the next run outside them. notification_log stops repeats.
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (set by Supabase), RESEND_API_KEY,
// EMAIL_FROM ("SaveFirst <hello@your-domain>"), CRON_SECRET (same value as in the cron job),
// APP_URL (link in the emails).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { addDays, billsDueOn, isQuiet, localParts, rupees } from "./logic.mjs";

const env = (k: string) => Deno.env.get(k) ?? "";
const WEEKLY_HOUR = 9;

async function sendEmail(to: string, subject: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_FROM"), to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}`);
}

Deno.serve(async (req) => {
  if (!env("CRON_SECRET") || req.headers.get("x-cron-secret") !== env("CRON_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const { data: people, error } = await db
    .from("user_settings")
    .select(
      "user_id, email_notifications, weekly_summary, notify_due, bill_reminder_days, quiet_hours_on, quiet_from, quiet_to, timezone",
    )
    .or("email_notifications.eq.true,weekly_summary.eq.true");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = new Date();
  let sent = 0,
    failed = 0;
  for (const s of people ?? []) {
    try {
      const local = localParts(now, s.timezone);
      if (isQuiet(local.hour, s)) continue;
      const { data: user } = await db.auth.admin.getUserById(s.user_id);
      const to = user?.user?.email;
      if (!to) continue;
      // Claims a log row first: a second run (or a retry) can't send the same email again.
      const claim = async (kind: string, ref: string) =>
        (await db.from("notification_log").insert({ user_id: s.user_id, kind, ref }).select()).error === null;

      if (s.email_notifications && s.notify_due) {
        const due = addDays(local.date, s.bill_reminder_days);
        const [items, cats] = await Promise.all([
          db.from("recurring_items").select("*").eq("user_id", s.user_id),
          db.from("categories").select("*").eq("user_id", s.user_id),
        ]);
        for (const bill of billsDueOn(items.data ?? [], cats.data ?? [], due)) {
          if (!(await claim("bill", bill.ref))) continue;
          await sendEmail(
            to,
            `${bill.name} is due in ${s.bill_reminder_days} day${s.bill_reminder_days === 1 ? "" : "s"}`,
            `${bill.name} (${rupees(bill.amount)}) is due on ${due}. Record it on your dashboard when you pay: ${env("APP_URL")}/dashboard`,
          );
          sent++;
        }
      }

      if (s.weekly_summary && local.weekday === 1 && local.hour >= WEEKLY_HOUR) {
        if (await claim("weekly", local.date)) {
          const { data: spent } = await db
            .from("transactions")
            .select("amount")
            .eq("user_id", s.user_id)
            .eq("type", "expense")
            .gte("date", addDays(local.date, -7))
            .lt("date", local.date);
          const total = (spent ?? []).reduce((a, t) => a + Number(t.amount), 0);
          await sendEmail(
            to,
            "Your week in SaveFirst",
            `You spent ${rupees(total)} across ${spent?.length ?? 0} entries last week. See the details: ${env("APP_URL")}/dashboard?view=reports`,
          );
          sent++;
        }
      }
    } catch (e) {
      // One user's failure (e.g. Resend down) doesn't stop the rest; no personal data in the log.
      failed++;
      console.error(JSON.stringify({ level: "error", event: "notification_failed", message: String(e).slice(0, 200) }));
    }
  }
  return Response.json({ sent, failed });
});
