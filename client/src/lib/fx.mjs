// Foreign-currency amounts. A rate is base units per 1 foreign unit (1 USD = 92.68 INR), fixed
// for a cycle: the rate on the cycle's start date. Each entry is converted once, when saved, and
// totals always add stored base amounts, so no rounding drift builds up.
import { baseCurrency, toMajor, toMinor } from "./money.mjs";

/**
 * Minor units of `from` at `rate` -> minor units of the base currency.
 * @param {number} originalMinor @param {string} from @param {number} rate @param {string} [to]
 */
export const convert = (originalMinor, from, rate, to = baseCurrency()) =>
  toMinor(toMajor(originalMinor, from) * rate, to);

/** Frankfurter (ECB) rate for 1 `quote` in `base` on `date` (or the last working day before). */
export const frankfurterUrl = (/** @type {string} */ quote, /** @type {string} */ base, /** @type {string} */ date) =>
  `https://api.frankfurter.dev/v1/${date}?base=${quote}&symbols=${base}`;

/**
 * Frankfurter's answer -> { rate, ecbDate }, or null when it isn't a usable rate.
 * @param {any} json @param {string} base
 */
export function parseFrankfurter(json, base) {
  const rate = Number(json?.rates?.[base]);
  if (!(rate > 0) || !Number.isFinite(rate)) return null;
  return { rate, ecbDate: typeof json.date === "string" ? json.date : null };
}

/**
 * The rate for `currency` -> the base currency on `cycleStart`, from the app's /api/rates.
 * `stale` = the rates service was down and this is the newest cached rate (dated `date`).
 * @param {string} currency @param {string} cycleStart
 * @param {string} [base] price in this currency instead of the user's base (a base switch: old -> new)
 * @returns {Promise<{ rate: number, date: string, stale: boolean }>}
 */
export async function fetchRate(currency, cycleStart, base) {
  const res = await fetch(
    `/api/rates?currency=${encodeURIComponent(currency)}&date=${encodeURIComponent(cycleStart)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !(body?.rate > 0)) throw new Error(body?.error ?? "Couldn’t get an exchange rate.");
  return body;
}

/**
 * Currencies of rows priced in a foreign currency whose rate isn't this cycle's yet.
 * @param {Array<{ original_currency?: string | null, fx_date?: string | null }>} rows @param {string} cycleStart
 */
export const staleCurrencies = (rows, cycleStart) => [
  ...new Set(
    rows
      .filter((r) => r.original_currency && r.fx_date !== cycleStart)
      .map((r) => /** @type {string} */ (r.original_currency)),
  ),
];

/**
 * Re-prices foreign bills and goal targets for a new cycle: `field` (the base amount) at this
 * cycle's rate. Rows whose currency has no rate in `rates` wait for the next try.
 * @param {Array<{ id: string, original_amount?: number | null, original_currency?: string | null, fx_date?: string | null }>} rows
 * @param {string} field @param {string} cycleStart @param {Map<string, number>} rates
 */
export function repricePatches(rows, field, cycleStart, rates) {
  return rows
    .filter(
      (r) =>
        r.original_currency && r.fx_date !== cycleStart && /** @type {number} */ (rates.get(r.original_currency)) > 0,
    )
    .map((r) => {
      const rate = /** @type {number} */ (rates.get(/** @type {string} */ (r.original_currency)));
      return {
        id: r.id,
        patch: {
          [field]: convert(Number(r.original_amount), /** @type {string} */ (r.original_currency), rate),
          fx_rate: rate,
          fx_date: cycleStart,
        },
      };
    });
}
