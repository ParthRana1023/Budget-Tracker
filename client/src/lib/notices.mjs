// Budget warnings for the dashboard Notices card (design handoff): one per flexible
// category at 80% or more of its limit, or over it. Each can be dismissed on its own;
// the key includes the level, so crossing from 80% to over shows the warning again.

/**
 * @param {{
 *   flex: Array<{ id: string, name: string, monthly_limit: number }>,
 *   spentByCat: Map<string, number>,
 *   dismissed?: Iterable<string>  keys from earlier dismissals
 * }} input
 * @returns {Array<{ key: string, categoryId: string, name: string, level: "80" | "over", pct: number, spent: number, limit: number }>}
 */
export function budgetWarnings({ flex, spentByCat, dismissed = [] }) {
  const off = new Set(dismissed);
  const out = [];
  for (const c of flex) {
    const limit = Number(c.monthly_limit);
    if (!(limit > 0)) continue;
    const spent = spentByCat.get(c.id) ?? 0,
      ratio = spent / limit;
    const level = ratio >= 1 ? "over" : ratio >= 0.8 ? "80" : null;
    const key = `${c.id}:${level}`;
    if (!level || off.has(key)) continue;
    out.push({ key, categoryId: c.id, name: c.name, level, pct: Math.round(ratio * 100), spent, limit });
  }
  return out;
}
