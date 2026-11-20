// Settings backend helpers (no Settings screen yet: it will be designed later).
// Amounts are paise; dates are local 'YYYY-MM-DD'.

import { addDaysStr } from "./cycle.mjs";
import { cycleFor } from "./periods.mjs";
import { transactionsToCsv } from "./csvExport.mjs";

/** @typedef {import("./periods.mjs").PayDayEntry} PayDayEntry */

const toDate = (/** @type {string} */ s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Start date of the cycle after the one containing `today`: when a new pay day takes effect.
 * @param {PayDayEntry[]} schedule @param {string} today
 */
export const nextCycleStart = (schedule, today) => addDaysStr(cycleFor(toDate(today), schedule).endStr, 1);

/**
 * The pay day in force today, and a change waiting for the next cycle, if any.
 * @param {PayDayEntry[]} schedule @param {string} today
 * @returns {{ current: number, pending: { payDay: number, from: string } | null }}
 */
export function payDayStatus(schedule, today) {
  let current = schedule.find((e) => !e.from)?.payDay ?? 1;
  /** @type {{ payDay: number, from: string } | null} */
  let pending = null;
  for (const e of [...schedule].filter((e) => e.from).sort((a, b) => (String(a.from) < String(b.from) ? -1 : 1))) {
    const from = /** @type {string} */ (e.from);
    if (from <= today) current = e.payDay;
    else if (!pending) pending = { payDay: e.payDay, from };
  }
  return { current, pending };
}

/**
 * Start date of the cycle containing `today`: where a "This cycle" plan change applies from.
 * @param {PayDayEntry[]} schedule @param {string} today
 */
export const thisCycleStart = (schedule, today) => cycleFor(toDate(today), schedule).startStr;

/**
 * Save preferences and profile fields (they save on their own). Only the keys passed change;
 * null clears name, photo or theme.
 * @param {any} supabase
 * @param {{ theme?: "dark" | "light" | "system" | null, display_name?: string | null, avatar_url?: string | null,
 *   number_format?: "indian" | "international" | "european", week_start?: 0 | 1 }} changes
 * @returns {Promise<{ error: any }>}
 */
export const savePreferences = (supabase, changes) => supabase.rpc("update_preferences", { p_changes: changes });

/**
 * "Apply from when?": save salary, payday and save-first % together, from this cycle or the
 * next one. Leave a field out to keep it. The database records each change in the plan history.
 * @param {any} supabase
 * @param {{ salary?: number, payday?: number, savePct?: number }} changes salary in paise; payday 1-28 or 31
 * @param {"now" | "next"} applies
 * @param {PayDayEntry[]} schedule @param {string} today
 * @returns {Promise<{ error: any }>}
 */
export function applyPlan(supabase, changes, applies, schedule, today) {
  return supabase.rpc("update_plan", {
    p_salary: changes.salary ?? null,
    p_payday: changes.payday ?? null,
    p_save_pct: changes.savePct ?? null,
    p_applies: applies,
    p_effective_from: applies === "now" ? thisCycleStart(schedule, today) : nextCycleStart(schedule, today),
  });
}

/** Rows per request: Supabase returns at most 1000 by default. */
const PAGE = 1000;

/**
 * Every transaction of the signed-in user (with category names), newest first, fetched
 * page by page so large histories are not cut off at the API's row limit.
 * @param {any} supabase
 * @returns {Promise<{ data: any[], error: any }>}
 */
export async function fetchAllTransactions(supabase) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*, category:categories(name, type)")
      .order("date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: [], error };
    all.push(...data);
    if (data.length < PAGE) return { data: all, error: null };
  }
}

/**
 * All transactions as CSV text (the same columns as the dashboard export).
 * @param {any} supabase
 * @returns {Promise<{ csv: string, count: number, error: any }>}
 */
export async function exportAllCsv(supabase) {
  const { data, error } = await fetchAllTransactions(supabase);
  return error ? { csv: "", count: 0, error } : { csv: transactionsToCsv(data), count: data.length, error: null };
}

/**
 * Permanently delete the signed-in account and all its data, then end the session.
 * @param {any} supabase
 * @returns {Promise<{ error: any }>}
 */
export async function deleteAccount(supabase) {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { error };
  await supabase.auth.signOut();
  return { error: null };
}
