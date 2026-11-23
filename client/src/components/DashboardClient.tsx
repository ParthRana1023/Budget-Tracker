"use client";

// Dashboard (design handoff, Dashboard). Numbers come from lib/cycleModel.mjs; this file
// loads and refreshes the rows, runs the one-tap actions and lays out the cards.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { cycleFor, paySchedule, toLocalDateString } from "@/lib/periods.mjs";
import { cycleKey, cycleKeyFor, cycleLabel, dayLabel, shortDate } from "@/lib/cycle.mjs";
import { payDayLabel, payDayStatus } from "@/lib/settings.mjs";
import { buildCycleModel } from "@/lib/cycleModel.mjs";
import { recurringStatus } from "@/lib/recurringStatus.mjs";
import { budgetWarnings } from "@/lib/notices.mjs";
import { inr, setCurrency, setNumberFormat } from "@/lib/money.mjs";
import { fetchRate, repricePatches, staleCurrencies } from "@/lib/fx.mjs";
import { transactionsToCsv } from "@/lib/csvExport.mjs";
import { syncSavedTheme } from "@/lib/theme";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import AppHeader, { type Tab } from "./AppHeader";
import BottomNav, { type NavTab } from "./BottomNav";
import More, { type MoreView } from "./dashboard/More";
import InstallCard from "./dashboard/InstallCard";
import { OfflineBanner, OfflineShell } from "./dashboard/Offline";
import { useOnline } from "./ui/useOnline";
import { useToast } from "./ui/Toast";
import SafeToSpend from "./dashboard/SafeToSpend";
import UntilPayday from "./dashboard/UntilPayday";
import Notices from "./dashboard/Notices";
import Budgets from "./dashboard/Budgets";
import Goals from "./dashboard/Goals";
import BillsRecurring from "./dashboard/BillsRecurring";
import Ledger from "./dashboard/Ledger";
import {
  LINK_BUTTON,
  type Category,
  type Contribution,
  type Goal,
  type IncomeSource,
  type RecurringItem,
  type Settings,
  type Tx,
} from "./dashboard/types";
import ExpenseDialog, { type ExpensePrefill } from "./dashboard/popups/ExpenseDialog";
import IncomeDialog from "./dashboard/popups/IncomeDialog";
import WindfallDialog from "./dashboard/popups/WindfallDialog";
import EditEntryDialog from "./dashboard/popups/EditEntryDialog";
import CategoriesDialog from "./dashboard/popups/CategoriesDialog";
import RecurringDialog from "./dashboard/popups/RecurringDialog";
import type { PopupContext } from "./dashboard/popups/context";
import ReportsView from "./ReportsView";

const NOTES_OFF_KEY = "sf-notes-off";
const TX_SELECT = "*, category:categories(name, type)";

/**
 * The Dashboard and Reports tabs, plus the phone-only pages (design handoff v3, Mobile):
 * /ledger, /more and, from More, /bills, /budgets, /goals. They switch in place with the
 * URL kept in step; on 720px and wider a phone page becomes /dashboard#section.
 */
export type View = Tab | "ledger" | "more" | MoreView;
const PHONE_VIEWS: View[] = ["ledger", "more", "bills", "budgets", "goals"];
const urlFor = (v: View) => (v === "dashboard" ? "/dashboard" : v === "reports" ? "/dashboard?view=reports" : `/${v}`);
const viewAt = (path: string, search: string): View => {
  const v = path.slice(1) as View;
  if (PHONE_VIEWS.includes(v)) return v;
  return new URLSearchParams(search).get("view") === "reports" ? "reports" : "dashboard";
};
const NAV_TAB: Record<View, NavTab> = {
  dashboard: "home",
  reports: "reports",
  ledger: "ledger",
  more: "more",
  bills: "more",
  budgets: "more",
  goals: "more",
};
/** Where a phone page lives on the wide Dashboard. */
const SECTION: Partial<Record<View, string>> = {
  ledger: "ledger",
  bills: "bills",
  budgets: "budgets",
  goals: "budgets",
};
const PHONE_MQ = "(max-width: 719.98px)";
const OFFLINE_EYEBROW: Record<View, string> = {
  dashboard: "Safe to spend this cycle",
  reports: "Reports",
  ledger: "Ledger",
  more: "More",
  bills: "Bills & recurring",
  budgets: "Budgets",
  goals: "Goals",
};

