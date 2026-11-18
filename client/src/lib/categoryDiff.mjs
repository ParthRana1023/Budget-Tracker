// Categories popup (design handoff): edits are made on a draft and applied when the popup
// closes, with Undo. This turns a draft into the database writes, and checks it first.

/**
 * @typedef {{ id: string, name: string, type: "fixed" | "flexible", monthly_limit: number, due_day: number | null, is_active: boolean }} Cat
 */

/**
 * Problems that stop the popup from closing, in display order (empty = fine).
 * @param {Cat[]} draft
 */
export function draftProblems(draft) {
  const live = draft.filter((c) => c.is_active);
  const problems = [];
  if (live.some((c) => !c.name.trim())) problems.push("Every category needs a name.");
  const seen = new Set();
  for (const c of live) {
    const key = c.name.trim().toLowerCase();
    if (key && seen.has(key)) problems.push(`There are two categories called ${c.name.trim()}.`);
    seen.add(key);
  }
  const unpriced = live.find((c) => c.type === "fixed" && !(c.monthly_limit > 0));
  if (unpriced) problems.push(`${unpriced.name.trim() || "A fixed bill"} needs a monthly amount above ₹0.`);
  return problems;
}

/**
 * Writes that turn `before` into `after`. Rows in `after` without an id in `before` are new.
 * Deleting is switching off (is_active = false), so past entries keep their category.
 * @param {Cat[]} before
 * @param {Cat[]} after
 * @returns {{ updates: Array<{ id: string, patch: Partial<Cat> }>, inserts: Array<Omit<Cat, "id">> }}
 */
export function categoryDiff(before, after) {
  const old = new Map(before.map((c) => [c.id, c]));
  const updates = [], inserts = [];
  for (const c of after) {
    const row = { name: c.name.trim(), type: c.type, monthly_limit: c.monthly_limit, due_day: c.type === "fixed" ? c.due_day : null, is_active: c.is_active };
    const was = old.get(c.id);
    if (!was) {
      if (c.is_active) inserts.push(row);
      continue;
    }
    const wasRow = { name: was.name, type: was.type, monthly_limit: was.monthly_limit, due_day: was.type === "fixed" ? was.due_day ?? null : null, is_active: was.is_active };
    /** @type {Partial<Cat>} */
    const patch = {};
    for (const k of /** @type {const} */ (["name", "type", "monthly_limit", "due_day", "is_active"])) {
      if (row[k] !== wasRow[k]) patch[k] = /** @type {any} */ (row[k]);
    }
    if (Object.keys(patch).length) updates.push({ id: c.id, patch });
  }
  return { updates, inserts };
}
