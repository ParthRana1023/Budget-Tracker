// Row shapes the dashboard reads (amounts in paise, dates 'YYYY-MM-DD').
export type { RecurringItem } from "@/lib/recurringTypes";

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
  month_start_day: number;
  take_home_pay?: number | null;
  savings_pct?: number | null;
  onboarded_at?: string | null;
}

/** Small pill buttons used across the dashboard cards. */
export const PILL =
  "h-[34px] cursor-pointer rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200";
export const PILL_LINE = `${PILL} border border-line-2 bg-transparent hover:border-ink-2`;
export const PILL_LIME = `${PILL} border-0 bg-lime font-bold text-lime-ink active:scale-[.97]`;
export const LINK_BUTTON =
  "cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-lime-text hover:text-ink";
export const CARD_H2 = "m-0 font-serif text-[28px] leading-none font-normal";
