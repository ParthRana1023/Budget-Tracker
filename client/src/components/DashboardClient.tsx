"use client";

// Dashboard (design handoff, Dashboard). Numbers come from lib/cycleModel.mjs; this file
// loads and refreshes the rows, runs the one-tap actions and lays out the cards.

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { cycleFor, paySchedule, toLocalDateString } from "@/lib/periods.mjs";
import { cycleKey, cycleKeyFor, cycleLabel, dayLabel, shortDate } from "@/lib/cycle.mjs";
import { payDayLabel, payDayStatus } from "@/lib/settings.mjs";
import { buildCycleModel } from "@/lib/cycleModel.mjs";
import { recurringStatus } from "@/lib/recurringStatus.mjs";
import { budgetWarnings } from "@/lib/notices.mjs";
import { inr, setNumberFormat } from "@/lib/money.mjs";
import { transactionsToCsv } from "@/lib/csvExport.mjs";
import { syncSavedTheme } from "@/lib/theme";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import AppHeader, { type Tab } from "./AppHeader";
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

interface DashboardClientProps {
  initialUser: { id: string; email?: string; verified: boolean };
  initialSettings: Settings | null;
  initialCategories: Category[];
  initialTransactions: Tx[];
  initialIncomeSources: IncomeSource[];
  initialSavingsGoals: Goal[];
  initialContributions: Contribution[];
  initialRecurringItems: RecurringItem[];
  /** "reports" when opened from another page's Reports tab (/dashboard?view=reports). */
  initialView?: Tab;
  /** Opens Log expense on arrival (/dashboard?add=expense, the installed app's shortcut). */
  initialAdd?: boolean;
}

export default function DashboardClient(props: DashboardClientProps) {
  const userId = props.initialUser.id;
  const toast = useToast();
  const [view, setView] = useState<Tab>(props.initialView ?? "dashboard");
  const [settings] = useState<Settings | null>(props.initialSettings);
  // Every amount below is shown and typed in the user's number format.
  setNumberFormat(settings?.number_format);
  const [categories, setCategories] = useState(props.initialCategories);
  const [transactions, setTransactions] = useState(props.initialTransactions);
  const [incomeSources, setIncomeSources] = useState(props.initialIncomeSources);
  const [goals, setGoals] = useState(props.initialSavingsGoals);
  const [contributions, setContributions] = useState(props.initialContributions);
  const [recurringItems, setRecurringItems] = useState(props.initialRecurringItems);
  const [notesOff, setNotesOff] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Popups.
  const [expense, setExpense] = useState<ExpensePrefill | null>(null);
  const [income, setIncome] = useState<{ expected: boolean } | null>(null);
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
    const onNet = () => setOffline(!navigator.onLine);
    onNet();
    window.addEventListener("online", onNet);
    window.addEventListener("offline", onNet);
    return () => {
      window.removeEventListener("online", onNet);
      window.removeEventListener("offline", onNet);
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
    setOffline(!ok);
    toast(
      ok ? "Back online" : "Still offline. We’ll reconnect when the network is back.",
      ok ? undefined : { error: true },
    );
  };
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
          current={view}
          onTab={(v) => {
            setView(v);
            window.scrollTo(0, 0);
          }}
        >
          {view === "dashboard" && (
            <>
              <button
                type="button"
                onClick={() => openIncome()}
                className="h-[38px] cursor-pointer rounded-full border border-line bg-transparent px-[15px] text-[13px] font-semibold transition-[border-color,transform] hover:border-ink-2 active:scale-[.96] max-[720px]:hidden"
              >
                Record income
              </button>
              <button
                type="button"
                id="open-fast-expense-btn"
                onClick={() => openExpense()}
                className="flex h-[38px] cursor-pointer items-center gap-2 rounded-full border-0 bg-lime px-4 text-sm font-bold text-lime-ink transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_8px_24px_-10px_var(--lime)] active:scale-[.96] max-[720px]:hidden"
              >
                <Plus size={16} />
                Log expense
              </button>
            </>
          )}
        </AppHeader>

        {view === "reports" ? (
          <ReportsView
            transactions={transactions}
            categories={categories}
            settings={settings}
            recurringItems={recurringItems}
            today={today}
            onChanged={refreshData}
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
            <div className="eyebrow flex flex-wrap justify-between gap-x-6 gap-y-1.5 px-1 pb-1">
              <span>{dateLong}</span>
              <span>
                {cycleLabel(period)}
                {pendingPayDay &&
                  ` · Payday moves to the ${payDayLabel(pendingPayDay.payDay)} from ${shortDate(pendingPayDay.from)}`}
              </span>
            </div>

            <Notices
              offline={offline}
              retrying={retrying}
              onRetry={retryOnline}
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

            <div className="flex flex-wrap gap-3.5">
              <Budgets
                flex={model.flex}
                spentByCat={model.spentByCat}
                flexSpent={model.flexSpent}
                flexBudget={model.flexBudget}
                onManage={() => setCategoriesOpen(true)}
              />
              <Goals
                goals={goals}
                contributions={contributions}
                userId={userId}
                today={today}
                cycleStart={period.startStr}
                onChanged={async () => void (await refreshData())}
              />
            </div>

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

            <Ledger
              entries={model.cycleTransactions as Tx[]}
              byId={model.byId}
              today={today}
              onEdit={setEditing}
              onExport={exportCsv}
              onIncome={() => openIncome()}
              onExpense={() => openExpense()}
            />
          </>
        )}
        {view === "dashboard" && <div aria-hidden className="h-[76px] min-[720px]:hidden" />}
      </div>

      {view === "dashboard" && (
        <nav
          aria-label="Quick actions"
          className="fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t border-line bg-bg px-3.5 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] min-[720px]:hidden"
        >
          <button
            type="button"
            onClick={() => openIncome()}
            className="h-[50px] flex-1 cursor-pointer rounded-full border border-line-2 bg-transparent text-sm font-semibold active:scale-[.97]"
          >
            Record income
          </button>
          <button
            type="button"
            onClick={() => openExpense()}
            className="flex h-[50px] flex-[1.4] cursor-pointer items-center justify-center gap-2 rounded-full border-0 bg-lime text-[15px] font-bold text-lime-ink active:scale-[.97]"
          >
            <Plus size={16} />
            Log expense
          </button>
        </nav>
      )}

      {expense && <ExpenseDialog ctx={popupCtx} prefill={expense} onClose={() => setExpense(null)} />}
      {income && <IncomeDialog ctx={popupCtx} expected={income.expected} onClose={() => setIncome(null)} />}
      {windfallId && <WindfallDialog ctx={popupCtx} incomeId={windfallId} onClose={() => setWindfallId(null)} />}
      {editing && <EditEntryDialog ctx={popupCtx} entry={editing} onClose={() => setEditing(null)} />}
      {categoriesOpen && <CategoriesDialog ctx={popupCtx} onClose={() => setCategoriesOpen(false)} />}
      {editingItem && <RecurringDialog ctx={popupCtx} item={editingItem} onClose={() => setEditingItem(null)} />}
    </div>
  );
}
