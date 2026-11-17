// Test fixture: the design handoff's demo account (Dashboard.dc.html seed), in database
// shape. Today 16 Nov 2026, cycle 1–30 Nov. Used only by *.test.mjs files.
import { getPeriodRange } from "./periods.mjs";

export const R = 100; // paise per rupee

export function demoAccount() {
  const cat = (id, name, type, limit, due_day = null) => ({ id, name, type, monthly_limit: limit * R, due_day, is_active: true });
  const categories = [
    cat("groc", "Groceries", "flexible", 10000), cat("dine", "Dining out", "flexible", 5000),
    cat("fuel", "Fuel", "flexible", 4000), cat("shop", "Shopping", "flexible", 6000),
    cat("ent", "Entertainment", "flexible", 3000), cat("health", "Health", "flexible", 0),
    cat("rent", "Rent", "fixed", 28000, 3), cat("net", "Internet", "fixed", 1200, 5),
    cat("phone", "Phone", "fixed", 600, 4), cat("elec", "Electricity", "fixed", 2500, 20),
    cat("ins", "Insurance", "fixed", 3000, 25),
  ];
  const tx = (id, type, category_id, amount, date, note, extra = {}) =>
    ({ id, type, category_id, amount: amount * R, date, note, source: "manual", from_reserve: false, external_id: null, ...extra });
  const transactions = [
    tx("t1", "expense", "dine", 640, "2026-11-16", "Swiggy lunch"),
    tx("t2", "expense", "groc", 1180, "2026-11-16", "BigBasket order"),
    tx("t3", "expense", "fuel", 1600, "2026-11-15", "HP petrol pump"),
    tx("t4", "expense", "ent", 500, "2026-11-15", "Movie tickets"),
    tx("t5", "expense", "dine", 1850, "2026-11-14", "Dinner with Riya"),
    tx("t6", "expense", "shop", 1250, "2026-11-12", "Decathlon"),
    tx("t7", "savings_transfer", null, 14000, "2026-11-10", "Emergency fund"),
    tx("t8", "expense", "groc", 2400, "2026-11-10", "DMart"),
    tx("t9", "expense", "groc", 1620, "2026-11-08", "Weekend groceries"),
    tx("t10", "expense", "dine", 1860, "2026-11-08", "Lunch at Toit"),
    tx("t11", "expense", "net", 1200, "2026-11-05", "ACT Fibernet", { external_id: "recurring:r3:2026-11" }),
    tx("t12", "expense", "phone", 600, "2026-11-04", "Jio postpaid", { external_id: "recurring:r4:2026-11" }),
    tx("t13", "expense", "rent", 28000, "2026-11-03", "November rent", { external_id: "recurring:r2:2026-11" }),
    tx("t14", "income", null, 95000, "2026-11-01", "Monthly salary", { external_id: "recurring:r1:2026-11" }),
  ];
  const item = (id, name, type, category_id, amount, day_of_month) =>
    ({ id, name, type, category_id, amount: amount * R, day_of_month, active: true, skip_month: null });
  const recurringItems = [
    item("r1", "Monthly salary", "income", null, 95000, 1), item("r2", "Rent", "expense", "rent", 28000, 3),
    item("r3", "ACT Fibernet", "expense", "net", 1200, 5), item("r4", "Jio postpaid", "expense", "phone", 600, null),
    item("r5", "Electricity", "expense", "elec", 2500, null), item("r6", "Insurance premium", "expense", "ins", 3000, 25),
  ];
  return {
    categories,
    transactions,
    recurringItems,
    period: getPeriodRange(new Date(2026, 10, 16, 12), 1),
    today: "2026-11-16",
    // 30% of ₹1,00,000 = the prototype's ₹30,000 monthly savings.
    settings: { take_home_pay: 100000 * R, savings_pct: 30 },
  };
}
