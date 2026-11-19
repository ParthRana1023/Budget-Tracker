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
 * Save Settings. Leave a field out (undefined) to keep it unchanged. A new pay day takes
 * effect at the next cycle start.
 * @param {any} supabase
 * @param {{ takeHomePay?: number, savingsPct?: number, theme?: "dark" | "light" | "system", payDay?: number }} changes
 * @param {PayDayEntry[]} schedule @param {string} today
 * @returns {Promise<{ error: any }>}
 */
export function saveSettings(supabase, changes, schedule, today) {
  const payDay = changes.payDay ?? null;
  return supabase.rpc("update_settings", {
    p_take_home_pay: changes.takeHomePay ?? null,
    p_savings_pct: changes.savingsPct ?? null,
    p_theme: changes.theme ?? null,
    p_pay_day: payDay,
    p_pay_day_from: payDay === null ? null : nextCycleStart(schedule, today),
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
