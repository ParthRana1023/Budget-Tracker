"use client";

// Settings › Notifications (design handoff v2). The switches drive Notices on the Dashboard.
// Email (reminder lead time, quiet hours, weekly summary) is ready on the backend but stays
// hidden until NEXT_PUBLIC_EMAIL_NOTIFICATIONS=1.

import { createClient } from "@/utils/supabase/client";
import { hourLabel, NOTIFY_TOGGLES, quietLength, savePreferences } from "@/lib/settings.mjs";
import { Switch } from "../dashboard/popups/parts";
import type { Settings } from "../dashboard/types";
import { Card, Row, SaveState, SELECT, SectionHead, useSave } from "./parts";

const EMAIL_ON = process.env.NEXT_PUBLIC_EMAIL_NOTIFICATIONS === "1";
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function NotifSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (patch: Partial<Settings>) => void;
}) {
  const save = useSave();
  const set = (patch: Partial<Settings>) => {
    // The email job reads hours in this time zone; keep it in step with the device.
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const changes = EMAIL_ON && timezone && timezone !== settings.timezone ? { ...patch, timezone } : patch;
    onSaved(changes);
    void save.run(() => savePreferences(createClient(), changes));
  };
  const on = (k: keyof Settings) => settings[k] !== false;
  const qFrom = settings.quiet_from ?? 22,
    qTo = settings.quiet_to ?? 8;

  return (
    <>
      <SectionHead
        title="Notifications"
        lede={
          EMAIL_ON
            ? "Shown in Notices on the Dashboard, and by email if you turn it on."
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
                    No emails during these hours. Anything due waits until they end.
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
          </>
        )}
      </Card>
    </>
  );
}
