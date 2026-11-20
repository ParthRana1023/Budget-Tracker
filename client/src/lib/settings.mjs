// Settings and Account helpers (design handoff v2, Settings.dc.html).
// Amounts are paise; dates are local 'YYYY-MM-DD'.

import { addDaysStr } from "./cycle.mjs";
import { cycleFor, toLocalDateString } from "./periods.mjs";
import { transactionsToCsv } from "./csvExport.mjs";

/** @typedef {import("./periods.mjs").PayDayEntry} PayDayEntry */
/** @typedef {import("./periods.mjs").PlanChange} PlanChange */
/** @typedef {"salary" | "payday" | "save_pct"} PlanField */

/** 1 -> "1st", 22 -> "22nd". @param {number} d */
export const ordinal = (d) =>
  d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");
/** Pay day for a sentence: "25th", or "last day" for 31. @param {number} d */
export const payDayLabel = (d) => (d === 31 ? "last day" : ordinal(d));
/** Payday select (Settings, Onboarding): 1st…28th of each month, then the last day (31). */
export const PAYDAY_OPTIONS = [
  ...Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `${ordinal(i + 1)} of each month` })),
  { value: 31, label: "Last day of the month" },
];

/** user_settings with its plan history (Dashboard, Settings). */
export const SETTINGS_SELECT =
  "*, plan_changes(field, from_value, to_value, applies, effective_from, superseded_at, created_at)";

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

/** Undo in the "Plan updated" toast: takes back the latest applyPlan. @param {any} supabase */
export const undoPlan = (supabase) => supabase.rpc("undo_plan_change");

/**
 * The cycle a new pay day would give, applied this cycle or from the next one, for the
 * "Apply from when?" preview. Entries never move: "This cycle" keeps today's cycle start and
 * ends it the day before the first new payday (lib/periods.mjs).
 * @param {PayDayEntry[]} schedule @param {string} today @param {number} payDay 1-28 or 31
 * @returns {{ now: { startStr: string, endStr: string }, next: { startStr: string, endStr: string } }}
 */
export function payDayPreview(schedule, today, payDay) {
  const nowFrom = thisCycleStart(schedule, today),
    nextFrom = nextCycleStart(schedule, today);
  const now = cycleFor(toDate(today), [...schedule, { payDay, from: nowFrom, applies: "now", madeOn: today }]);
  const next = cycleFor(toDate(nextFrom), [...schedule, { payDay, from: nextFrom, applies: "next" }]);
  return {
    now: { startStr: now.startStr, endStr: now.endStr },
    next: { startStr: next.startStr, endStr: next.endStr },
  };
}

/**
 * Plan changes chosen for a later cycle that haven't started yet, by field ("Starts 1 Dec").
 * @param {{ plan_changes?: PlanChange[] | null } | null} settings @param {string} today
 * @returns {Partial<Record<PlanField, string>>} field -> effective_from
 */
export function pendingPlan(settings, today) {
  /** @type {Partial<Record<PlanField, string>>} */
  const out = {};
  for (const r of settings?.plan_changes ?? [])
    if (r.applies === "next" && !r.superseded_at && r.effective_from > today) out[r.field] = r.effective_from;
  return out;
}

/**
 * Plan history rows, newest first. The onboarding ("start") rows become one "created" row.
 * `date` is the day the change was made.
 * @param {{ plan_changes?: PlanChange[] | null } | null} settings
 * @returns {{ key: string, date: string, field: PlanField | "created", from: number | null, to: number | null,
 *   applies: "start" | "now" | "next", superseded: boolean }[]}
 */
export function planHistory(settings) {
  const rows = settings?.plan_changes ?? [];
  const made = (/** @type {PlanChange} */ r) =>
    r.created_at ? toLocalDateString(new Date(r.created_at)) : r.effective_from;
  const start = rows.filter((r) => r.applies === "start");
  const changes = rows
    .filter((r) => r.applies !== "start")
    .map((r, i) => ({
      key: `${r.created_at ?? r.effective_from}-${r.field}-${i}`,
      at: r.created_at ?? r.effective_from,
      date: made(r),
      field: /** @type {PlanField} */ (r.field),
      from: r.from_value ?? null,
      to: r.to_value,
      applies: /** @type {"now" | "next"} */ (r.applies),
      superseded: !!r.superseded_at,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .map(({ at, ...r }) => r);
  if (!start.length) return changes;
  const first = start.reduce((a, b) =>
    String(a.created_at ?? a.effective_from) < String(b.created_at ?? b.effective_from) ? a : b,
  );
  return [
    ...changes,
    { key: "created", date: made(first), field: "created", from: null, to: null, applies: "start", superseded: false },
  ];
}

// ---------------------------------------------------------------- profile photo

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** What's wrong with a chosen photo, or null. @param {{ type: string, size: number }} file */
export const avatarProblem = (file) =>
  !AVATAR_TYPES.includes(file.type)
    ? "Choose a PNG, JPG or WebP image."
    : file.size > AVATAR_MAX_BYTES
      ? "That photo is over 2 MB. Choose a smaller one."
      : null;

/**
 * Remove the user's photo files (avatars/<user id>/…), except `keep`.
 * @param {any} supabase @param {string} userId @param {string} [keep] path to leave
 * @returns {Promise<{ error: any }>}
 */
export async function removeAvatarFiles(supabase, userId, keep) {
  const store = supabase.storage.from("avatars");
  const { data, error } = await store.list(userId);
  if (error) return { error };
  const paths = (data ?? [])
    .map((/** @type {{ name: string }} */ f) => `${userId}/${f.name}`)
    .filter((p) => p !== keep);
  if (!paths.length) return { error: null };
  return { error: (await store.remove(paths)).error ?? null };
}

/**
 * Upload a new profile photo, save its link to the account, then remove the old file.
 * @param {any} supabase @param {string} userId @param {File} file
 * @returns {Promise<{ url: string | null, error: any }>}
 */
export async function uploadAvatar(supabase, userId, file) {
  const problem = avatarProblem(file);
  if (problem) return { url: null, error: { message: problem } };
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
  const path = `${userId}/${Date.now()}.${ext}`;
  const store = supabase.storage.from("avatars");
  const up = await store.upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (up.error) return { url: null, error: up.error };
  const url = store.getPublicUrl(path).data.publicUrl;
  const saved = await savePreferences(supabase, { avatar_url: url });
  if (saved.error) {
    await store.remove([path]);
    return { url: null, error: saved.error };
  }
  // A leftover old file is harmless (unlinked); the next upload or account deletion clears it.
  await removeAvatarFiles(supabase, userId, path);
  return { url, error: null };
}

/** Remove the profile photo: unlink it from the account, then delete the files. @param {any} supabase @param {string} userId */
export async function removeAvatar(supabase, userId) {
  const { error } = await savePreferences(supabase, { avatar_url: null });
  return error ? { error } : removeAvatarFiles(supabase, userId);
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
 * The profile photo goes first: storage files can't be removed from SQL, and after the
 * account is gone nothing could remove them.
 * @param {any} supabase @param {string} userId
 * @returns {Promise<{ error: any }>}
 */
export async function deleteAccount(supabase, userId) {
  const photo = await removeAvatarFiles(supabase, userId);
  if (photo.error) return photo;
  const { error } = await supabase.rpc("delete_my_account");
  if (error) return { error };
  await supabase.auth.signOut();
  return { error: null };
}
