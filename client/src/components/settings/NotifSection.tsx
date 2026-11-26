"use client";

// Settings › Notifications (design handoff v3, Push States): Where you get them (push on this
// device; email returns later as another row), What shows in Notices, Timing. Push asks the
// browser only after the switch and a short explainer, never on page load. Email stays hidden
// until NEXT_PUBLIC_EMAIL_NOTIFICATIONS=1.

import { useEffect, useState, type ReactNode } from "react";
import {
  BellOff,
  CalendarClock,
  ChartColumn,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Monitor,
  Moon,
  MousePointerClick,
  Send,
  Settings as SettingsIcon,
  Smartphone,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { deviceName, hourLabel, isMobile, NOTIFY_TOGGLES, quietLength, savePreferences } from "@/lib/settings.mjs";
import {
  browserPushEnv,
  isSubscribedHere,
  pushState,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from "@/lib/push.mjs";
import Dialog from "../ui/Dialog";
import { Switch } from "../dashboard/popups/parts";
import { AppIcon } from "../dashboard/InstallCard";
import type { CreditCard, Settings } from "../dashboard/types";
import { Card, Row, SaveState, SELECT, SectionHead, useSave } from "./parts";

const EMAIL_ON = process.env.NEXT_PUBLIC_EMAIL_NOTIFICATIONS === "1";
const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const LEAD: Record<number, string> = { 1: "1 day", 3: "3 days", 7: "A week" };

type PushState = ReturnType<typeof pushState> | "loading";
type Test = null | "sending" | "sent" | { failed: string };

const Eyebrow = ({ children }: { children: ReactNode }) => <span className="eyebrow pt-2.5">{children}</span>;

export default function NotifSection({
  settings,
  cards = [],
  onSaved,
}: {
  settings: Settings;
  /** Card bills push: how many cards in use have reminders on. */
  cards?: CreditCard[];
  onSaved: (patch: Partial<Settings>) => void;
}) {
  const save = useSave();
  const pushSave = useSave();
  const [push, setPush] = useState<PushState>("loading");
  const [here, setHere] = useState(false);
  const [ask, setAsk] = useState<null | "explain" | "wait">(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [test, setTest] = useState<Test>(null);
  const [device, setDevice] = useState({ name: "this browser", phone: false });

  const check = () => {
    const state = pushState(browserPushEnv());
    setPush(state);
    if (state === "available") isSubscribedHere(createClient()).then(setHere, () => setHere(false));
  };
  useEffect(() => {
    if (!VAPID_KEY) return;
    setDevice({ name: deviceName(navigator.userAgent), phone: isMobile(navigator.userAgent) });
    check();
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
  const qOn = settings.quiet_hours_on !== false;
  const qFrom = settings.quiet_from ?? 22,
    qTo = settings.quiet_to ?? 8;
  const lead = LEAD[settings.bill_reminder_days ?? 3] ?? "3 days";
  const liveCards = cards.filter((c) => !c.archived_at);
  const remindCards = liveCards.filter((c) => c.reminders).length;

  const allow = async () => {
    setAskError(null);
    setAsk("wait");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setAsk(null);
        if (permission === "denied") setPush("blocked");
        return;
      }
      await subscribePush(createClient(), VAPID_KEY);
      setHere(true);
      setTest(null);
      setAsk(null);
      void pushSave.run(async () => ({ error: null }));
      // Saves the device's time zone now, so quiet hours apply from the first reminder.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (timezone && timezone !== settings.timezone) {
        const tz: Partial<Settings> = { timezone };
        onSaved(tz);
        void save.run(() => savePreferences(createClient(), tz));
      }
    } catch {
      setAsk("explain");
      setAskError("Couldn’t turn on push notifications. Check your connection and try again.");
    }
  };
  const turnOff = () =>
    void pushSave.run(async () => {
      try {
        await unsubscribePush(createClient());
        setHere(false);
        setTest(null);
        return { error: null };
      } catch (error) {
        return { error };
      }
    });
  const sendTest = async () => {
    setTest("sending");
    const r = await sendTestPush();
    if (r.ok) return setTest("sent");
    setTest({ failed: r.message });
    if (r.gone) check();
  };

  const locked = push === "blocked" || push === "unsupported" || push === "ios-install";
  const box = explanation(push, device.phone, check);
  const DeviceIcon = device.phone || push === "ios-install" ? Smartphone : Monitor;

  return (
    <>
      <SectionHead
        title="Notifications"
        lede="Notices always show on the Dashboard. Turn on push to get them on this device too."
      />
      <div className="-mt-2 self-end">
        <SaveState status={save.status} />
      </div>

      {(VAPID_KEY || EMAIL_ON) && (
        <>
          <Eyebrow>Where you get them</Eyebrow>
          <Card>
            {VAPID_KEY && (
              <div className="flex flex-col">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 px-6 py-[18px]">
                  <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-semibold">Push notifications</span>
                      <span className="inline-flex items-center gap-[5px] rounded-full bg-tile-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                        <DeviceIcon size={11} aria-hidden />
                        This device · {device.name}
                      </span>
                    </span>
                    <span className="text-[13px] text-pretty text-muted">
                      {push === "loading"
                        ? "Checking this device…"
                        : here
                          ? "On here. Your other devices keep their own setting."
                          : ask === "wait"
                            ? "Waiting for your browser…"
                            : locked
                              ? "Not available on this device right now"
                              : "Reminders on this device, even when SaveFirst is closed."}
                    </span>
                  </div>
                  <SaveState status={pushSave.status} />
                  <Switch
                    on={here || ask === "wait"}
                    disabled={locked || ask === "wait" || push === "loading"}
                    onToggle={() => (here ? turnOff() : setAsk("explain"))}
                    label="Push notifications on this device"
                  />
                </div>

                {box && (
                  <div
                    role="status"
                    className="mx-6 mb-5 flex items-start gap-3 rounded-[14px] px-4 py-3.5 max-[480px]:mx-[18px]"
                    style={{ background: box.bg }}
                  >
                    <span className="mt-0.5 flex" style={{ color: box.fg }}>
                      {box.icon}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="text-sm font-bold" style={{ color: box.fg }}>
                        {box.title}
                      </span>
                      <span className="text-[13px] text-pretty text-ink-2">{box.body}</span>
                      {box.steps.length > 0 && (
                        <ol className="m-0 mt-0.5 flex list-none flex-col gap-1.5 p-0">
                          {box.steps.map((t, i) => (
                            <li key={t} className="flex items-start gap-2.5 text-[13px]">
                              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-line-2 bg-tile text-[11px] font-bold">
                                {i + 1}
                              </span>
                              <span className="pt-px text-pretty">{t}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {box.button && (
                        <button
                          type="button"
                          onClick={box.button.onClick}
                          className="mt-1 h-10 cursor-pointer self-start rounded-full border border-line-2 bg-tile px-4 text-[13px] font-semibold hover:border-ink-2"
                        >
                          {box.button.label}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {here && (
                  <div className="mx-6 mb-5 flex flex-col rounded-[14px] border border-line max-[480px]:mx-[18px]">
                    {(
                      [
                        ["push_bills", "Bill reminders", `${lead} before each bill, at 9:00 am`],
                        [
                          "push_cards",
                          "Card bills",
                          liveCards.length
                            ? `3 days before and on the due date, at 9:00 am · ${remindCards} of ${liveCards.length} cards`
                            : "Add a card in Credit cards to get these",
                        ],
                        [
                          "push_weekly",
                          "Weekly summary",
                          "Mondays at 9:00 am: last week’s spending and what’s safe now",
                        ],
                      ] as const
                    ).map(([k, label, sub], i) => (
                      <div
                        key={k}
                        className="flex items-center gap-3.5 px-4 py-3.5"
                        style={{ borderTop: i ? "1px solid var(--line)" : 0 }}
                      >
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="text-sm font-semibold">{label}</span>
                          <span className="text-[13px] text-pretty text-muted">{sub}</span>
                        </div>
                        <Switch
                          on={on(k)}
                          onToggle={() => set({ [k]: !on(k) })}
                          label={label}
                          disabled={k === "push_cards" && !liveCards.length}
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-b-[13px] border-t border-line bg-tile-2 px-4 py-3.5">
                      <button
                        type="button"
                        onClick={() => void sendTest()}
                        disabled={test === "sending"}
                        className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-line-2 bg-tile px-4 text-[13px] font-semibold hover:border-ink-2 disabled:cursor-default disabled:opacity-60"
                      >
                        <Send size={14} aria-hidden />
                        {test === "sending" ? "Sending…" : test && test !== "sent" ? "Try again" : "Send a test"}
                      </button>
                      {test === "sent" || (test && typeof test === "object") ? (
                        <span
                          role="status"
                          className="flex flex-[1_1_200px] items-center gap-2 text-[13px] font-semibold"
                          style={{ color: test === "sent" ? "var(--lime-text)" : "var(--danger)" }}
                        >
                          {test === "sent" ? (
                            <CircleCheck size={14} aria-hidden className="flex-none" />
                          ) : (
                            <CircleAlert size={14} aria-hidden className="flex-none" />
                          )}
                          {test === "sent" ? "Sent. It should arrive in a few seconds." : test.failed}
                        </span>
                      ) : (
                        <span className="flex-[1_1_200px] text-[13px] text-muted">
                          Sends one now, even in quiet hours.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
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
        </>
      )}

      <Eyebrow>What shows in Notices</Eyebrow>
      <Card>
        {NOTIFY_TOGGLES.map(([k, label, help]) => (
          <Row key={k} label={label} help={help}>
            <Switch on={on(k)} onToggle={() => set({ [k]: !on(k) })} label={label} />
          </Row>
        ))}
      </Card>

      <Eyebrow>Timing</Eyebrow>
      <Card>
        <Row label="Remind me about bills" help="When push and email reminders go out" htmlFor="f-due">
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
        <div className="flex flex-col gap-3.5 px-6 py-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <div className="flex min-w-0 flex-[1_1_260px] flex-col">
              <span className="text-sm font-semibold">Quiet hours</span>
              <span className="text-[13px] text-pretty text-muted">
                Push notifications wait until quiet hours end. Notices on the Dashboard still show.
              </span>
            </div>
            <Switch on={qOn} onToggle={() => set({ quiet_hours_on: !qOn })} label="Quiet hours" />
          </div>
          {qOn && (
            <>
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
              {here && (
                <span className="flex items-center gap-2 text-[13px] text-ink-2">
                  <BellOff size={14} aria-hidden className="flex-none" />
                  Push reminders that fall in this window arrive at {hourLabel(qTo)}.
                </span>
              )}
            </>
          )}
        </div>
      </Card>

      <Dialog
        open={ask !== null}
        onClose={() => {
          setAsk(null);
          setAskError(null);
        }}
        eyebrow={`This device · ${device.name}`}
        title="Turn on push notifications"
        size="sm"
        onSubmit={() => void allow()}
        submitLabel={ask === "wait" ? "Waiting…" : "Continue"}
        cancelLabel="Not now"
        busy={ask === "wait"}
        error={askError}
        hint=""
      >
        {/* A sample of what arrives. */}
        <div aria-hidden className="flex items-start gap-3 rounded-[18px] border border-line bg-tile-2 px-3.5 py-3">
          <AppIcon size={38} />
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="flex justify-between text-xs text-muted">
              <span>SaveFirst</span>
              <span>now</span>
            </span>
            <span className="text-sm font-bold">Rent is due tomorrow</span>
            <span className="text-[13px] text-ink-2">₹12,000.00 · Tap to record it once it’s paid.</span>
          </div>
        </div>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {(
            [
              [CalendarClock, `Bill reminders, ${lead.toLowerCase()} before they’re due`],
              [ChartColumn, "A short summary every Monday morning"],
              ...(qOn ? [[Moon, `Nothing between ${hourLabel(qFrom)} and ${hourLabel(qTo)}`] as const] : []),
              [SettingsIcon, "Turn it off here any time"],
            ] as const
          ).map(([Icon, text]) => (
            <li key={text} className="flex items-start gap-3 text-[15px]">
              <span
                aria-hidden
                className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-tile-2 text-ink-2"
              >
                <Icon size={16} />
              </span>
              <span className="pt-[5px] text-pretty">{text}</span>
            </li>
          ))}
        </ul>
        {ask === "wait" && (
          <div
            role="status"
            className="flex items-center gap-3 rounded-[14px] bg-lime-soft px-4 py-3.5 text-sm font-semibold text-lime-text"
          >
            <MousePointerClick size={18} aria-hidden className="flex-none" />
            <span className="text-pretty">
              Your browser is asking now. Choose <strong>Allow</strong>.
            </span>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** The box under the Push row when push can't be turned on here. */
function explanation(push: PushState, phone: boolean, checkAgain: () => void) {
  if (push === "blocked")
    return {
      bg: "var(--warn-soft)",
      fg: "var(--warn)",
      icon: <BellOff size={18} aria-hidden />,
      title: "Blocked in this browser",
      body: "Notifications were blocked for SaveFirst, so we can’t ask again. To allow them:",
      steps: phone
        ? [
            "Tap ⋮, then Settings › Site settings › Notifications",
            "Find SaveFirst and choose Allow",
            "Come back here and tap Check again",
          ]
        : [
            "Click the icon to the left of the address bar",
            "Set Notifications to Allow",
            "Come back here and tap Check again",
          ],
      button: { label: "Check again", onClick: checkAgain },
    };
  if (push === "unsupported")
    return {
      bg: "var(--tile-2)",
      fg: "var(--ink)",
      icon: <CircleSlash size={18} aria-hidden />,
      title: "Not available in this browser",
      body: "This browser can’t show push notifications. Chrome, Edge, Firefox and Safari 16.4 or later can. Notices on the Dashboard still work here.",
      steps: [],
      button: null,
    };
  if (push === "ios-install")
    return {
      bg: "var(--tile-2)",
      fg: "var(--ink)",
      icon: <Smartphone size={18} aria-hidden />,
      title: "Add SaveFirst to your Home Screen first",
      body: "On iPhone, push only works from the Home Screen app, on iOS 16.4 or later.",
      steps: [
        "Tap Share in Safari",
        "Choose Add to Home Screen",
        "Open SaveFirst from your Home Screen and turn this on",
      ],
      button: null,
    };
  return null;
}
