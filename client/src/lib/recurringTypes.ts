/** A recurring schedule (row of public.recurring_items). Amounts are in paise. */
export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  type: "expense" | "income";
  category_id: string | null;
  /** 1-28 = due that day (added only when the user taps Record); null = no set day, only suggested. */
  day_of_month: number | null;
  /** 'YYYY-MM' the user chose "Skip this month" for; null = not skipped. */
  skip_month?: string | null;
  /** Default method for entries posted from this item (expenses only). */
  payment_method?: import("./paymentMethods.mjs").PaymentMethod | null;
  /** A foreign bill: its own amount and currency; `amount` is re-priced at each cycle's rate (fx_date). */
  original_amount?: number | null;
  original_currency?: string | null;
  fx_rate?: number | null;
  fx_date?: string | null;
  active: boolean;
  income_type: "salary" | "variable" | "other";
}
