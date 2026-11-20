// Money display from paise (integer minor units), in the user's number format.
// Plain JS so .mjs modules and tests can use it. Currency stays INR; the format is display only.

/** Number format preference (user_settings.number_format) -> the locale that writes it. */
export const NUMBER_LOCALES = { indian: "en-IN", international: "en-US", european: "de-DE" };

/** @typedef {keyof typeof NUMBER_LOCALES} NumberFormat */

/** @type {NumberFormat} */
let current = "indian";

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

/**
 * Whole rupees from paise with a true minus sign: "₹1,00,000" Indian, "₹100,000"
 * international, "₹100.000" European. Never abbreviated.
 * @param {number} paise @param {NumberFormat | null} [format] defaults to the user's
 * @returns {string}
 */
export function formatMoney(paise, format) {
  const rupees = Math.round(Math.abs(paise) / 100);
  return `${paise <= -50 ? "−" : ""}₹${rupees.toLocaleString(NUMBER_LOCALES[format ?? current])}`;
}

/** Design-handoff rupee format from paise in the user's number format ("₹1,00,000", "−₹650"). */
export const inr = (/** @type {number} */ paise) => formatMoney(paise);

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
 * What the user typed in their format -> "1234.5": digits and one decimal point, at most
 * 2 decimals and 9 characters. Separators for thousands are dropped.
 * @param {string} typed @param {NumberFormat} [format]
 */
export function cleanTyped(typed, format = current) {
  let x = format === "european" ? typed.replace(/[^\d,]/g, "").replace(/,/g, ".") : typed.replace(/[^\d.]/g, "");
  const i = x.indexOf(".");
  if (i >= 0)
    x =
      x.slice(0, i + 1) +
      x
        .slice(i + 1)
        .replace(/\./g, "")
        .slice(0, 2);
  return x.slice(0, 9);
}
