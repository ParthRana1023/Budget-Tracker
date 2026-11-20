// Recurring items popup (Settings › Categories & fixed bills): edits are made on a draft and
// applied when the popup closes, with Undo. New rows get their id up front, so Undo is the
// same diff run backwards (deleted rows come back whole, added rows go).

/**
 * @typedef {{ id: string, name: string, amount: number, day_of_month: number | null, active: boolean } & Record<string, any>} Item
 */

const EDITABLE = /** @type {const} */ (["name", "amount", "day_of_month", "active"]);

/**
 * Problems that stop the popup from closing (empty = fine).
 * @param {Item[]} draft
 */
export function recurringProblems(draft) {
  const problems = [];
  if (draft.some((r) => !r.name.trim())) problems.push("Every recurring item needs a name.");
  const free = draft.find((r) => !(r.amount > 0));
  if (free) problems.push(`${free.name.trim() || "An item"} needs an amount above ₹0.`);
  return problems;
}

/**
 * Writes that turn `before` into `after`: rows only in `after` are inserted (whole), rows only
 * in `before` deleted, and changed names, amounts, days and on/off switches updated.
 * @param {Item[]} before
 * @param {Item[]} after
 * @returns {{ updates: { id: string, patch: Partial<Item> }[], inserts: Item[], deletes: string[] }}
 */
export function recurringDiff(before, after) {
  const old = new Map(before.map((r) => [r.id, r])),
    kept = new Set(after.map((r) => r.id));
  const updates = [],
    inserts = [];
  for (const r of after) {
    const row = { ...r, name: r.name.trim() };
    const was = old.get(r.id);
    if (!was) {
      inserts.push(row);
      continue;
    }
    /** @type {Partial<Item>} */
    const patch = {};
    for (const k of EDITABLE) if (row[k] !== was[k]) patch[k] = row[k];
    if (Object.keys(patch).length) updates.push({ id: r.id, patch });
  }
  return { updates, inserts, deletes: before.filter((r) => !kept.has(r.id)).map((r) => r.id) };
}
