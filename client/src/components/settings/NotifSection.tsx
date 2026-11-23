"use client";

// Settings › Notifications (design handoff v2). The switches drive Notices on the Dashboard.
// Push: shown when NEXT_PUBLIC_VAPID_PUBLIC_KEY is set; permission is asked only after the user
// taps "Turn on" and reads the explainer, never on page load. Email (lead time, quiet hours,
// weekly summary) is ready on the backend but stays hidden until NEXT_PUBLIC_EMAIL_NOTIFICATIONS=1.

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { hourLabel, NOTIFY_TOGGLES, quietLength, savePreferences } from "@/lib/settings.mjs";
import { browserPushEnv, isSubscribedHere, pushState, subscribePush, unsubscribePush } from "@/lib/push.mjs";
import Dialog from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import { Switch } from "../dashboard/popups/parts";
import type { Settings } from "../dashboard/types";
import { Card, Row, SaveState, SELECT, SectionHead, useSave } from "./parts";

const EMAIL_ON = process.env.NEXT_PUBLIC_EMAIL_NOTIFICATIONS === "1";
const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const HOURS = Array.from({ length: 24 }, (_, h) => h);

type PushState = ReturnType<typeof pushState> | "loading";
const PUSH_HELP: Record<Exclude<PushState, "available">, string> = {
  loading: "Checking this device…",
  "ios-install":
    "On iPhone and iPad, add SaveFirst to your Home Screen first (Share › Add to Home Screen, iOS 16.4 or later), then open it from there.",
  unsupported: "This browser can’t show push notifications.",
  blocked:
    "Notifications are blocked for this site. Allow them in your browser’s site settings, then reload this page.",
};

