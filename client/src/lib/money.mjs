// INR formatting from paise (integer minor units). Plain JS so .mjs modules and tests can use it.

/**
 * Format paise as a short INR string: whole rupees with Indian grouping, lakhs as "₹1.2L".
 * @param {number} paise
 * @returns {string}
 */
export function formatINR(paise) {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 100000) {
    return `₹${(rupees / 100000).toFixed(1)}L`;
  }
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

/**
 * Format paise as a decimal INR string (for detailed views).
 * @param {number} paise
 * @returns {string}
 */
export function formatINRDecimal(paise) {
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** Number format preference (user_settings.number_format) -> the locale that writes it. */
export const NUMBER_LOCALES = { indian: "en-IN", international: "en-US", european: "de-DE" };

/**
 * Whole rupees from paise in the user's number format, with a true minus sign
 * ("₹1,00,000" Indian, "₹100,000" international, "₹100.000" European). Display only.
 * @param {number} paise @param {keyof typeof NUMBER_LOCALES | null | undefined} [format]
 * @returns {string}
 */
export function formatMoney(paise, format) {
  const rupees = Math.round(Math.abs(paise) / 100);
  return `${paise <= -50 ? "−" : ""}₹${rupees.toLocaleString(NUMBER_LOCALES[format ?? "indian"] ?? "en-IN")}`;
}

/**
 * Design-handoff rupee format from paise: whole rupees, Indian grouping, never
 * abbreviated, with a true minus sign ("₹1,00,000", "−₹650").
 * @param {number} paise
 * @returns {string}
 */
export function inr(paise) {
  const rupees = Math.round(Math.abs(paise) / 100);
  return `${paise <= -50 ? "−" : ""}₹${rupees.toLocaleString("en-IN")}`;
}
