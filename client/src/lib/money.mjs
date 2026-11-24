// Money display from integer minor units (paise for INR, cents for USD, whole yen for JPY) in
// the user's base currency and number format. Plain JS so .mjs modules and tests can use it.

/** Number format preference (user_settings.number_format) -> the locale that writes it. */
export const NUMBER_LOCALES = { indian: "en-IN", international: "en-US", european: "de-DE" };

/** @typedef {keyof typeof NUMBER_LOCALES} NumberFormat */

/** The 30 currencies the rates API (Frankfurter, ECB) covers; the database allows the same. */
export const CURRENCIES = [
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "ZAR",
];
/** No minor unit (Intl's digits). Must match currency_digits() in the multicurrency migration. */
export const ZERO_DECIMAL = ["HUF", "IDR", "ISK", "JPY", "KRW"];

/** @type {NumberFormat} */
let current = "indian";
let base = "INR";

/**
 * Sets the number format every amount is shown and typed in. The signed-in page root
 * (DashboardClient, SettingsClient) calls it from user_settings.number_format while rendering,
 * before its children render.
 * shortcut: module-level, not React context; fine while a page shows one user's money. Move to context if that changes.
 * @param {string | null | undefined} format
 */
export function setNumberFormat(format) {
  current = format && format in NUMBER_LOCALES ? /** @type {NumberFormat} */ (format) : "indian";
}

/** Sets the base currency (user_settings.currency), next to setNumberFormat. @param {string | null | undefined} code */
export function setCurrency(code) {
  base = code && CURRENCIES.includes(code) ? code : "INR";
}
export const baseCurrency = () => base;

const digits = new Map();
/** Digits after the decimal point, from Intl: 2 for INR and USD, 0 for JPY, 3 for KWD. @param {string} [code] */
export function minorDigits(code = base) {
  if (!digits.has(code))
    digits.set(
      code,
      new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits,
    );
  return digits.get(code);
}
/** 1234.5 rupees -> 123450 paise. @param {number} major @param {string} [code] */
export const toMinor = (major, code = base) => Math.round(major * 10 ** minorDigits(code));
/** 123450 paise -> 1234.5 rupees. @param {number} minor @param {string} [code] */
export const toMajor = (minor, code = base) => minor / 10 ** minorDigits(code);

/** "₹", "$", "€", "¥"; letters for currencies without a sign ("CHF"). @param {string} [code] */
export function currencySymbol(code = base) {
  const f = new Intl.NumberFormat("en-IN", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
  return f.formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
}
const prefix = (/** @type {string} */ code) => {
  const s = currencySymbol(code);
  return s.length > 1 ? `${s} ` : s;
};

/**
 * An amount with its currency's decimals (design handoff v3, Multicurrency) and a true minus
 * sign: "₹1,00,000.00" Indian, "₹100,000.00" international, "₹100.000,00" European; "¥3,200",
 * "KWD 4.250". Never abbreviated.
 * @param {number} minor @param {NumberFormat | null} [format] defaults to the user's
 * @param {string} [code] defaults to the base currency
 * @returns {string}
 */
export function formatMoney(minor, format, code = base) {
  const d = minorDigits(code);
  const n = Math.abs(toMajor(Math.round(minor), code)).toLocaleString(NUMBER_LOCALES[format ?? current], {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return `${Math.round(minor) < 0 ? "−" : ""}${prefix(code)}${n}`;
}

/** Design-handoff money format in the base currency and the user's number format ("₹1,00,000", "−₹650"). */
export const inr = (/** @type {number} */ minor) => formatMoney(minor);

/**
 * A short amount for tight spots like the Reports calendar cells (design handoff `inrK`): "₹640",
 * "₹12k", and lakhs ("₹1.2L") in the Indian format or millions ("$1.2M") otherwise.
 * @param {number} minor
 */
export function inrShort(minor) {
  const a = Math.abs(toMajor(Math.round(minor))),
    indian = current === "indian";
  const s =
    indian && a >= 100000
      ? `${(a / 100000).toFixed(1).replace(/\.0$/, "")}L`
      : !indian && a >= 1e6
        ? `${(a / 1e6).toFixed(1).replace(/\.0$/, "")}M`
        : a >= 1000
          ? `${Math.round(a / 1000)}k`
          : String(Math.round(a));
  return `${minor < 0 ? "−" : ""}${prefix(base)}${s}`;
}

/** An amount as typed, with its decimals: "$19.99", "¥1,200". For original foreign amounts. */
export function formatExact(/** @type {number} */ minor, /** @type {string} */ code) {
  const d = minorDigits(code);
  const n = Math.abs(toMajor(minor, code)).toLocaleString(NUMBER_LOCALES[current], {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return `${minor < 0 ? "−" : ""}${prefix(code)}${n}`;
}

/**
 * A typed amount kept as "1234.5" -> how its field shows it while typing:
 * "1,234.5" (Indian / international) or "1.234,5" (European).
 * @param {string} raw @param {NumberFormat} [format]
 */
export function showTyped(raw, format = current) {
  if (!raw) return "";
  const [whole, dec] = raw.split(".");
  const grouped = whole ? Number(whole).toLocaleString(NUMBER_LOCALES[format]) : "0";
  return dec === undefined ? grouped : `${grouped}${format === "european" ? "," : "."}${dec}`;
}

/**
 * What the user typed in their format -> "1234.5": digits and one decimal point, at most as
 * many decimals as the currency has (none for JPY) and 9 characters. Thousands separators drop.
 * @param {string} typed @param {NumberFormat} [format] @param {string} [code]
 */
export function cleanTyped(typed, format = current, code = base) {
  let x = format === "european" ? typed.replace(/[^\d,]/g, "").replace(/,/g, ".") : typed.replace(/[^\d.]/g, "");
  const i = x.indexOf("."),
    d = minorDigits(code);
  if (i >= 0)
    x =
      x.slice(0, d ? i + 1 : i) +
      x
        .slice(i + 1)
        .replace(/\./g, "")
        .slice(0, d);
  return x.slice(0, 9);
}
