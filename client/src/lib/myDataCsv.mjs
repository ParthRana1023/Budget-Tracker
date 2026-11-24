// "Download all my data" as one CSV for Excel, Google Sheets or Numbers: the same document as the
// JSON (export_my_data), one titled section per part, separated by a blank line. Amounts are in
// currency units ("1234.50"), each in its own currency: an entry in the base it was recorded in,
// an original amount in its original currency.
import { escapeCsv } from "./csvExport.mjs";
import { minorDigits, toMajor } from "./money.mjs";

const MONEY = ["amount", "monthly_limit", "target_amount", "saved_before", "salary", "take_home_pay"];

/** @param {unknown} v @param {string} code */
const major = (v, code) => (v == null || v === "" ? "" : toMajor(Number(v), code).toFixed(minorDigits(code)));

/**
 * One cell: money in units, nested values as JSON, the rest as text.
 * @param {string} key @param {any} v @param {Record<string, any>} row @param {string} base
 */
function cell(key, v, row, base) {
  if (v == null) return "";
  if (key === "original_amount") return major(v, row.original_currency ?? base);
  if (MONEY.includes(key)) return major(v, row.base_currency ?? base);
  // Plan history: a salary change, each side in its own currency (a base switch writes both).
  if (row.field === "salary" && key === "from_value") return major(v, row.from_text ?? base);
  if (row.field === "salary" && key === "to_value") return major(v, row.to_text ?? base);
  return typeof v === "object" ? JSON.stringify(v) : v;
}

/** @param {string} title @param {Record<string, any>[]} rows @param {string} base */
function table(title, rows, base) {
  if (!rows.length) return [title, "None"];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return [
    title,
    keys.map(escapeCsv).join(","),
    ...rows.map((r) => keys.map((k) => escapeCsv(cell(k, r[k], r, base))).join(",")),
  ];
}

/** A single record (profile, plan, preferences) as Field / Value rows. */
function record(
  /** @type {string} */ title,
  /** @type {Record<string, any> | null} */ obj,
  /** @type {string} */ base,
) {
  return [
    title,
    "Field,Value",
    ...Object.entries(obj ?? {}).map(([k, v]) => `${escapeCsv(k)},${escapeCsv(cell(k, v, obj ?? {}, base))}`),
  ];
}

/**
 * @param {Record<string, any>} data what export_my_data returns
 * @returns {string} CSV text with CRLF line ends
 */
export function myDataToCsv(data) {
  const base = data.currency ?? "INR";
  const sections = [
    [
      "SaveFirst data export",
      `Exported at,${escapeCsv(data.exportedAt ?? "")}`,
      `Base currency,${escapeCsv(base)}`,
      "Amounts,In currency units; an entry in the currency it was recorded in",
    ],
    record("Profile", data.profile, base),
    record("Plan", data.plan, base),
    table("Plan history", data.planHistory ?? [], base),
    table("Categories", data.categories ?? [], base),
    table("Entries", data.entries ?? [], base),
    table("Recurring items", data.recurring ?? [], base),
    table("Goals", data.goals ?? [], base),
    table("Goal contributions", data.goalContributions ?? [], base),
    table("Income on hold", data.incomeOnHold ?? [], base),
    record("Preferences", data.preferences, base),
  ];
  return sections.map((s) => s.join("\r\n")).join("\r\n\r\n");
}
