// Hourly notification job (Supabase Edge Function, Deno), called by pg_cron (server/supabase/cron/).
// Sends bill reminders `bill_reminder_days` ahead and, on Monday mornings, a weekly summary, by
// email (users who turned it on) and Web Push (devices that turned it on in Settings). Nothing
// goes out in a user's quiet hours; anything due waits for the next run outside them.
// notification_log stops repeats: each reminder is claimed once, then sent on every channel.
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (set by Supabase), CRON_SECRET (same
// value as in the cron job), APP_URL (links). Email: RESEND_API_KEY, EMAIL_FROM. Push:
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT ("mailto:you@example.com"). A channel
// whose secrets are missing is skipped.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import {
  addDays,
  billPush,
  billsDueOn,
  channels,
  isQuiet,
  localParts,
  money,
  inTodaysBase,
  safeNow,
  WEEKLY_HOUR,
  weeklyPush,
} from "./logic.mjs";

const env = (k: string) => Deno.env.get(k) ?? "";
const emailReady = !!(env("RESEND_API_KEY") && env("EMAIL_FROM"));
const pushReady = !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY") && env("VAPID_SUBJECT"));
if (pushReady) webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Message = { title: string; body: string; url: string; tag: string; actions?: { action: string; title: string }[] };

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

  const devices = new Map<string, Sub[]>();
  if (pushReady) {
    const { data, error } = await db.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    for (const s of data ?? []) devices.set(s.user_id, [...(devices.get(s.user_id) ?? []), s]);
  }
  // shortcut: the user id list grows with every push user; page through users past a few thousand.
  const filters = emailReady ? ["email_notifications.eq.true", "weekly_summary.eq.true"] : [];
  if (devices.size) filters.push(`user_id.in.(${[...devices.keys()].join(",")})`);
  if (!filters.length) return Response.json({ sent: 0, failed: 0 });

  const { data: people, error } = await db
    .from("user_settings")
    .select(
      // The plan columns and history feed the weekly summary's safe to spend (same maths as the Dashboard).
      "user_id, currency, email_notifications, weekly_summary, notify_due, push_bills, push_weekly, bill_reminder_days, quiet_hours_on, quiet_from, quiet_to, timezone, take_home_pay, savings_pct, month_start_day, plan_changes(field, from_value, to_value, applies, effective_from, superseded_at, created_at)",
    )
    .or(filters.join(","));
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Sends to every device; a device the push service reports gone (404/410) is deleted.
  const push = async (subs: Sub[], msg: Message) => {
    let ok = 0;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(msg),
          { TTL: 60 * 60 * 24 },
        );
        ok++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else throw e;
      }
    }
    return ok;
  };

  const now = new Date();
  let sent = 0,
    failed = 0;
  for (const s of people ?? []) {
    try {
      const local = localParts(now, s.timezone);
      if (isQuiet(local.hour, s)) continue;
      const subs = devices.get(s.user_id) ?? [];
      const on = channels(s, { emailReady, pushReady, devices: subs.length });
      let to = "";
      if (on.bills.email || on.weekly.email) {
        const { data: user } = await db.auth.admin.getUserById(s.user_id);
        to = user?.user?.email ?? "";
      }
      // Claims a log row first: a second run (or a retry) can't send the same reminder again.
      const claim = async (kind: string, ref: string) =>
        (await db.from("notification_log").insert({ user_id: s.user_id, kind, ref }).select()).error === null;

      const billEmail = on.bills.email && !!to;
      if (billEmail || on.bills.push) {
        const days = s.bill_reminder_days;
        const due = addDays(local.date, days);
        const [items, cats] = await Promise.all([
          db.from("recurring_items").select("*").eq("user_id", s.user_id),
          db.from("categories").select("*").eq("user_id", s.user_id),
        ]);
        for (const bill of billsDueOn(items.data ?? [], cats.data ?? [], due)) {
          if (!(await claim("bill", bill.ref))) continue;
          if (billEmail) {
            await sendEmail(
              to,
              `${bill.name} is due in ${days} day${days === 1 ? "" : "s"}`,
              `${bill.name} (${money(bill.amount, s.currency)}) is due on ${due}. Record it on your dashboard when you pay: ${env("APP_URL")}/dashboard`,
            );
            sent++;
          }
          if (on.bills.push) sent += await push(subs, billPush(bill, days, due, s.currency));
        }
      }

      const weeklyEmail = on.weekly.email && !!to;
      if ((weeklyEmail || on.weekly.push) && local.weekday === 1 && local.hour >= WEEKLY_HOUR) {
        if (await claim("weekly", local.date)) {
          // A cycle is at most about two months (pay-day changes), so this covers it and last week.
          const [cats, items, txs] = await Promise.all([
            db.from("categories").select("*").eq("user_id", s.user_id),
            db.from("recurring_items").select("*").eq("user_id", s.user_id),
            db.from("transactions").select("*").eq("user_id", s.user_id).gte("date", addDays(local.date, -70)),
          ]);
          const failedRead = [cats, items, txs].find((r) => r.error);
          if (failedRead) throw failedRead.error;
          // Entries from before a base switch, in today's base.
          const entries = inTodaysBase(txs.data ?? [], s.currency, [...(cats.data ?? []), ...(items.data ?? [])]);
          const spent = entries.filter(
            (t) => t.type === "expense" && t.date >= addDays(local.date, -7) && t.date < local.date,
          );
          const total = spent.reduce((a, t) => a + Number(t.amount), 0);
          const count = spent.length;
          if (weeklyEmail) {
            await sendEmail(
              to,
              "Your week in SaveFirst",
              `You spent ${money(total, s.currency)} across ${count} entries last week. See the details: ${env("APP_URL")}/dashboard?view=reports`,
            );
            sent++;
          }
          if (on.weekly.push) {
            const cycle = safeNow({
              settings: s,
              categories: cats.data ?? [],
              transactions: entries,
              recurringItems: items.data ?? [],
              today: local.date,
            });
            sent += await push(subs, weeklyPush(total, cycle.safe, cycle.cycleEnd, s.currency));
          }
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