interface DashboardClientProps {
  initialUser: { id: string; email?: string; verified: boolean };
  initialSettings: Settings | null;
  initialCategories: Category[];
  initialTransactions: Tx[];
  initialIncomeSources: IncomeSource[];
  initialSavingsGoals: Goal[];
  initialContributions: Contribution[];
  initialRecurringItems: RecurringItem[];
  /** "reports" for /dashboard?view=reports; a phone page for /ledger, /more, /bills, /budgets, /goals. */
  initialView?: View;
  /** Opens Log expense on arrival (/dashboard?add=expense, the installed app's shortcut). */
  initialAdd?: boolean;
}

export default function DashboardClient(props: DashboardClientProps) {
  const userId = props.initialUser.id;
  const toast = useToast();
  const [view, setView] = useState<View>(props.initialView ?? "dashboard");
  const go = (v: View) => {
    setView(v);
    if (window.location.pathname + window.location.search !== urlFor(v)) window.history.pushState(null, "", urlFor(v));
    window.scrollTo(0, 0);
  };
  const [settings] = useState<Settings | null>(props.initialSettings);
  // Every amount below is shown and typed in the user's number format.
  setNumberFormat(settings?.number_format);
  setCurrency(settings?.currency);
  const [categories, setCategories] = useState(props.initialCategories);
  const [transactions, setTransactions] = useState(props.initialTransactions);
  const [incomeSources, setIncomeSources] = useState(props.initialIncomeSources);
  const [goals, setGoals] = useState(props.initialSavingsGoals);
  const [contributions, setContributions] = useState(props.initialContributions);
  const [recurringItems, setRecurringItems] = useState(props.initialRecurringItems);
  const [notesOff, setNotesOff] = useState<string[]>([]);
  const offline = !useOnline();
  const [retrying, setRetrying] = useState(false);
  /** When these numbers last came from the server (shown while offline). */
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Popups.
  const [expense, setExpense] = useState<ExpensePrefill | null>(null);
  const [income, setIncome] = useState<{ expected: boolean; typed?: string } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [editing, setEditing] = useState<Tx | null>(null);
  const [windfallId, setWindfallId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
  const openExpense = (prefill: ExpensePrefill = {}) => setExpense(prefill);
  const openIncome = (expected = false) => setIncome({ expected });

  useEffect(() => {
    try {
      setNotesOff(JSON.parse(localStorage.getItem(NOTES_OFF_KEY) ?? "[]"));
    } catch {}
    // Opened after mount: the popup is a portal, which can't render on the server.
    if (props.initialAdd) {
      setExpense({});
      window.history.replaceState(null, "", "/dashboard"); // a reload shouldn't reopen it
    }
    setSyncedAt(new Date());
  }, []);
  // Back online: fetch fresh numbers before showing any.
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (offline) return setWasOffline(true);
    if (wasOffline) void refreshData();
  }, [offline]);

  // Back / Forward between in-place pages; a phone page on a wide screen becomes its section.
  const [jump, setJump] = useState<string | null>(null);
  useEffect(() => {
    if (!jump || view !== "dashboard") return;
    document.getElementById(jump)?.scrollIntoView();
    setJump(null);
  }, [jump, view]);
  useEffect(() => {
    const onPop = () => setView(viewAt(window.location.pathname, window.location.search));
    const mq = window.matchMedia(PHONE_MQ);
    const toWide = () => {
      const v = viewAt(window.location.pathname, window.location.search);
      if (mq.matches || !PHONE_VIEWS.includes(v)) return;
      const id = SECTION[v];
      window.history.replaceState(null, "", `/dashboard${id ? `#${id}` : ""}`);
      setView("dashboard");
      setJump(id ?? null);
    };
    toWide();
    window.addEventListener("popstate", onPop);
    mq.addEventListener("change", toWide);
    return () => {
      window.removeEventListener("popstate", onPop);
      mq.removeEventListener("change", toWide);
    };
  }, []);

  // The theme saved to the account follows the user across devices.
  useEffect(() => syncSavedTheme(settings?.theme), [settings?.theme]);

  const today = toLocalDateString();
  const schedule = useMemo(() => paySchedule(settings), [settings]);
  const period = useMemo(() => cycleFor(new Date(), schedule), [schedule]);
  const pendingPayDay = payDayStatus(schedule, today).pending;
  const activeCategories = useMemo(() => categories.filter((c) => c.is_active !== false), [categories]);
  const model = useMemo(
    () => buildCycleModel({ settings, categories, transactions, recurringItems, period, today }),
    [settings, categories, transactions, recurringItems, period, today],
  );
  const statusCtx = { cycleTransactions: model.cycleTransactions, period, today };
  const due = recurringItems
    .map((item) => ({ item, st: recurringStatus(item, statusCtx) }))
    .filter(({ item, st }) => settings?.notify_due !== false && item.active && st.key === "due")
    .map(({ item, st }) => ({ item, dueDate: st.dueDate! }));
  // Settings › Notifications: 80% warnings and over-limit warnings can each be turned off.
  const warnings = budgetWarnings({ flex: model.flex, spentByCat: model.spentByCat, dismissed: notesOff }).filter(
    (w) => (w.level === "80" ? settings?.notify_warn : settings?.notify_over) !== false,
  );
  const held = incomeSources.filter((i) => i.status === "expected");
  const holdTotal = held.reduce((s, i) => s + Number(i.amount), 0);

  // More (phones): a live summary under each Plan row. Bills still to pay counts the same
  // things as "still to pay" on Bills & recurring.
  const billsLeft =
    model.fixed.filter((c) => Number(c.monthly_limit) > (model.spentByCat.get(c.id) ?? 0)).length +
    recurringItems.filter(
      (r) =>
        r.type === "expense" &&
        model.byId.get(r.category_id ?? "")?.type !== "fixed" &&
        ["due", "upcoming"].includes(recurringStatus(r, statusCtx).key),
    ).length;
  const goalsSaved = goals.reduce(
    (s, g) =>
      s +
      Number(g.saved_before ?? 0) +
      contributions.filter((c) => c.goal_id === g.id).reduce((t, c) => t + Number(c.amount), 0),
    0,
  );
  const morePlan = {
    bills: billsLeft ? `${billsLeft} still to pay this cycle` : "All paid this cycle",
    budgets: `${inr(model.flexSpent)} of ${inr(model.flexBudget)} spent`,
    goals: goals.length
      ? `${goals.length} ${goals.length === 1 ? "goal" : "goals"} · ${inr(goalsSaved)} saved`
      : "No goals yet",
  };

  const refreshData = async () => {
    const supabase = createClient();
    const [cat, tx, inc, goal, contrib, rec] = await Promise.all([
      supabase.from("categories").select("*").eq("user_id", userId).order("name"),
      supabase.from("transactions").select(TX_SELECT).eq("user_id", userId).order("date", { ascending: false }),
      supabase.from("income_sources").select("*").eq("user_id", userId),
      supabase.from("savings_goals").select("*").eq("user_id", userId),
      supabase.from("goal_contributions").select("goal_id, amount, date").eq("user_id", userId),
      supabase.from("recurring_items").select("*").eq("user_id", userId),
    ]);
    const failedQuery = [cat, tx, inc, goal, contrib, rec].find((r) => r.error);
    if (failedQuery) {
      reportClientError("dashboard_refresh_failed", { ...errorFields(failedQuery.error), userId });
      setLoadFailed(true);
      return false;
    }
    setLoadFailed(false);
    setSyncedAt(new Date());
    setCategories(cat.data as Category[]);
    setTransactions(tx.data as Tx[]);
    setIncomeSources(inc.data as IncomeSource[]);
    setGoals(goal.data as Goal[]);
    setContributions(contrib.data as Contribution[]);
    setRecurringItems(rec.data as RecurringItem[]);
    return true;
  };

  /** One-tap write: refuses offline, refreshes on success, toasts with an optional Undo. */
  const act = async (
    write: () => PromiseLike<{ error: unknown; data?: unknown }>,
    message: string,
    failMessage: string,
    undo?: (data: unknown) => PromiseLike<{ error: unknown }>,
  ) => {
    if (!navigator.onLine) return toast("You’re offline, so this wasn’t saved.", { error: true });
    const { error, data } = await write();
    if (error) {
      reportClientError("dashboard_action_failed", { userId, ...errorFields(error), message });
      return toast(failMessage, { error: true });
    }
    await refreshData();
    toast(
      message,
      undo && {
        undo: async () => {
          const r = await undo(data);
          if (r.error) throw r.error;
          await refreshData();
        },
      },
    );
  };

  const db = () => createClient();

  // Foreign bills, category limits and goal targets follow each cycle's rate: once a new cycle
  // starts, fetch it (one call per currency) and re-price them. A fallback (stale) rate is never locked in.
  useEffect(() => {
    const cycleStart = period.startStr;
    const stale = staleCurrencies([...recurringItems, ...categories, ...goals], cycleStart);
    if (!stale.length) return;
    void (async () => {
      const rates = new Map<string, number>();
      for (const c of stale) {
        const r = await fetchRate(c, cycleStart).catch(() => null);
        if (r && !r.stale) rates.set(c, r.rate);
      }
      const writes = [
        ...repricePatches(recurringItems, "amount", cycleStart, rates).map((p) =>
          db().from("recurring_items").update(p.patch).eq("id", p.id),
        ),
        ...repricePatches(categories, "monthly_limit", cycleStart, rates).map((p) =>
          db().from("categories").update(p.patch).eq("id", p.id),
        ),
        ...repricePatches(goals, "target_amount", cycleStart, rates).map((p) =>
          db().from("savings_goals").update(p.patch).eq("id", p.id),
        ),
      ];
      if (!writes.length) return;
      await Promise.all(writes);
      await refreshData();
    })();
  }, [period.startStr]);

  const recordItem = (item: RecurringItem) => {
    const st = recurringStatus(item, statusCtx);
    const date = st.dueDate && st.dueDate <= today ? st.dueDate : today;
    act(
      () =>
        db().rpc("record_entry_with_recurring", {
          p_type: item.type,
          p_amount: Number(item.amount),
          p_date: date,
          p_category_id: item.category_id,
          p_note: item.name,
          p_item_id: item.id,
          p_income_type: item.income_type,
          p_cycle_key: cycleKeyFor(date, schedule),
        }),
      `Recorded ${item.name} · ${inr(item.amount)}`,
      `Couldn’t record ${item.name}. Try again.`,
      (txId) =>
        db()
          .from("transactions")
          .delete()
          .eq("id", txId as string),
    );
  };
  const skipItem = (item: RecurringItem) =>
    act(
      () =>
        db()
          .from("recurring_items")
          .update({ skip_month: cycleKey(period) })
          .eq("id", item.id),
      `Skipped ${item.name} for this cycle`,
      `Couldn’t skip ${item.name}. Try again.`,
      () => db().from("recurring_items").update({ skip_month: null }).eq("id", item.id),
    );
  const toggleItem = (item: RecurringItem) =>
    act(
      () => db().from("recurring_items").update({ active: !item.active }).eq("id", item.id),
      item.active ? `${item.name} stopped repeating · past entries kept` : `${item.name} repeats again`,
      `Couldn’t update ${item.name}. Try again.`,
      () => db().from("recurring_items").update({ active: item.active }).eq("id", item.id),
    );
  const dismiss = (key: string) => {
    const next = [...notesOff, key];
    setNotesOff(next);
    try {
      localStorage.setItem(NOTES_OFF_KEY, JSON.stringify(next));
    } catch {}
  };
  const retryOnline = async () => {
    setRetrying(true);
    const ok = navigator.onLine && (await refreshData());
    setRetrying(false);
    toast(ok ? "Back online" : "Still offline. We’ll reconnect when the network is back.", {
      tone: ok ? "done" : "offline",
    });
  };
  /** Add, Log expense and Record income stay tappable offline so they can explain themselves. */
  const needsNet = (open: () => void) => () =>
    offline ? toast("Adding needs a connection. Try again when you’re back online.", { tone: "offline" }) : open();
  const exportCsv = () => {
    const blob = new Blob([`﻿${transactionsToCsv(transactions as never[])}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `savefirst-${period.startStr.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${transactions.length} entries as CSV`);
  };

  const popupCtx: PopupContext = {
    userId,
    today,
    period,
    schedule,
    model,
    categories,
    transactions,
    recurringItems,
    goals,
    held,
    previewSafe: (extra, removeId) =>
      buildCycleModel({
        settings,
        categories,
        recurringItems,
        period,
        today,
        transactions: [...transactions.filter((t) => t.id !== removeId), ...(extra as Tx[])],
      }).safe,
    saved: async (message, undo) => {
      await refreshData();
      toast(
        message,
        undo && {
          undo: async () => {
            const r = await undo();
            if (r.error) throw r.error;
            await refreshData();
          },
        },
      );
    },
  };

  const dateLong = new Date(`${today}T12:00:00`)
    .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .replace(/^(\w+) /, "$1, ");

  return (
    <div className="min-h-screen w-full overflow-x-clip">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-3.5 px-6 pt-[18px] pb-14 max-[480px]:px-3.5">
        <AppHeader
          account={{
            name: settings?.display_name ?? null,
            email: props.initialUser.email ?? "",
            avatarUrl: settings?.avatar_url ?? null,
            verified: props.initialUser.verified,
          }}
          current={view === "reports" ? "reports" : "dashboard"}
          onTab={go}
        >
          {view === "dashboard" && (
            <>
              <button
                type="button"
                onClick={needsNet(() => openIncome())}
                aria-disabled={offline || undefined}
                className="h-[38px] cursor-pointer aria-disabled:opacity-45 rounded-full border border-line bg-transparent px-[15px] text-[13px] font-semibold transition-[border-color,transform] hover:border-ink-2 active:scale-[.96] max-[720px]:hidden"
              >
                Record income
              </button>
              <button
                type="button"
                id="open-fast-expense-btn"
                onClick={needsNet(() => openExpense())}
                aria-disabled={offline || undefined}
                className="flex h-[38px] cursor-pointer aria-disabled:opacity-45 items-center gap-2 rounded-full border-0 bg-lime px-4 text-sm font-bold text-lime-ink transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_8px_24px_-10px_var(--lime)] active:scale-[.96] max-[720px]:hidden"
              >
                <Plus size={16} />
                Log expense
              </button>
            </>
          )}
        </AppHeader>

        {offline && <OfflineBanner retrying={retrying} onRetry={retryOnline} />}
        {offline && view !== "more" ? (
          <OfflineShell eyebrow={OFFLINE_EYEBROW[view]} syncedAt={syncedAt} tiles={view === "dashboard"} />
        ) : view === "reports" ? (
          <ReportsView
            transactions={transactions}
            categories={categories}
            settings={settings}
            recurringItems={recurringItems}
            today={today}
            onChanged={refreshData}
          />
        ) : view === "more" ? (
          <More
            plan={morePlan}
            verified={props.initialUser.verified}
            offline={offline}
            onGo={go}
            onHome={() => go("dashboard")}
          />
        ) : loadFailed ? (
          <section
            role="alert"
            className="flex flex-col items-start gap-3.5 rounded-[18px] border border-line bg-tile p-[clamp(24px,5vw,40px)]"
          >
            <span className="eyebrow text-danger">Couldn’t load</span>
            <h2 className="m-0 font-serif text-[clamp(34px,5vw,48px)] leading-none font-normal text-pretty">
              Your numbers didn’t <em>load.</em>
            </h2>
            <p className="m-0 max-w-[520px] font-serif text-xl leading-[1.35] text-pretty text-ink-2 italic">
              Nothing you entered has been lost. Try again, or check the status page if it keeps happening.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 pt-1.5">
              <button
                type="button"
                onClick={refreshData}
                className="h-11 cursor-pointer rounded-full border-0 bg-lime px-5 text-sm font-bold text-lime-ink active:scale-[.97]"
              >
                Try again
              </button>
            </div>
          </section>
        ) : (
          <>
            {(view === "bills" || view === "budgets" || view === "goals") && (
              <button
                type="button"
                onClick={() => go("more")}
                className="-mt-2 -mb-1 -ml-2.5 flex h-11 cursor-pointer items-center gap-0.5 self-start rounded-full border-0 bg-transparent pr-3.5 pl-1.5 text-sm font-semibold text-ink-2 hover:text-ink active:bg-tile-2"
              >
                <ChevronLeft size={20} aria-hidden />
                More
              </button>
            )}
            {view === "dashboard" && (
              <>
                <div className="eyebrow flex flex-wrap justify-between gap-x-6 gap-y-1.5 px-1 pb-1">
                  <span>{dateLong}</span>
                  <span>
                    {cycleLabel(period)}
                    {pendingPayDay &&
                      ` · Payday moves to the ${payDayLabel(pendingPayDay.payDay)} from ${shortDate(pendingPayDay.from)}`}
                  </span>
                </div>

                <InstallCard />

                <Notices
                  due={due}
                  warnings={warnings}
                  daysLeft={period.daysRemaining}
                  today={today}
                  onRecord={recordItem}
                  onSkip={skipItem}
                  onDismiss={dismiss}
                />

                <div className="flex flex-wrap gap-3.5">
                  <SafeToSpend model={model} daysLeft={period.daysRemaining} />
                  <UntilPayday
                    model={model}
                    period={period}
                    today={today}
                    transactions={transactions}
                    recurringItems={recurringItems}
                  />
                </div>

                <div className="flex flex-wrap gap-3.5">
                  <section
                    className="sf-rise flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-[18px] border border-line bg-tile p-[22px]"
                    style={{ animationDelay: ".46s" }}
                  >
                    <span className="eyebrow text-warn">On hold</span>
                    <span className="tabular font-serif text-[44px] leading-none">{inr(holdTotal)}</span>
                    <p className="m-0 text-sm text-pretty text-ink-2">
                      {held.length === 0
                        ? "Nothing on hold. Bonuses and incentives you expect will wait here."
                        : held.length === 1
                          ? `${held[0].name}${held[0].expected_date ? `, expected ${dayLabel(held[0].expected_date, today)}` : ""}. Not counted until it reaches your bank.`
                          : `${held.length} payments expected. None count until they reach your bank.`}
                    </p>
                    {held.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setWindfallId(held[0].id)}
                        className="mt-auto h-[38px] cursor-pointer self-start rounded-full border border-line-2 bg-transparent px-4 text-[13px] font-semibold transition-colors hover:border-ink hover:bg-ink hover:text-bg"
                      >
                        Mark received &amp; allocate
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openIncome(true)}
                        className={`${LINK_BUTTON} mt-auto self-start`}
                      >
                        Record expected income
                      </button>
                    )}
                  </section>
                  <section
                    className="sf-rise flex min-w-0 flex-[1_1_300px] flex-col gap-2.5 rounded-[18px] border border-line bg-tile p-[22px]"
                    style={{ animationDelay: ".52s" }}
                  >
                    <span className="eyebrow">Annual bills reserve</span>
                    <span className="tabular font-serif text-[44px] leading-none">{inr(model.reserveLeft)}</span>
                    <p className="m-0 text-sm text-pretty text-ink-2">
                      {model.reserveIn > 0
                        ? `${inr(model.reserveIn)} set aside from windfalls · ${inr(model.reserveOut)} used`
                        : "Nothing set aside yet. Split part of a bonus here for insurance, taxes or a car service."}
                    </p>
                    {model.reserveLeft > 0 && (
                      <button
                        type="button"
                        onClick={() => openExpense({ fromReserve: true })}
                        className={`${LINK_BUTTON} mt-auto self-start`}
                      >
                        Pay a bill from it
                      </button>
                    )}
                  </section>
                </div>
              </>
            )}

            {/* Phones: budgets, goals, bills and the ledger move to their own pages. */}
            {(view === "dashboard" || view === "budgets" || view === "goals") && (
              <div
                id="budgets"
                className={`flex scroll-mt-20 flex-wrap gap-3.5 ${view === "dashboard" ? "max-[720px]:hidden" : ""}`}
              >
                {view !== "goals" && (
                  <Budgets
                    flex={model.flex}
                    spentByCat={model.spentByCat}
                    flexSpent={model.flexSpent}
                    flexBudget={model.flexBudget}
                    onManage={() => setCategoriesOpen(true)}
                  />
                )}
                {view !== "budgets" && (
                  <Goals
                    goals={goals}
                    contributions={contributions}
                    userId={userId}
                    today={today}
                    cycleStart={period.startStr}
                    onChanged={async () => void (await refreshData())}
                  />
                )}
              </div>
            )}

            {(view === "dashboard" || view === "bills") && (
              <div id="bills" className={`scroll-mt-20 ${view === "dashboard" ? "max-[720px]:hidden" : ""}`}>
                <BillsRecurring
                  items={recurringItems}
                  fixed={model.fixed}
                  byId={model.byId}
                  spentByCat={model.spentByCat}
                  skippedCats={model.skippedCats}
                  cycleTransactions={model.cycleTransactions as Tx[]}
                  unpaidBills={model.unpaidBills}
                  period={period}
                  today={today}
                  onRecord={recordItem}
                  onToggle={toggleItem}
                  onPayBill={(c) =>
                    openExpense({
                      categoryId: c.id,
                      amount: Math.max(0, Number(c.monthly_limit) - (model.spentByCat.get(c.id) ?? 0)),
                      note: c.name,
                    })
                  }
                  onEdit={setEditingItem}
                  onManage={() => setCategoriesOpen(true)}
                />
              </div>
            )}

            {(view === "dashboard" || view === "ledger") && (
              <div id="ledger" className={`scroll-mt-20 ${view === "dashboard" ? "max-[720px]:hidden" : ""}`}>
                <Ledger
                  entries={model.cycleTransactions as Tx[]}
                  byId={model.byId}
                  today={today}
                  onEdit={setEditing}
                  onExport={exportCsv}
                  onIncome={() => openIncome()}
                  onExpense={() => openExpense()}
                  alwaysOpen={view === "ledger"}
                />
              </div>
            )}
          </>
        )}
        <BottomNav
          current={NAV_TAB[view]}
          onGo={(t) => go(t === "home" ? "dashboard" : t)}
          onAdd={needsNet(() => openExpense())}
          addDisabled={offline}
        />
      </div>

      {expense && (
        <ExpenseDialog
          ctx={popupCtx}
          prefill={expense}
          onClose={() => setExpense(null)}
          onSwitch={
            Object.keys(expense).length === 0 || expense.typed !== undefined
              ? (typed) => {
                  setExpense(null);
                  setIncome({ expected: false, typed });
                }
              : undefined
          }
        />
      )}
      {income && (
        <IncomeDialog
          ctx={popupCtx}
          expected={income.expected}
          typed={income.typed}
          onClose={() => setIncome(null)}
          onSwitch={
            income.expected
              ? undefined
              : (typed) => {
                  setIncome(null);
                  setExpense({ typed });
                }
          }
        />
      )}
      {windfallId && <WindfallDialog ctx={popupCtx} incomeId={windfallId} onClose={() => setWindfallId(null)} />}
      {editing && <EditEntryDialog ctx={popupCtx} entry={editing} onClose={() => setEditing(null)} />}
      {categoriesOpen && <CategoriesDialog ctx={popupCtx} onClose={() => setCategoriesOpen(false)} />}
      {editingItem && <RecurringDialog ctx={popupCtx} item={editingItem} onClose={() => setEditingItem(null)} />}
    </div>
  );
}
