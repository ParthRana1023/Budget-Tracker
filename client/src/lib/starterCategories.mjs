/**
 * Starter categories. The database function ensure_starter_categories() is the
 * primary source; this list is only the fallback used by the dashboard when that
 * function is not installed yet. starterCategories.test.mjs fails if the two lists
 * ever differ.
 */
export const STARTER_CATEGORIES = [
  { name: "Rent / Housing", type: "fixed" },
  { name: "Utilities & Bills", type: "fixed" },
  { name: "EMI / Loans", type: "fixed" },
  { name: "Insurance", type: "fixed" },
  { name: "Subscriptions", type: "fixed" },
  { name: "Groceries", type: "flexible" },
  { name: "Food & Dining Out", type: "flexible" },
  { name: "Transport / Fuel", type: "flexible" },
  { name: "Shopping", type: "flexible" },
  { name: "Entertainment", type: "flexible" },
  { name: "Health", type: "flexible" },
  { name: "Travel", type: "flexible" },
  { name: "Miscellaneous", type: "flexible" },
];
