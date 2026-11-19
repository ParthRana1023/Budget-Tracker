import type { buildCycleModel } from "@/lib/cycleModel.mjs";
import type { PayDayEntry } from "@/lib/periods.mjs";
import type { Category, Goal, IncomeSource, RecurringItem, Tx } from "../types";

/** What every dashboard popup needs from the dashboard. */
export type PopupContext = {
  userId: string;
  today: string;
  period: { startStr: string; endStr: string; daysRemaining: number; totalDays: number; daysElapsed: number };
  /** Pay-day schedule (onboarding pay day + changes), for the cycle of a back-dated entry. */
  schedule: PayDayEntry[];
  model: ReturnType<typeof buildCycleModel>;
  categories: Category[];
  transactions: Tx[];
  recurringItems: RecurringItem[];
  goals: Goal[];
  held: IncomeSource[];
  /** Safe to spend if `extra` were added and `removeId` (an entry being edited) taken out. */
  previewSafe: (extra: Partial<Tx>[], removeId?: string) => number;
  /** After a successful save: refresh, close-safe toast with optional Undo. */
  saved: (message: string, undo?: () => PromiseLike<{ error: unknown }>) => Promise<void>;
};
