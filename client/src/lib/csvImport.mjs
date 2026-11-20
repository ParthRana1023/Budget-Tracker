// CSV import (Settings › Data): reads the same format lib/csvExport.mjs writes
// (Date, Type, Category, Amount (INR), Note) and checks every row before anything is saved.
// The database repeats the checks and skips exact duplicates (import_transactions).

/**
 * CSV text -> rows of cells. Handles quotes, "" inside quotes, CRLF and a leading BOM.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') cell += s[++i];
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      ((row = []), (cell = ""));
    } else cell += ch;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** @typedef {{ date: string, type: "expense" | "income", category: string, amount: number, note: string }} ImportRow */

/**
 * Checks a CSV for import. Rows that can't go in are listed with the reason (line numbers
 * as a spreadsheet shows them). Exact duplicates of saved entries (`existing`) or of earlier
 * rows are counted, not imported.
 * @param {string} text
 * @param {{ categories: { name: string }[], existing?: { date: string, type: string, category?: { name: string } | null, amount: number, note: string | null }[] }} ctx
 * @returns {{ rows: ImportRow[], skipped: { line: number, reason: string }[], duplicates: number, error: string | null }}
 */
export function checkImport(text, { categories, existing = [] }) {
  const out = { rows: /** @type {ImportRow[]} */ ([]), skipped: [], duplicates: 0, error: null };
  const [head, ...body] = parseCsv(text);
  const col = (/** @type {RegExp} */ re) => (head ?? []).findIndex((h) => re.test(h.trim()));
  const at = {
    date: col(/^date$/i),
    type: col(/^type$/i),
    category: col(/^category$/i),
    amount: col(/^amount/i),
    note: col(/^note$/i),
  };
  if (at.date < 0 || at.amount < 0) {
    return { ...out, error: "This file needs Date and Amount columns, like a SaveFirst export." };
  }
  if (!body.length) return { ...out, error: "This file has no entries." };

  const names = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.name]));
  const key = (/** @type {{ date: string, type: string, category: string, amount: number, note: string }} */ r) =>
    [r.date, r.type, r.category.toLowerCase(), r.amount, r.note].join("|");
  const seen = new Set(
    existing.map((t) =>
      key({
        date: t.date,
        type: t.type,
        category: t.category?.name ?? "",
        amount: Number(t.amount),
        note: t.note ?? "",
      }),
    ),
  );

  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (/** @type {number} */ k) => (k >= 0 ? (cells[k] ?? "").trim() : "");
    const skip = (/** @type {string} */ reason) => out.skipped.push({ line, reason });
    const date = get(at.date),
      type = (get(at.type) || "expense").toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      return skip("Date isn’t YYYY-MM-DD");
    if (type === "savings_transfer" || type === "reserve_transfer")
      return skip("Savings and reserve moves aren’t imported");
    if (type !== "expense" && type !== "income") return skip(`Unknown type “${get(at.type)}”`);
    const raw = get(at.amount).replace(/[₹,\s]/g, "");
    const amount = Math.round(parseFloat(raw) * 100);
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(amount > 0)) return skip("Amount must be above ₹0");
    let category = type === "expense" ? get(at.category) : "";
    if (category) {
      const known = names.get(category.toLowerCase());
      if (!known) return skip(`No category called “${category}”`);
      category = known;
    }
    const row = { date, type, category, amount, note: get(at.note).slice(0, 500) };
    if (seen.has(key(row))) return void out.duplicates++;
    seen.add(key(row));
    out.rows.push(/** @type {ImportRow} */ (row));
  });
  return out;
}
