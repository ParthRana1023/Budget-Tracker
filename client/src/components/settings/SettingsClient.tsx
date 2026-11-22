"use client";

// Settings and Account (design handoff v2, Settings.dc.html): a section list with search on
// the left, one section at a time on the right. /settings and /settings/account share it.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { cycleFor, paySchedule, toLocalDateString } from "@/lib/periods.mjs";
import { buildCycleModel } from "@/lib/cycleModel.mjs";
import { formatMoney, setNumberFormat } from "@/lib/money.mjs";
import { deleteAccount, SETTINGS_SELECT, undoPlan } from "@/lib/settings.mjs";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import AppHeader from "../AppHeader";
import { useToast } from "../ui/Toast";
import CategoriesDialog from "../dashboard/popups/CategoriesDialog";
import RecurringListDialog from "../dashboard/popups/RecurringListDialog";
import type { PopupContext } from "../dashboard/popups/context";
import type { Category, RecurringItem, Settings, Tx } from "../dashboard/types";
import PlanSection from "./PlanSection";
import PrefsSection from "./PrefsSection";
import ProfileSection, { type AccountUser } from "./ProfileSection";
import DataSection, { downloadAllData } from "./DataSection";
import NotifSection from "./NotifSection";
import SecuritySection from "./SecuritySection";
import { GOOGLE_ON, GoogleSection, PasswordSection, VerifyBanner } from "./AccountSections";
import { BTN_LINE, Card, INPUT, Row, SectionHead } from "./parts";

export type SettingsPageData = {
  user: AccountUser;
  settings: Settings;
  categories: Category[];
  recurringItems: RecurringItem[];
  transactions: Tx[];
};

type View = "settings" | "account";
const SECTIONS = {
  settings: [
    ["plan", "Budget plan"],
    ["cats", "Categories & fixed bills"],
    ["notif", "Notifications"],
    ["prefs", "Preferences"],
    ["data", "Data"],
    ["sec", "Security"],
    ["del", "Delete account"],
  ],
  account: [
    ["profile", "Profile"],
    ["pw", "Password"],
    ["google", "Linked accounts"],
  ],
} as const;
type Section = (typeof SECTIONS)[View][number][0];
const WHERE: Record<Section, string> = {
  plan: "Budget plan",
  cats: "Categories & fixed bills",
  notif: "Notifications",
  prefs: "Preferences",
  data: "Data",
  sec: "Security",
  del: "Delete account",
  profile: "Account · Profile",
  pw: "Account · Password",
  google: "Account · Linked accounts",
};
/** Search: [setting, section, field to focus, extra words it answers to]. */
const INDEX: [string, Section, string | null, string][] = [
  ["Monthly salary", "plan", "f-sal", "income pay take-home"],
  ["Payday", "plan", "f-pay", "salary date cycle"],
  ["Save first %", "plan", "f-pct", "savings percent target"],
  ["Plan history", "plan", "plan-hist", "log changes past"],
  ["Categories", "cats", null, "limits budget flexible"],
  ["Fixed bills", "cats", null, "rent due"],
  ["Recurring items", "cats", null, "subscriptions repeat"],
  ["Bill reminders", "notif", null, "notifications due notices alerts"],
  ["Category 80% warning", "notif", null, "alerts limit notices"],
  ["Over a limit", "notif", null, "alerts overspent notices"],
  ["Theme", "prefs", null, "dark light mode appearance"],
  ["Currency", "prefs", "f-cur", "rupee inr symbol"],
  ["Number format", "prefs", "f-num", "commas decimal lakh thousands separator"],
  ["Week starts on", "prefs", "f-wk", "monday sunday"],
  ["Download all my data", "data", null, "export account backup json"],
  ["Export entries", "data", null, "csv json spreadsheet download"],
  ["Import CSV", "data", null, "upload bring in spreadsheet"],
  ["Signed-in devices", "sec", null, "sessions sign out everywhere"],
  ["Sign-in history", "sec", null, "login activity recent"],
  ["Delete account", "del", "f-del", "remove close"],
  ["Name", "profile", "f-name", "profile"],
  ["Email address", "profile", null, "verify"],
  ["Profile photo", "profile", null, "avatar picture upload"],
  ["Password", "pw", null, "change reset"],
  ...(GOOGLE_ON ? [["Google sign-in", "google", null, "linked account"] as [string, Section, null, string]] : []),
];
const viewOf = (s: Section): View => (s === "profile" || s === "pw" || s === "google" ? "account" : "settings");

