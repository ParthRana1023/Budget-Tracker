// Row shapes the dashboard reads (amounts in paise, dates 'YYYY-MM-DD').
export type { RecurringItem } from "@/lib/recurringTypes";
import type { PlanChange } from "@/lib/periods.mjs";
import type { PaymentMethod } from "@/lib/paymentMethods.mjs";

export interface Category {
  id: string;
  name: string;
  type: "fixed" | "flexible";
  monthly_limit: number;
  due_day?: number | null;
  is_active?: boolean;
}

export interface Tx {
  id: string;
  type: "expense" | "income" | "savings_transfer" | "reserve_transfer";
  amount: number;
  date: string;
  note: string | null;
  category_id: string | null;
  external_id: string | null;
  source?: string | null;
  from_reserve?: boolean;
  payee?: string | null;
  /** How an expense was paid (lib/paymentMethods.mjs); null = not recorded. Tracking only. */
  payment_method?: PaymentMethod | null;
  /** Early income counted toward the cycle starting on this date ('YYYY-MM-DD'). */
  counts_from?: string | null;
  category?: { name: string; type: string } | null;
}

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  saved_before?: number;
}

export interface Contribution {
  goal_id: string;
  amount: number;
  date?: string | null;
}

export interface IncomeSource {
  id: string;
  name: string;
  type: string;
  status: "expected" | "received";
  amount: number;
  expected_date: string | null;
}

export interface Settings {
  /** Pay day from onboarding: 1-28, or 31 for the last day of the month. */
  month_start_day: number;
  /** Plan history: every change to salary, payday and save-first % (lib/plan.mjs, periods.mjs). */
  plan_changes?: PlanChange[] | null;
  display_name?: string | null;
  avatar_url?: string | null;
  number_format?: "indian" | "international" | "european";
  /** 0 = Sunday, 1 = Monday. */
  week_start?: 0 | 1;
  /** Theme saved to the account; null = not chosen yet. */
  theme?: "dark" | "light" | "system" | null;
  take_home_pay?: number | null;
  savings_pct?: number | null;
  onboarded_at?: string | null;
  /** Settings › Notifications (Notices on the Dashboard; email is backend-only for now). */
  notify_due?: boolean;
  notify_warn?: boolean;
  notify_over?: boolean;
  email_notifications?: boolean;
  weekly_summary?: boolean;
  /** Web Push kinds, sent to devices that turned push on (push_subscriptions). */
  push_bills?: boolean;
  push_weekly?: boolean;
  /** Email reminders this many days before a bill is due: 1, 3 or 7. */
  bill_reminder_days?: number;
  quiet_hours_on?: boolean;
  /** Local hours 0-23 in `timezone`; the window may wrap past midnight. */
  quiet_from?: number;
  quiet_to?: number;
  timezone?: string;
}

/** Small pill buttons used across the dashboard cards. */
export const PILL =
  "h-[34px] cursor-pointer rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200";
export const PILL_LINE = `${PILL} border border-line-2 bg-transparent hover:border-ink-2`;
export const PILL_LIME = `${PILL} border-0 bg-lime font-bold text-lime-ink active:scale-[.97]`;
export const LINK_BUTTON =
  "cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-lime-text hover:text-ink";
export const CARD_H2 = "m-0 font-serif text-[28px] leading-none font-normal";