export default function NotifSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (patch: Partial<Settings>) => void;
}) {
  const save = useSave();
  const toast = useToast();
  const [push, setPush] = useState<PushState>("loading");
  const [here, setHere] = useState(false);
  const [explain, setExplain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    if (!VAPID_KEY) return;
    const state = pushState(browserPushEnv());
    setPush(state);
    if (state === "available") isSubscribedHere(createClient()).then(setHere, () => setHere(false));
  }, []);

  const set = (patch: Partial<Settings>) => {
    // The notification job reads hours in this time zone; keep it in step with the device.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const sends = EMAIL_ON || here;
    const changes = sends && timezone && timezone !== settings.timezone ? { ...patch, timezone } : patch;
    if (!Object.keys(changes).length) return;
    onSaved(changes);
    void save.run(() => savePreferences(createClient(), changes));
  };
  const on = (k: keyof Settings) => settings[k] !== false;
  const qFrom = settings.quiet_from ?? 22,
    qTo = settings.quiet_to ?? 8;

  const turnOn = async () => {
    setBusy(true);
    setPushError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPush(permission === "denied" ? "blocked" : "available");
        setExplain(false);
        return;
      }
      await subscribePush(createClient(), VAPID_KEY);
      setHere(true);
      setExplain(false);
      // Saves the device's time zone now, so quiet hours apply from the first reminder.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timezone && timezone !== settings.timezone) {
        const tz: Partial<Settings> = { timezone };
        onSaved(tz);
        void save.run(() => savePreferences(createClient(), tz));
      }
      toast("Push notifications are on for this device.");
    } catch {
      setPushError("Couldn’t turn on push notifications. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    try {
      await unsubscribePush(createClient());
      setHere(false);
      toast("Push notifications are off for this device.");
    } catch {
      toast("Couldn’t turn push off. Check your connection and try again.", { error: true });
    }
  };

  return (
    <>
      <SectionHead
        title="Notifications"
        lede={
          EMAIL_ON || VAPID_KEY
            ? "Shown in Notices on the Dashboard, and on your devices if you turn it on."
            : "Shown in Notices on the Dashboard."
        }
      />
      <div className="-mt-2 self-end">
        <SaveState status={save.status} />
      </div>
      <Card>
        {NOTIFY_TOGGLES.map(([k, label, help]) => (
          <Row key={k} label={label} help={help}>
            <Switch on={on(k)} onToggle={() => set({ [k]: !on(k) })} label={label} />
          </Row>
        ))}
        {EMAIL_ON && (
          <>
            <Row label="Email me too" help="Bill reminders by email as well as on the Dashboard">
              <Switch
                on={!!settings.email_notifications}
                onToggle={() => set({ email_notifications: !settings.email_notifications })}
                label="Email me too"
              />
            </Row>
            <Row label="Weekly summary email" help="Every Monday morning">
              <Switch
                on={!!settings.weekly_summary}
                onToggle={() => set({ weekly_summary: !settings.weekly_summary })}
                label="Weekly summary email"
              />
            </Row>
          </>
        )}
      </Card>

      {VAPID_KEY && (
        <Card>
          <Row
            label="Push notifications"
            help={
              push === "available"
                ? here
                  ? "On for this device. Turning it off here stops push on this device only."
                  : "Bill reminders and a weekly summary on this device, even when SaveFirst is closed."
                : PUSH_HELP[push]
            }
          >
            {push === "available" && (
              <Switch
                on={here}
                onToggle={() => (here ? void turnOff() : setExplain(true))}
                label="Push notifications on this device"
              />
            )}
          </Row>
          {here && (
            <>
              <Row label="Bill reminders" help="Before a bill or recurring payment is due">
                <Switch
                  on={on("push_bills")}
                  onToggle={() => set({ push_bills: !on("push_bills") })}
                  label="Bill reminder push"
                />
              </Row>
              <Row label="Weekly summary" help="Monday morning: what you spent last week">
                <Switch
                  on={on("push_weekly")}
                  onToggle={() => set({ push_weekly: !on("push_weekly") })}
                  label="Weekly summary push"
                />
              </Row>
            </>
          )}
        </Card>
      )}

      {(EMAIL_ON || here) && (
        <Card>
          <Row label="Remind me about bills" htmlFor="f-due">
            <select
              id="f-due"
              value={settings.bill_reminder_days ?? 3}
              onChange={(e) => set({ bill_reminder_days: +e.target.value })}
              className={`${SELECT} h-10 text-sm`}
            >
              <option value={1}>1 day before</option>
              <option value={3}>3 days before</option>
              <option value={7}>A week before</option>
            </select>
          </Row>
          <div className="flex flex-col gap-3.5 px-6 py-5 max-[480px]:px-[18px]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
              <div className="flex min-w-0 flex-[1_1_260px] flex-col">
                <span className="text-sm font-semibold">Quiet hours</span>
                <span className="text-[13px] text-pretty text-muted">
                  No emails or push notifications during these hours. Anything due waits until they end.
                </span>
              </div>
              <Switch
                on={settings.quiet_hours_on !== false}
                onToggle={() => set({ quiet_hours_on: settings.quiet_hours_on === false })}
                label="Quiet hours"
              />
            </div>
            {settings.quiet_hours_on !== false && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <label htmlFor="f-qh-from" className="text-muted">
                  From
                </label>
                <select
                  id="f-qh-from"
                  value={qFrom}
                  onChange={(e) => set({ quiet_from: +e.target.value })}
                  className={`${SELECT} h-10 text-sm`}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <label htmlFor="f-qh-to" className="text-muted">
                  to
                </label>
                <select
                  id="f-qh-to"
                  value={qTo}
                  onChange={(e) => set({ quiet_to: +e.target.value })}
                  className={`${SELECT} h-10 text-sm`}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
                <span className="text-[13px] text-muted">{quietLength(qFrom, qTo)} hours</span>
              </div>
            )}
          </div>
        </Card>
      )}

      <Dialog
        open={explain}
        onClose={() => setExplain(false)}
        eyebrow="Push notifications"
        title="Get reminders on this device"
        size="sm"
        onSubmit={() => void turnOn()}
        submitLabel="Turn on"
        busy={busy}
        error={pushError}
        hint="Your browser asks next"
      >
        <p className="m-0 text-sm text-pretty text-muted">
          SaveFirst sends bill reminders before they’re due and a short summary every Monday. Nothing is sent in your
          quiet hours. Your browser asks for permission next, and you can turn this off here at any time.
        </p>
      </Dialog>
    </>
  );
}
