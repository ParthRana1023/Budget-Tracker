// Splitting a goal into sub-goals: how the money it already holds is shared out. The database
// (split_goal) only checks the plan adds up; the choices live here. Amounts are whole minor units.

/**
 * `total` shared by `weights`, in whole units that add up exactly (largest remainder; ties go to the
 * earlier one). All-zero weights give all zeros. BigInt, so a large amount times a large target
 * can't lose precision.
 * @param {number} total @param {number[]} weights @returns {number[]}
 */
export function shareOut(total, weights) {
  const W = weights.reduce((s, w) => s + BigInt(w), 0n);
  if (W === 0n) return weights.map(() => 0);
  const T = BigInt(total);
  const raw = weights.map((w) => T * BigInt(w));
  const parts = raw.map((x) => x / W);
  let left = T - parts.reduce((s, p) => s + p, 0n);
  const order = raw.map((x, i) => [x % W, i]).sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] > b[0] ? -1 : 1));
  for (const [, i] of order) {
    if (left === 0n) break;
    parts[i]++;
    left--;
  }
  return parts.map(Number);
}

/**
 * Each sub-goal's share of `total`: "equal", "target" (in proportion to the sub-goals' targets) or
 * "custom" (the user's amounts, which must add up to `total`). Null when custom amounts don't fit.
 * @param {number} total @param {"equal" | "target" | "custom"} mode
 * @param {number[]} targets sub-goal targets @param {number[]} [custom]
 * @returns {number[] | null}
 */
export function splitShares(total, mode, targets, custom = []) {
  if (mode === "equal")
    return shareOut(
      total,
      targets.map(() => 1),
    );
  if (mode === "target") return shareOut(total, targets);
  const ok =
    custom.length === targets.length &&
    custom.every((x) => Number.isInteger(x) && x >= 0) &&
    custom.reduce((s, x) => s + x, 0) === total;
  return ok ? [...custom] : null;
}

/**
 * The exact plan for split_goal: each sub-goal ends up holding its share. Every contribution is
 * split in the same proportion (so each sub-goal keeps a true saving pace) and "already saved" makes
 * up the rest; rounding is evened out inside contributions so no "already saved" goes below zero.
 * @param {{ savedBefore: number, contributions: Array<{ id: string, amount: number }>, shares: number[] }} input
 *   shares must add up to savedBefore + the contributions
 * @returns {{ savedBefore: number[], contributions: Array<{ id: string, parts: number[] }> }}
 */
export function planSplit({ savedBefore, contributions, shares }) {
  const total = savedBefore + contributions.reduce((s, c) => s + Number(c.amount), 0);
  if (shares.reduce((s, x) => s + x, 0) !== total) throw new Error("Shares must add up to the money held");
  const rows = contributions.map((c) => ({ id: c.id, parts: shareOut(Number(c.amount), shares) }));
  const saved = shares.map((a, i) => a - rows.reduce((s, r) => s + r.parts[i], 0));
  // Rounding can leave a sub-goal a few units over its share: move them, within one contribution,
  // to a sub-goal still under (the "already saved" shares add up to savedBefore >= 0, so one exists).
  for (let i = 0; i < saved.length; i++) {
    while (saved[i] < 0) {
      const k = saved.findIndex((x) => x > 0);
      const row = rows.find((r) => r.parts[i] > 0);
      if (k < 0 || !row) throw new Error("Can't share this out");
      row.parts[i]--;
      row.parts[k]++;
      saved[i]++;
      saved[k]--;
    }
  }
  return { savedBefore: saved, contributions: rows };
}

/**
 * Add sub-goals to a goal through split_goal, moving the money it holds as `plan` says.
 * @param {any} supabase @param {string} goalId
 * @param {Array<{ name: string, target_amount: number, target_date?: string | null, original_amount?: number }>} subGoals
 * @param {ReturnType<typeof planSplit>} plan
 * @returns {Promise<{ data: string[] | null, error: any }>}
 */
export const splitGoal = (supabase, goalId, subGoals, plan) =>
  supabase.rpc("split_goal", {
    p_goal_id: goalId,
    p_sub_goals: subGoals.map((g, i) => ({ ...g, saved_before: plan.savedBefore[i] ?? 0 })),
    p_contributions: plan.contributions,
  });

/**
 * Undo for splitGoal: the sub-goals' money goes back onto the goal, with its own target again.
 * @param {any} supabase @param {string} goalId @param {number} target @param {number | null} [original]
 */
export const unsplitGoal = (supabase, goalId, target, original = null) =>
  supabase.rpc("unsplit_goal", { p_goal_id: goalId, p_target_amount: target, p_original_amount: original });

/**
 * Deletes a goal with its sub-goals; `data` is what was removed, for restoreRows (Undo).
 * @param {any} supabase @param {string} goalId
 */
export const deleteGoal = (supabase, goalId) => supabase.rpc("delete_goal", { p_goal_id: goalId });

/** @param {any} supabase @param {unknown} rows a snapshot from deleteGoal */
export const restoreRows = (supabase, rows) => supabase.rpc("restore_rows", { p_rows: rows });