export default function SettingsClient({
  view,
  data,
  section: initialSection,
  field: initialField,
}: {
  view: View;
  data: SettingsPageData;
  section?: string;
  field?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const userId = data.user.id;
  // Linked accounts only when Google sign-in is switched on (NEXT_PUBLIC_GOOGLE_AUTH).
  const sections = SECTIONS[view].filter(([id]) => id !== "google" || GOOGLE_ON);
  const [section, setSection] = useState<Section>(
    sections.find(([id]) => id === initialSection)?.[0] ?? sections[0][0],
  );
  const [settings, setSettings] = useState(data.settings);
  // Every amount below (and in the popups) is shown and typed in the user's number format.
  setNumberFormat(settings.number_format);
  const [categories, setCategories] = useState(data.categories);
  const [recurringItems, setRecurringItems] = useState(data.recurringItems);
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<"cats" | "rec" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [delText, setDelText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delError, setDelError] = useState<string | null>(null);

  const today = toLocalDateString();
  const schedule = useMemo(() => paySchedule(settings), [settings]);
  const period = useMemo(() => cycleFor(new Date(), schedule), [schedule]);
  const model = useMemo(
    () => buildCycleModel({ settings, categories, transactions: data.transactions, recurringItems, period, today }),
    [settings, categories, data.transactions, recurringItems, period, today],
  );
  const money = (p: number) => formatMoney(p, settings.number_format);
  const live = categories.filter((c) => c.is_active !== false);
  const fixedBills = live.filter((c) => c.type === "fixed").reduce((s, c) => s + Number(c.monthly_limit), 0);

  const focusField = (field: string) =>
    setTimeout(() => {
      const el = document.getElementById(field);
      if (!el) return;
      window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 120));
      el.focus({ preventScroll: true });
    }, 60);
  useEffect(() => {
    if (initialField) focusField(initialField);
  }, [initialField]);

  const goTo = (s: Section, field: string | null = null) => {
    setQ("");
    if (viewOf(s) !== view) {
      router.push(`${viewOf(s) === "account" ? "/settings/account" : "/settings"}?s=${s}${field ? `&f=${field}` : ""}`);
      return;
    }
    setSection(s);
    window.history.replaceState(null, "", `?s=${s}`);
    window.scrollTo(0, 0);
    if (field) focusField(field);
  };

  const refresh = async () => {
    const db = createClient();
    const [s, c, r] = await Promise.all([
      db.from("user_settings").select(SETTINGS_SELECT).eq("user_id", userId).single(),
      db.from("categories").select("*").eq("user_id", userId).order("name"),
      db.from("recurring_items").select("*").eq("user_id", userId).order("created_at"),
    ]);
    const failedQuery = [s, c, r].find((res) => res.error);
    if (failedQuery) {
      reportClientError("settings_refresh_failed", { userId, ...errorFields(failedQuery.error) });
      return toast("Saved, but couldn’t refresh. Reload the page.", { error: true });
    }
    setSettings(s.data as Settings);
    setCategories(c.data as Category[]);
    setRecurringItems(r.data as RecurringItem[]);
  };
  const withUndo = (undo: () => PromiseLike<{ error: unknown }>) => ({
    undo: async () => {
      const r = await undo();
      if (r.error) throw r.error;
      await refresh();
    },
  });

  const popupCtx: PopupContext = {
    userId,
    today,
    period,
    schedule,
    model,
    categories,
    transactions: data.transactions,
    recurringItems,
    goals: [],
    held: [],
    previewSafe: () => model.safe,
    saved: async (message, undo) => {
      await refresh();
      toast(message, undo && withUndo(undo));
    },
  };

  const downloadFirst = async () => {
    setExporting(true);
    const ok = await downloadAllData();
    setExporting(false);
    if (!ok) toast("Couldn’t download your data. Check your connection and try again.", { error: true });
  };
  const removeAccount = async () => {
    if (delText.trim() !== "DELETE" || deleting) return;
    if (!navigator.onLine) return setDelError("You’re offline. Reconnect and try again.");
    setDeleting(true);
    setDelError(null);
    const { error } = await deleteAccount(createClient(), userId);
    if (error) {
      reportClientError("delete_account_failed", { userId, ...errorFields(error) });
      setDeleting(false);
      return setDelError("Couldn’t delete your account. Check your connection and try again.");
    }
    window.location.href = "/";
  };

  const qq = q.trim().toLowerCase();
  const results = qq
    ? INDEX.filter(([label, s, , kw]) => `${label} ${kw} ${WHERE[s]}`.toLowerCase().includes(qq)).slice(0, 7)
    : [];
  const title = view === "account" ? "Account" : "Settings";
  const nFlex = live.filter((c) => c.type === "flexible").length;
  const recMonthly = recurringItems
    .filter((r) => r.active && r.type === "expense")
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="min-h-screen w-full overflow-x-clip">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-3.5 px-6 pt-[18px] pb-14 max-[480px]:px-4">
        <AppHeader
          inAccount
          account={{
            name: settings.display_name ?? null,
            email: data.user.email,
            avatarUrl: settings.avatar_url ?? null,
            verified: data.user.verified,
          }}
        />
        <div className="flex flex-wrap gap-x-12 gap-y-8 pt-[22px] max-[860px]:gap-y-4 max-[860px]:pt-4">
          <aside className="flex min-w-0 flex-[0_1_240px] flex-col gap-1 self-start max-[860px]:flex-[1_1_100%] min-[861px]:sticky min-[861px]:top-6 min-[861px]:max-h-[calc(100vh-48px)] min-[861px]:overflow-y-auto">
            <h1 className="m-0 mb-3.5 font-serif text-[44px] leading-none font-normal max-[860px]:text-[36px]">
              {title}
            </h1>
            <div className="relative mb-3">
              <Search
                size={15}
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQ("");
                  if (e.key === "Enter" && results[0]) goTo(results[0][1], results[0][2]);
                }}
                placeholder="Search settings"
                aria-label="Search settings"
                aria-controls="set-results"
                className="h-[42px] w-full rounded-xl border border-line-2 bg-tile pr-3 pl-9 text-sm text-ink outline-none focus:border-lime focus-visible:outline-none"
              />
              {qq && (
                <div
                  id="set-results"
                  role="listbox"
                  aria-label="Matching settings"
                  className="absolute top-12 right-0 left-0 z-40 flex flex-col rounded-[14px] border border-line-2 bg-tile p-1.5 shadow-[0_8px_24px_rgba(0,0,0,.25)]"
                >
                  {results.map(([label, s, field], i) => (
                    <button
                      key={label}
                      type="button"
                      role="option"
                      aria-selected={i === 0}
                      onClick={() => goTo(s, field)}
                      className="flex min-h-11 cursor-pointer flex-col items-start justify-center rounded-[10px] border-0 px-2.5 py-1.5 text-left hover:bg-tile-2"
                      style={{ background: i === 0 ? "var(--tile-2)" : undefined }}
                    >
                      <span className="text-sm font-semibold">{label}</span>
                      <span className="text-xs text-muted">{WHERE[s]}</span>
                    </button>
                  ))}
                  {results.length === 0 && (
                    <span className="px-2.5 py-3 text-[13px] text-muted">No settings match “{q.trim()}”.</span>
                  )}
                </div>
              )}
            </div>
            <nav
              aria-label={`${title} sections`}
              className="flex flex-col gap-1 [scrollbar-width:none] max-[860px]:-mx-6 max-[860px]:flex-row max-[860px]:overflow-x-auto max-[860px]:px-6 max-[480px]:-mx-4 max-[480px]:px-4 [&::-webkit-scrollbar]:hidden"
            >
              {sections.map(([id, label]) => {
                const on = section === id,
                  del = id === "del";
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => goTo(id)}
                    aria-current={on ? "true" : undefined}
                    className="flex h-10 flex-none cursor-pointer items-center rounded-xl border border-transparent px-3.5 text-left text-sm whitespace-nowrap transition-colors duration-150 hover:bg-tile-2 max-[860px]:border-line data-del:max-[860px]:ml-2 data-del:min-[861px]:mt-3.5"
                    style={{
                      background: on ? "var(--tile-2)" : "transparent",
                      borderColor: on ? "var(--line)" : undefined,
                      color: del ? "var(--danger)" : on ? "var(--ink)" : "var(--ink-2)",
                      fontWeight: on ? 600 : 500,
                    }}
                    data-del={del || undefined}
                  >
                    {label}
                  </button>
                );
              })}
            </nav>
          </aside>

          <main className="flex max-w-[720px] min-w-0 flex-[1_1_520px] flex-col gap-[22px]">
            {!data.user.verified && <VerifyBanner email={data.user.email} />}
            {section === "plan" && (
              <PlanSection
                settings={settings}
                schedule={schedule}
                today={today}
                cycleDays={period.totalDays}
                fixedBills={fixedBills}
                onApplied={async (message) => {
                  await refresh();
                  toast(
                    message,
                    withUndo(() => undoPlan(createClient())),
                  );
                }}
              />
            )}

            {section === "cats" && (
              <>
                <SectionHead
                  title="Categories & fixed bills"
                  lede="Changes here show up on the Dashboard straight away."
                />
                <Card>
                  <Row
                    label="Categories"
                    help={`${nFlex} flexible with spending limits · ${live.length - nFlex} fixed bills`}
                  >
                    <button type="button" onClick={() => setDialog("cats")} className={`${BTN_LINE} text-sm`}>
                      Edit categories
                    </button>
                  </Row>
                  <Row
                    label="Recurring items"
                    help={`${recurringItems.length} ${recurringItems.length === 1 ? "item" : "items"} · ${money(recMonthly)} a month going out`}
                  >
                    <button type="button" onClick={() => setDialog("rec")} className={`${BTN_LINE} text-sm`}>
                      Edit recurring
                    </button>
                  </Row>
                </Card>
              </>
            )}

            {section === "prefs" && (
              <PrefsSection settings={settings} onSaved={(patch) => setSettings((s) => ({ ...s, ...patch }))} />
            )}

            {section === "notif" && (
              <NotifSection settings={settings} onSaved={(patch) => setSettings((s) => ({ ...s, ...patch }))} />
            )}

            {section === "data" && <DataSection categories={categories} onImported={refresh} />}

            {section === "sec" && <SecuritySection onChangePassword={() => goTo("pw")} />}

            {section === "del" && (
              <>
                <SectionHead
                  title="Delete account"
                  danger
                  lede="This removes your plan, every entry, your goals and your login. It can’t be undone."
                />
                <div className="flex flex-col gap-4 rounded-[18px] border border-line bg-tile p-6 max-[480px]:p-[18px]">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl bg-tile-2 px-4 py-3.5">
                    <span className="flex-[1_1_240px] text-sm">
                      Want a copy first? Download your entries before you go.
                    </span>
                    <button type="button" onClick={downloadFirst} disabled={exporting} className={`${BTN_LINE} h-9`}>
                      {exporting ? "Preparing…" : "Download my data"}
                    </button>
                  </div>
                  <label htmlFor="f-del" className="text-sm font-semibold">
                    Type DELETE to confirm
                  </label>
                  <input
                    id="f-del"
                    value={delText}
                    autoComplete="off"
                    onChange={(e) => {
                      setDelText(e.target.value);
                      setDelError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && removeAccount()}
                    className={`${INPUT} max-w-[320px] tracking-[.06em]`}
                  />
                  {delError && (
                    <span role="alert" className="text-[13px] font-semibold text-danger">
                      {delError}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={removeAccount}
                    disabled={delText.trim() !== "DELETE" || deleting}
                    className="h-[46px] cursor-pointer self-start rounded-full border-0 px-5 text-sm font-bold transition-colors duration-200 disabled:cursor-not-allowed"
                    style={{
                      background: delText.trim() === "DELETE" ? "var(--danger)" : "var(--tile-2)",
                      color: delText.trim() === "DELETE" ? "var(--danger-ink)" : "var(--muted)",
                    }}
                  >
                    {deleting ? "Deleting…" : "Delete my account"}
                  </button>
                </div>
              </>
            )}

            {section === "pw" && <PasswordSection hasPassword={data.user.providers.includes("email")} />}
            {section === "google" && GOOGLE_ON && <GoogleSection email={data.user.email} />}

            {section === "profile" && (
              <ProfileSection
                user={data.user}
                settings={settings}
                onSaved={(patch) => setSettings((s) => ({ ...s, ...patch }))}
              />
            )}
          </main>
        </div>
      </div>

      {dialog === "cats" && <CategoriesDialog ctx={popupCtx} onClose={() => setDialog(null)} />}
      {dialog === "rec" && <RecurringListDialog ctx={popupCtx} onClose={() => setDialog(null)} />}
    </div>
  );
}
