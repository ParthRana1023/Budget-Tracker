/** A recurring schedule (row of public.recurring_items). Amounts are in paise. */
export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  type: "expense" | "income";
  category_id: string | null;
  /** 1-28 = recorded automatically once that day has ended; null = only suggested, never automatic. */
  day_of_month: number | null;
  active: boolean;
  income_type: "salary" | "variable" | "other";
}

/** One occurrence the database recorded automatically (shown in the alert, with Undo). */
export interface AutoRecordedEntry {
  transactionId: string;
  itemId: string;
  name: string;
  type: "expense" | "income";
  amount: number;
  date: string; // YYYY-MM-DD, the scheduled day
}
